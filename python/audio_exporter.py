"""
ChoirMate AI — Practice Audio Synthesizer & Exporter (WAV + Genuine MP3 via FFmpeg).
Generates synthesized reference practice audio directly from validated/corrected musical events
(supporting Soprano/Alto/Tenor/Bass parts, chords, ties, rests, tempo BPM, and optional metronome clicks).
Never renames a WAV file to .mp3: uses /usr/bin/ffmpeg (libmp3lame) to encode real MP3 audio.
"""

import io
import os
import re
import wave
import base64
import shutil
import subprocess
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

SAMPLE_RATE = 44100


def sanitize_filename_part(text: str, default: str = "score") -> str:
    if not text:
        return default
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return cleaned[:48] if cleaned else default


def build_meaningful_filename(
    title: str,
    part_name: Optional[str],
    scope_label: Optional[str],
    tempo: int,
    fmt: str,
) -> str:
    song_slug = sanitize_filename_part(title, "choirmate-score")
    part_slug = sanitize_filename_part(part_name or "full-choir", "part")
    scope_slug = sanitize_filename_part(scope_label or "full-song", "full-song")
    ext = "mp3" if fmt.lower() == "mp3" else "wav"
    return f"{song_slug}_{part_slug}_{scope_slug}_{int(tempo)}bpm.{ext}"


def _duration_beats(note: Dict[str, Any]) -> float:
    raw_dur = note.get("duration", 1.0)
    if isinstance(raw_dur, (int, float)) and raw_dur > 0:
        return float(raw_dur)
    audio_type = str(note.get("audioType") or raw_dur or "quarter").lower()
    mapping = {
        "whole": 4.0,
        "dotted-half": 3.0,
        "half": 2.0,
        "dotted-quarter": 1.5,
        "quarter": 1.0,
        "dotted-eighth": 0.75,
        "eighth": 0.5,
        "sixteenth": 0.25,
    }
    return mapping.get(audio_type, 1.0)


def _synthesize_single_tone(
    freq: float,
    dur_sec: float,
    voice: str = "choir",
    sample_rate: int = SAMPLE_RATE,
) -> np.ndarray:
    num_samples = max(1, int(round(dur_sec * sample_rate)))
    t = np.linspace(0.0, dur_sec, num_samples, endpoint=False, dtype=np.float64)

    if freq <= 0.0:
        return np.zeros(num_samples, dtype=np.float64)

    if voice == "piano":
        # Percussive grand piano-style harmonic series with exponential decay
        attack = min(0.012, dur_sec * 0.1)
        decay_env = np.exp(-2.8 * t / max(0.35, dur_sec))
        attack_env = np.minimum(1.0, t / max(1e-4, attack))
        release_samples = max(1, int(min(0.04, dur_sec * 0.15) * sample_rate))
        release_env = np.ones(num_samples, dtype=np.float64)
        release_env[-release_samples:] = np.linspace(1.0, 0.0, release_samples)

        signal = (
            1.00 * np.sin(2.0 * np.pi * freq * t)
            + 0.42 * np.sin(2.0 * np.pi * (freq * 2.0) * t) * np.exp(-1.5 * t)
            + 0.18 * np.sin(2.0 * np.pi * (freq * 3.0) * t) * np.exp(-2.5 * t)
            + 0.08 * np.sin(2.0 * np.pi * (freq * 4.0) * t) * np.exp(-3.8 * t)
        )
        return signal * attack_env * decay_env * release_env * 0.36

    if voice == "strings":
        # Warm bowed string ensemble with gentle vibrato and slow attack
        attack_sec = min(0.085, dur_sec * 0.25)
        release_sec = min(0.09, dur_sec * 0.25)
        env = np.ones(num_samples, dtype=np.float64)
        att_n = max(1, int(attack_sec * sample_rate))
        rel_n = max(1, int(release_sec * sample_rate))
        env[:att_n] = np.linspace(0.0, 1.0, att_n)
        env[-rel_n:] = np.linspace(1.0, 0.0, rel_n)

        vibrato = 1.0 + 0.003 * np.sin(2.0 * np.pi * 5.4 * t)
        phase = 2.0 * np.pi * freq * np.cumsum(vibrato) / sample_rate
        signal = (
            0.90 * np.sin(phase)
            + 0.45 * np.sin(2.0 * phase + 0.2)
            + 0.25 * np.sin(3.0 * phase + 0.5)
            + 0.12 * np.sin(4.0 * phase)
        )
        return signal * env * 0.30

    # Default: 'choir' — warm choral vowel ("Ah/Oh") formant-shaped harmonic synthesis
    attack_sec = min(0.055, dur_sec * 0.22)
    release_sec = min(0.065, dur_sec * 0.22)
    env = np.ones(num_samples, dtype=np.float64)
    att_n = max(1, int(attack_sec * sample_rate))
    rel_n = max(1, int(release_sec * sample_rate))
    env[:att_n] = np.sin(np.linspace(0.0, np.pi / 2.0, att_n))
    env[-rel_n:] = np.cos(np.linspace(0.0, np.pi / 2.0, rel_n))

    # Gentle natural choral vibrato after 120ms
    vib_mask = np.clip((t - 0.12) / 0.15, 0.0, 1.0)
    vibrato = 1.0 + 0.0028 * vib_mask * np.sin(2.0 * np.pi * 5.1 * t)
    phase = 2.0 * np.pi * freq * np.cumsum(vibrato) / sample_rate

    # Formant weighting around 750 Hz ("Ah" vowel warmth)
    harmonics = np.zeros(num_samples, dtype=np.float64)
    weights = [1.0, 0.58, 0.32, 0.16, 0.08, 0.04]
    for h_idx, w in enumerate(weights, start=1):
        h_freq = freq * h_idx
        if h_freq >= sample_rate * 0.45:
            break
        formant_boost = 1.0 + 0.45 * np.exp(-((h_freq - 720.0) / 380.0) ** 2)
        harmonics += (w * formant_boost) * np.sin(h_idx * phase)

    return harmonics * env * 0.26


