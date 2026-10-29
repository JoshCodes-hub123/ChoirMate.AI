"""
Open-Weight AI Music Teacher using SmolLM2-360M-Instruct for ChoirMate AI.
Generates beginner-friendly explanations, rhythm guides, and choral practice steps
from verified structured musical notation data (never raw pixels or fabricated notes).
"""

import os
import sys
import urllib.request
import threading
from typing import Dict, Any, List, Optional

MODEL_REPO = "bartowski/SmolLM2-360M-Instruct-GGUF"
MODEL_FILENAME = "SmolLM2-360M-Instruct-Q4_K_M.gguf"
MODEL_URL = f"https://huggingface.co/{MODEL_REPO}/resolve/main/{MODEL_FILENAME}"
MODEL_PATH = os.environ.get("SMOLLM2_MODEL_PATH", os.path.join("/tmp", "choirmate-models", MODEL_FILENAME))


class SmolLM2Teacher:
    def __init__(self, model_path: str = MODEL_PATH):
        self.model_path = model_path
        self.llm = None
        self._lock = threading.Lock()
        self._init_model()

    def _ensure_model_file(self) -> None:
        """Downloads SmolLM2 GGUF into /tmp/choirmate-models if missing and auto-download is enabled."""
        if os.path.exists(self.model_path) and os.path.getsize(self.model_path) > 10_000_000:
            return
        if os.environ.get("SMOLLM2_AUTO_DOWNLOAD", "1") == "0":
            return
        try:
            parent_dir = os.path.dirname(self.model_path)
            if parent_dir:
                os.makedirs(parent_dir, exist_ok=True)
            part_path = self.model_path + ".part"
            sys.stderr.write(f"[SmolLM2Teacher] Downloading {MODEL_FILENAME} to {self.model_path}...\n")
            urllib.request.urlretrieve(MODEL_URL, part_path)
            if os.path.exists(part_path) and os.path.getsize(part_path) > 10_000_000:
                os.replace(part_path, self.model_path)
                sys.stderr.write(f"[SmolLM2Teacher] Downloaded {MODEL_FILENAME} successfully.\n")
        except Exception as dl_err:
            sys.stderr.write(f"[SmolLM2Teacher] Notice: Could not download GGUF model: {dl_err}\n")

    def _init_model(self):
        """Loads llama-cpp-python model if GGUF file exists (or after downloading to /tmp)."""
        self._ensure_model_file()
        if os.path.exists(self.model_path):
            try:
                from llama_cpp import Llama
                self.llm = Llama(
                    model_path=self.model_path,
                    n_ctx=2048,
                    n_threads=4,
                    verbose=False
                )
            except Exception as e:
                sys.stderr.write(f"[SmolLM2Teacher] Notice: llama-cpp-python not initialized: {e}\n")
                self.llm = None
        else:
            self.llm = None

    def explain_score(
        self,
        title: str,
        key_signature: Dict[str, Any],
        time_signature: Dict[str, Any],
        notes: List[Dict[str, Any]],
        parts: Optional[List[Dict[str, Any]]] = None,
        recognition_summary: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Generates musicological explanation, rhythm patterns, and beginner practice steps
        using SmolLM2-360M-Instruct on validated musical events.
        """
        sung_notes = [n for n in notes if not n.get('isRest', False) and n.get('frequency', 0) > 0]
        rest_notes = [n for n in notes if n.get('isRest', False)]
        note_count = len(sung_notes)

        if note_count == 0:
            return {
                'model': 'SmolLM2-360M-Instruct-GGUF',
                'modelLicense': 'Apache 2.0',
                'isLocalAi': bool(self.llm is not None),
                'simpleExplanation': {
                    'essence': 'No pitched vocal notes were found in this passage.',
                    'range': 'Unknown',
                    'melodicShape': 'Empty or rest-only passage',
                    'choralTip': 'Please ensure the sheet music image has clearly printed staff lines and noteheads.'
                },
                'rhythmBreakdown': {
                    'patterns': [],
                    'countingGuide': '1 - 2 - 3 - 4',
                    'advice': 'Check your score image clarity.'
                },
                'practiceSteps': []
            }

        first_note = sung_notes[0]
        last_note = sung_notes[-1]
        lowest_note = min(sung_notes, key=lambda n: n['frequency'])
        highest_note = max(sung_notes, key=lambda n: n['frequency'])
        solfa_sequence = " - ".join(n['solfa'] for n in sung_notes[:10])

        key_name = key_signature.get('key', 'C Major')
        beats_per_measure = time_signature.get('numerator', 4)
        beat_unit = time_signature.get('denominator', 4)
        measures_set = sorted({n.get('measure', 1) for n in notes})
        total_measures = len(measures_set)
        total_parts = len(parts) if parts else 1
        part_names = ", ".join(p.get('name', f"Part {i+1}") for i, p in enumerate(parts)) if parts else "Single Voice"

        seen_durations = set()
        rhythm_patterns = []
        for n in notes:
            is_rest = bool(n.get('isRest', False))
            d = n['duration']
            key_tuple = (d, is_rest)
            if key_tuple not in seen_durations:
                seen_durations.add(key_tuple)
                if is_rest:
                    rhythm_patterns.append({
                        'name': n['durationName'].split('(')[0].strip(),
                        'durationInBeats': d,
                        'countWord': f'Rest ({d:g})',
                        'explanation': f'Silent breath/rest lasting {d:g} beat{"s" if d != 1 else ""} in {beats_per_measure}/{beat_unit} meter.',
                        'symbol': '𝄽' if d == 1 else ('𝄾' if d < 1 else '𝄻')
                    })
                else:
                    count_word = (
                        'Ta' if d == 1 else
                        'Ta-ah' if d == 2 else
                        'Ta-ah-ah' if d == 3 else
                        'Ta-ah-ah-ah' if d >= 4 else
                        'Ta-i' if d == 1.5 else
                        'Ti' if d == 0.5 else
                        'Ti-ri'
                    )
                    symbol = (
                        '♩' if d == 1 else
                        '𝅗𝅥' if d == 2 else
                        '𝅗𝅥.' if d == 3 else
                        '𝅝' if d >= 4 else
                        '♩.' if d == 1.5 else
                        '♪' if d == 0.5 else
                        '♬'
                    )
                    rhythm_patterns.append({
                        'name': n['durationName'].split('(')[0].strip(),
                        'durationInBeats': d,
                        'countWord': count_word,
                        'explanation': f'Sustained for {d:g} beat{"s" if d != 1 else ""} in {beats_per_measure}/{beat_unit} meter.',
                        'symbol': symbol
                    })

        ai_generated_advice = None
        if self.llm is not None:
            prompt = f"""<|im_start|>system
You are a warm, supportive choir director teaching sight-reading. You receive validated MusicXML note data (not raw pixels). Never invent notes not listed below.
Explain the piece's character, vocal range, and sight-reading approach in 2-3 clear sentences.<|im_end|>
<|im_start|>user
Title: {title}
Key: {key_name}
Meter: {beats_per_measure}/{beat_unit}
Measures: {total_measures} ({note_count} sung notes, {len(rest_notes)} rests)
Vocal Parts: {total_parts} ({part_names})
Opening Solfa: {solfa_sequence}
Range: {lowest_note['pitch']} ({lowest_note['solfa']}) to {highest_note['pitch']} ({highest_note['solfa']})
<|im_end|>
<|im_start|>assistant
"""
            try:
                with self._lock:
                    self.llm.reset()
                    output = self.llm(prompt, max_tokens=160, stop=["<|im_end|>"], temperature=0.25)
                    ai_generated_advice = output['choices'][0]['text'].strip()
            except Exception as e:
                sys.stderr.write(f"[SmolLM2] Inference fallback: {e}\n")

        essence = ai_generated_advice or (
            f"A {total_measures}-measure choral piece in {key_name} ({beats_per_measure}/{beat_unit}) across {total_parts} vocal part{'s' if total_parts != 1 else ''}, "
            f"opening on {first_note['solfa']} ({first_note['pitch']}) and spanning {note_count} sung notes and {len(rest_notes)} rests before resolving on {last_note['solfa']} ({last_note['pitch']})."
        )

        uncertainty_note = ""
        if recognition_summary and recognition_summary.get('uncertainMeasuresCount', 0) > 0:
            unc_cnt = recognition_summary['uncertainMeasuresCount']
            uncertainty_note = f" Note: {unc_cnt} measure{'s have' if unc_cnt != 1 else ' has'} rhythmic or optical uncertainty flagged for review against the original score."

        return {
            'model': 'SmolLM2-360M-Instruct-GGUF',
            'modelLicense': 'Apache 2.0',
            'isLocalAi': bool(self.llm is not None),
            'simpleExplanation': {
                'essence': essence,
                'range': (
                    f"Spans {lowest_note['pitch']} ({lowest_note['solfa']}) up to {highest_note['pitch']} ({highest_note['solfa']}) "
                    f"across {total_measures} measures ({note_count} sung notes, {len(rest_notes)} rests)."
                ),
                'melodicShape': (
                    f"Opens on {first_note['solfa']} ({first_note['pitch']}), reaches a peak at {highest_note['pitch']} ({highest_note['solfa']}), "
                    f"and concludes on {last_note['solfa']} ({last_note['pitch']}).{uncertainty_note}"
                ),
                'choralTip': (
                    'Keep your soft palate lifted, breathe silently during marked rests, and align vowel transitions cleanly across measure barlines.'
                )
            },
            'rhythmBreakdown': {
                'patterns': rhythm_patterns[:8],
                'countingGuide': f'Count steadily: {" - ".join(str(i + 1) for i in range(beats_per_measure))}',
                'advice': (
                    f'Count {beats_per_measure} beats per bar in {beats_per_measure}/{beat_unit} time. '
                    f'Observe all {len(rest_notes)} rests silently so your entries stay locked with the ensemble.'
                )
            },
            'practiceSteps': [
                {
                    'step': 1,
                    'title': f'Scan Full Score & {beats_per_measure}/{beat_unit} Meter',
                    'description': (
                        f'Follow the original score across all {total_measures} measures ({total_parts} part{"s" if total_parts != 1 else ""}). '
                        f'Clap the {beats_per_measure}/{beat_unit} pulse while observing rests and dotted rhythms.'
                    ),
                    'focus': 'Full-Score Navigation & Pulse'
                },
                {
                    'step': 2,
                    'title': f'Tune Anchor Pitch (Do = {key_signature.get("homeNote", "C")})',
                    'description': (
                        f'Establish the tonic {key_signature.get("homeNote", "C")} ({key_name}) and opening pitch '
                        f'{first_note["pitch"]} ({first_note["solfa"]}) before singing.'
                    ),
                    'focus': 'Tonal Center & Intonation'
                },
                {
                    'step': 3,
                    'title': 'Chant Solfa System by System',
                    'description': (
                        f'Speak the Movable-Do syllables in rhythm ({solfa_sequence}...), '
                        f'checking any accidentals or flagged measures against the original printed sheet.'
                    ),
                    'focus': 'Solfa & Interval Accuracy'
                },
                {
                    'step': 4,
                    'title': 'Section & Full-Song Practice',
                    'description': (
                        'Use Practice Mode to rehearse individual systems or measure ranges first, then sing the complete vocal part from start to finish.'
                    ),
                    'focus': 'Complete Song Mastery'
                }
            ]
        }

    def answer_question(
        self,
        question: str,
        title: str = "Active Score",
        part_name: str = "Vocal Part",
        key_signature: Optional[Dict[str, Any]] = None,
        time_signature: Optional[Dict[str, Any]] = None,
        notes: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Answers a learner's spoken (AssemblyAI-transcribed) or typed music-learning question
        grounded strictly in the validated score's notes, solfa, key, and rhythm.
        """
        clean_q = (question or "").strip()
        if not clean_q:
            raise ValueError("Please provide a question for the ChoirMate AI music coach.")

        notes_list = notes or []
        sung_notes = [n for n in notes_list if not n.get("isRest", False) and float(n.get("frequency") or 0) > 0]
        rest_notes = [n for n in notes_list if n.get("isRest", False)]
        key_name = (key_signature or {}).get("key", "C Major")
        home_note = (key_signature or {}).get("homeNote", "C")
        num = (time_signature or {}).get("numerator", 4)
        den = (time_signature or {}).get("denominator", 4)

        if sung_notes:
            first_n = sung_notes[0]
            last_n = sung_notes[-1]
            low_n = min(sung_notes, key=lambda x: float(x.get("frequency") or 9999))
            high_n = max(sung_notes, key=lambda x: float(x.get("frequency") or 0))
            solfa_preview = " - ".join(f"{n.get('solfa')}({n.get('pitch')})" for n in sung_notes[:12])
        else:
            first_n = {"solfa": "Do", "pitch": "C4"}
            last_n = {"solfa": "Do", "pitch": "C4"}
            low_n = {"solfa": "Do", "pitch": "C4"}
            high_n = {"solfa": "Do", "pitch": "C4"}
            solfa_preview = "No pitched notes"

        measures_set = sorted({int(n.get("measure", 1)) for n in notes_list}) if notes_list else [1]
        total_measures = len(measures_set)

        ai_answer: Optional[str] = None
        if self.llm is not None:
            prompt = f"""<|im_start|>system
You are ChoirMate AI's supportive choral coach. Answer the student's question in 2-4 concise, encouraging sentences using ONLY the verified score facts below. Never invent notes.<|im_end|>
<|im_start|>user
Piece: {title} ({part_name})
Key: {key_name} (Movable-Do tonic Do = {home_note})
Time Signature: {num}/{den} ({total_measures} measures, {len(sung_notes)} sung notes, {len(rest_notes)} rests)
Vocal Range: {low_n.get('pitch')} ({low_n.get('solfa')}) up to {high_n.get('pitch')} ({high_n.get('solfa')})
Opening Sequence: {solfa_preview}

Student Question: {clean_q}<|im_end|>
<|im_start|>assistant
"""
            try:
                with self._lock:
                    self.llm.reset()
                    out = self.llm(prompt, max_tokens=180, stop=["<|im_end|>"], temperature=0.25)
                    candidate = out["choices"][0]["text"].strip()
                    if len(candidate) > 15:
                        ai_answer = candidate
            except Exception as exc:
                sys.stderr.write(f"[SmolLM2Teacher] Q&A inference fallback: {exc}\n")

        if not ai_answer:
            q_lower = clean_q.lower()
            if any(k in q_lower for k in ("key", "do", "tonality", "scale", "sharp", "flat")):
                ai_answer = (
                    f"This part ({part_name}) of '{title}' is in {key_name}, where Movable-Do 'Do' is anchored on {home_note}. "
                    f"Your melody opens on {first_n.get('solfa')} ({first_n.get('pitch')}) and resolves on {last_n.get('solfa')} ({last_n.get('pitch')}). "
                    f"Before singing, play the {home_note} reference pitch so your ear locks into the tonal center."
                )
            elif any(k in q_lower for k in ("rhythm", "count", "beat", "tempo", "time", "rest", "meter")):
                ai_answer = (
                    f"'{title}' is in {num}/{den} time across {total_measures} measure{'s' if total_measures != 1 else ''}, "
                    f"meaning you count {num} steady beats per bar ({' - '.join(str(i+1) for i in range(num))}). "
                    f"There are {len(rest_notes)} rest event{'s' if len(rest_notes) != 1 else ''} in {part_name}—use those silent beats to take a relaxed diaphragmatic breath."
                )
            elif any(k in q_lower for k in ("high", "low", "range", "interval", "hard", "difficult", "leap", "pitch")):
                ai_answer = (
                    f"For {part_name}, the vocal range spans from {low_n.get('pitch')} ({low_n.get('solfa')}) up to {high_n.get('pitch')} ({high_n.get('solfa')}). "
                    f"The opening phrase moves through {solfa_preview}. "
                    f"Keep your soft palate lifted as you approach {high_n.get('pitch')} ({high_n.get('solfa')}) and use the Loop Section control to drill tricky transitions."
                )
            else:
                ai_answer = (
                    f"In '{title}' ({part_name}, {key_name}, {num}/{den} meter), you have {len(sung_notes)} sung notes and {len(rest_notes)} rests across {total_measures} measures. "
                    f"Start by chanting the opening Solfa sequence ({solfa_preview}) in steady rhythm, then sing along with the synthesized reference audio at a comfortable tempo."
                )

        return {
            "answer": ai_answer,
            "model": "SmolLM2-360M-Instruct-GGUF",
            "isLocalAi": bool(self.llm is not None),
            "groundedFacts": {
                "title": title,
                "partName": part_name,
                "key": key_name,
                "timeSignature": f"{num}/{den}",
                "lowestNote": f"{low_n.get('pitch')} ({low_n.get('solfa')})",
                "highestNote": f"{high_n.get('pitch')} ({high_n.get('solfa')})",
                "sungNotes": len(sung_notes),
                "rests": len(rest_notes),
            },
        }

