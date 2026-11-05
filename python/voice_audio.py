
"""Synchronized SATB audio rendering for ChoirMate Voice Studio."""

import io
import math
import wave
import array

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None  # type: ignore
    HAS_NUMPY = False

try:
    from .audio_exporter import SAMPLE_RATE, _synthesize_single_tone
except ImportError:
    from audio_exporter import SAMPLE_RATE, _synthesize_single_tone


NOTE_STEPS = {
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
}


def pitch_to_frequency(pitch):
    """Convert a MusicXML pitch into its frequency in Hz."""
    if not pitch:
        return 0.0

    step = str(pitch["step"]).upper()
    octave = int(pitch["octave"])
    alter = float(pitch.get("alter", 0))

    if step not in NOTE_STEPS:
        raise ValueError(f"Invalid musical pitch: {step}")

    midi_note = (
        12 * (octave + 1)
        + NOTE_STEPS[step]
        + alter
    )

    return 440.0 * (2.0 ** ((midi_note - 69) / 12.0))


def render_voice_audio(voices, selected_voice_ids=None, tempo=88):
    """
    Render selected voices onto one synchronized audio timeline.

    voices: output from extract_voices()
    selected_voice_ids: optional list of voice IDs
    tempo: quarter-note beats per minute

    Returns (wav_bytes, duration_seconds).
    """
    if not voices:
        raise ValueError("No musical voices were provided.")

    tempo = max(36, min(220, int(tempo)))
    seconds_per_beat = 60.0 / tempo

    selected = (
        [v for v in voices if v["id"] in selected_voice_ids]
        if selected_voice_ids is not None
        else voices
    )

    if not selected:
        raise ValueError("No matching voices were selected.")

    all_notes = [
        note
        for voice in selected
        for note in voice.get("notes", [])
    ]

    if not all_notes:
        raise ValueError("Selected voices contain no notes.")

    total_beats = max(
        float(note["startBeat"]) + float(note["duration"])
        for note in all_notes
    )

    total_seconds = total_beats * seconds_per_beat + 0.25
    sample_count = max(1, int(math.ceil(total_seconds * SAMPLE_RATE)))

    if not HAS_NUMPY:
        mix_list = [0.0] * sample_count
        for voice in selected:
            for note in voice.get("notes", []):
                if note.get("isRest") or not note.get("pitch"):
                    continue
                frequency = pitch_to_frequency(note["pitch"])
                start_seconds = float(note["startBeat"]) * seconds_per_beat
                duration_seconds = float(note["duration"]) * seconds_per_beat
                if duration_seconds <= 0:
                    continue
                start_sample = max(0, int(round(start_seconds * SAMPLE_RATE)))
                if start_sample >= sample_count:
                    continue
                tone = _synthesize_single_tone(
                    frequency,
                    duration_seconds,
                    voice="choir",
                    sample_rate=SAMPLE_RATE,
                )
                end_sample = min(sample_count, start_sample + len(tone))
                for idx in range(start_sample, end_sample):
                    mix_list[idx] += tone[idx - start_sample]

        peak = max((abs(x) for x in mix_list), default=0.0)
        gain_mult = (0.9 / max(peak, 0.9)) if peak > 0 else 1.0
        pcm_arr = array.array(
            "h",
            (max(-32768, min(32767, int(round(x * gain_mult * 32767.0)))) for x in mix_list)
        )
        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(SAMPLE_RATE)
            wav_file.writeframes(pcm_arr.tobytes())
        return output.getvalue(), round(len(pcm_arr) / SAMPLE_RATE, 2)

    mix = np.zeros(sample_count, dtype=np.float64)

    for voice in selected:
        for note in voice.get("notes", []):
            if note.get("isRest") or not note.get("pitch"):
                continue

            frequency = pitch_to_frequency(note["pitch"])

            start_seconds = float(note["startBeat"]) * seconds_per_beat
            duration_seconds = float(note["duration"]) * seconds_per_beat

            if duration_seconds <= 0:
                continue

            start_sample = max(
                0,
                int(round(start_seconds * SAMPLE_RATE))
            )

            if start_sample >= sample_count:
                continue

            tone = _synthesize_single_tone(
                frequency,
                duration_seconds,
                voice="choir",
                sample_rate=SAMPLE_RATE,
            )

            end_sample = min(
                sample_count,
                start_sample + len(tone)
            )

            mix[start_sample:end_sample] += tone[
                :end_sample - start_sample
            ]

    peak = float(np.max(np.abs(mix)))

    if peak > 0:
        mix *= 0.9 / max(peak, 0.9)

    pcm = np.clip(
        mix * 32767,
        -32768,
        32767
    ).astype(np.int16)

    output = io.BytesIO()

    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm.tobytes())

    return output.getvalue(), round(
        len(pcm) / SAMPLE_RATE,
        2
    )