def synthesize_practice_wav_bytes(
    notes: List[Dict[str, Any]],
    tempo: int = 88,
    voice: str = "choir",
    metronome: bool = False,
) -> Tuple[bytes, float]:
    """
    Synthesizes a sequence of validated/corrected ChoirMate note events into 16-bit 44.1kHz PCM WAV bytes.
    Supports chords, ties ('start' / 'continue'), rests, and optional metronome clicks.
    Returns (wav_bytes, duration_seconds).
    """
    if not notes:
        raise ValueError("Cannot export practice audio: no musical note events were provided.")

    safe_tempo = max(36, min(220, int(tempo or 88)))
    sec_per_beat = 60.0 / float(safe_tempo)

    # Coalesce tied notes so tied durations sustain smoothly just like live playback
    merged_events: List[Dict[str, Any]] = []
    idx = 0
    total_n = len(notes)
    while idx < total_n:
        curr = dict(notes[idx])
        beats = _duration_beats(curr)
        is_rest = bool(curr.get("isRest") or curr.get("pitch") == "REST" or float(curr.get("frequency") or 0) <= 0)
        if not is_rest and curr.get("tie") in ("start", "continue"):
            look = idx + 1
            while look < total_n:
                nxt = notes[look]
                nxt_rest = bool(nxt.get("isRest") or nxt.get("pitch") == "REST")
                same_pitch = (
                    not nxt_rest
                    and abs(float(nxt.get("frequency") or 0) - float(curr.get("frequency") or 0)) < 1.5
                )
                if same_pitch:
                    beats += _duration_beats(nxt)
                    look += 1
                    if nxt.get("tie") not in ("start", "continue"):
                        break
                else:
                    break
            curr["_merged_beats"] = beats
            merged_events.append(curr)
            idx = look
        else:
            curr["_merged_beats"] = beats
            merged_events.append(curr)
            idx += 1

    segments: List[np.ndarray] = []
    total_beats_accum = 0.0

    for ev in merged_events:
        beats = float(ev.get("_merged_beats", _duration_beats(ev)))
        dur_sec = max(0.06, beats * sec_per_beat)
        num_samples = max(1, int(round(dur_sec * SAMPLE_RATE)))
        is_rest = bool(ev.get("isRest") or ev.get("pitch") == "REST" or float(ev.get("frequency") or 0) <= 0)

        if is_rest:
            seg = np.zeros(num_samples, dtype=np.float64)
        else:
            primary_freq = float(ev.get("frequency") or 0.0)
            chord_freqs = [
                float(f)
                for f in (ev.get("chordFrequencies") or [])
                if isinstance(f, (int, float)) and float(f) > 0
            ]
            if primary_freq > 0 and all(abs(primary_freq - cf) > 0.5 for cf in chord_freqs):
                all_freqs = [primary_freq] + chord_freqs
            elif chord_freqs:
                all_freqs = chord_freqs
            else:
                all_freqs = [primary_freq]

            # Leave a tiny 18ms articulation breath between non-tied notes
            sound_dur = max(0.04, dur_sec - 0.018)
            sound_samples = max(1, int(round(sound_dur * SAMPLE_RATE)))
            seg = np.zeros(num_samples, dtype=np.float64)

            voice_mix = np.zeros(sound_samples, dtype=np.float64)
            scale = 1.0 / max(1.0, np.sqrt(len(all_freqs)))
            for f in all_freqs:
                tone = _synthesize_single_tone(f, sound_dur, voice=voice, sample_rate=SAMPLE_RATE)
                take = min(sound_samples, len(tone))
                voice_mix[:take] += tone[:take] * scale

            seg[:sound_samples] = voice_mix

        if metronome:
            # Add woodblock-style metronome click on integer beat boundaries within this event
            beat_Count = max(1, int(round(beats)))
            for b in range(beat_Count):
                click_offset = int(round(b * sec_per_beat * SAMPLE_RATE))
                if click_offset < num_samples:
                    click_dur = 0.025
                    click_len = min(int(click_dur * SAMPLE_RATE), num_samples - click_offset)
                    ct = np.linspace(0.0, click_dur, click_len, endpoint=False)
                    is_downbeat = (int(round(total_beats_accum + b)) % 4 == 0)
                    click_freq = 1150.0 if is_downbeat else 820.0
                    click_wave = 0.22 * np.sin(2.0 * np.pi * click_freq * ct) * np.exp(-90.0 * ct)
                    seg[click_offset : click_offset + click_len] += click_wave

        segments.append(seg)
        total_beats_accum += beats

    # Append a gentle 250ms tail silence so the final release isn't clipped
    tail = np.zeros(int(0.25 * SAMPLE_RATE), dtype=np.float64)
    full_signal = np.concatenate(segments + [tail]) if segments else tail

    peak = float(np.max(np.abs(full_signal)))
    if peak > 0.92:
        full_signal = full_signal * (0.90 / peak)
    elif peak > 0.0 and peak < 0.25:
        full_signal = full_signal * (0.70 / peak)

    pcm_int16 = np.clip(full_signal * 32767.0, -32768, 32767).astype(np.int16)
    duration_seconds = round(float(len(pcm_int16)) / float(SAMPLE_RATE), 2)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_int16.tobytes())

    return buf.getvalue(), duration_seconds


def encode_wav_to_mp3_bytes(wav_bytes: bytes) -> bytes:
    """
    Converts WAV bytes into genuine MP3 audio bytes using /usr/bin/ffmpeg (libmp3lame).
    Raises RuntimeError if ffmpeg is unavailable or fails.
    """
    ffmpeg_bin = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
    if not os.path.exists(ffmpeg_bin):
        raise RuntimeError("FFmpeg encoder is not installed on the server for MP3 conversion.")

    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "wav",
        "-i",
        "pipe:0",
        "-codec:a",
        "libmp3lame",
        "-qscale:a",
        "2",
        "-f",
        "mp3",
        "pipe:1",
    ]
    proc = subprocess.run(
        cmd,
        input=wav_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        err_text = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"FFmpeg MP3 encoding failed: {err_text or 'empty output'}")

    return proc.stdout


def export_practice_audio(
    notes: List[Dict[str, Any]],
    title: str = "Practice Score",
    part_name: Optional[str] = "Vocal Part",
    scope_label: Optional[str] = "Full Song",
    tempo: int = 88,
    voice: str = "choir",
    fmt: str = "mp3",
    metronome: bool = False,
) -> Dict[str, Any]:
    """
    Synthesizes practice audio and returns metadata + base64 encoded audio in the requested format ('mp3' or 'wav').
    """
    target_fmt = (fmt or "mp3").strip().lower()
    if target_fmt not in ("mp3", "wav"):
        raise ValueError(f"Unsupported audio format '{fmt}'. Supported formats are 'mp3' and 'wav'.")

    wav_bytes, duration_sec = synthesize_practice_wav_bytes(
        notes=notes,
        tempo=tempo,
        voice=voice,
        metronome=metronome,
    )

    if target_fmt == "mp3":
        audio_bytes = encode_wav_to_mp3_bytes(wav_bytes)
        mime_type = "audio/mpeg"
    else:
        audio_bytes = wav_bytes
        mime_type = "audio/wav"

    filename = build_meaningful_filename(
        title=title,
        part_name=part_name,
        scope_label=scope_label,
        tempo=tempo,
        fmt=target_fmt,
    )

    sung_count = sum(
        1
        for n in notes
        if not n.get("isRest") and n.get("pitch") != "REST" and float(n.get("frequency") or 0) > 0
    )
    rest_count = len(notes) - sung_count

    return {
        "success": True,
        "format": target_fmt,
        "mimeType": mime_type,
        "fileName": filename,
        "durationSeconds": duration_sec,
        "byteLength": len(audio_bytes),
        "noteCount": sung_count,
        "restCount": rest_count,
        "tempo": int(tempo or 88),
        "voice": voice,
        "audioTypeNotice": "Synthesized instrumental/choral reference audio generated from validated notation",
        "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
    }
