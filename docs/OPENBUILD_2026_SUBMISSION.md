# OFFICIAL OPEN//BUILD 2026 SUBMISSION: ChoirMate AI

**Theme:** "AI belongs to everyone."  
**Submission Deadline:** Thursday, October 29, 2026 at 11:59 PM WAT  
**Repository:** [https://github.com/JoshCodes-hub123/ChoirMate.AI](https://github.com/JoshCodes-hub123/ChoirMate.AI)  
**Live Application Preview:** [https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app](https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app)  
**License:** GNU General Public License v3.0 (GPL-3.0)

---

## 1. Project Title & Tagline

- **Project Name:** ChoirMate AI
- **Tagline:** Open-Weight Sheet Music OMR, Solfa Tutor & Practice Audio Studio for Community Choirs and Beginner Musicians.

---

## 2. Team Details

- **Abayomi Joshua O.** — Lead Student Developer & AI/Backend Engineer (Federal University of Technology, Akure - FUTA)
- **Adam Lawal** — Co-Developer & Music Theory / Audio Processing Integrator (Federal University of Technology, Akure - FUTA)

---

## 3. Problem Statement

Imagine a church choir member who genuinely loves singing but cannot confidently read traditional musical notation. During weekly rehearsals, the choir director distributes a complex four-part score and instructs everyone to go home and practise their voice parts. For someone who cannot decipher clefs, accidentals, key signatures, or dotted rhythms, that instruction can feel overwhelming.

In many community and church choirs across Nigeria and beyond:
1. **The Rote Learning Bottleneck:** Singers must record the choir master's piano playback on mobile phones or rely on section leaders to teach notes by ear note-for-note.
2. **The Notation Barrier:** Traditional scores (staff notation) intimidate beginners who understand melodies intuitively but cannot connect staves to Movable-Do Solfa syllables (*Do, Re, Mi, Fa, Sol, La, Ti*).
3. **Practice Isolation:** At home, singers practice alone without feedback on pitch accuracy, rhythm, or harmony blending, leading to disjointed sectional rehearsals and delayed concert readiness.

ChoirMate AI ensures that **AI belongs to everyone** by removing these barriers—democratizing choral music literacy with local open-weights optical music recognition and interactive audio tutoring.

---

## 4. Solution Description & Key Features

ChoirMate AI is an end-to-end choral practice workstation that transforms printed or scanned choir sheets into accessible, interactive learning materials:

1. **HOMR Full-Score Optical Music Recognition (OMR):**
   - Ingests multi-page PDF scores, PNG/JPG scans, or MusicXML files.
   - Extracts staves, clefs, time signatures, key signatures, noteheads, and rests with neural vision models.
2. **Movable-Do Solfa & Voice Part Breakdown:**
   - Automatically transcribes notes into Movable-Do Solfa syllables mapped precisely to the score's tonic.
   - Separates and highlights Soprano, Alto, Tenor, and Bass (SATB) vocal parts.
3. **Interactive Notation Editor & Real-Time Corrections:**
   - Allows choir members or directors to click and inspect any recognized note, accidental, or rhythm value, making instant corrections with automatic musical recalculation.
4. **Downloadable Practice Audio (`MP3` & `WAV`):**
   - Synthesizes polyphonic multi-part rehearsal audio (`choir`, `piano`, `strings`) exported via FFmpeg with crisp `libmp3lame` encoding at 44.1 kHz.
   - Allows section leaders or solo singers to download custom audio files for offline practice.
5. **Grounded AI Vocal Coaching (SmolLM2-360M-Instruct-GGUF):**
   - Powered by a local open-weight **SmolLM2-360M-Instruct-GGUF** model running via `llama-cpp-python` on CPU.
   - Explains musical structure, vocal range, rhythm counting patterns, and answers questions with grounded notation facts.
   - Supports voice-to-text queries via AssemblyAI (with explicit user consent).

---

## 5. Technology Stack & Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Vite 8, Web Audio API.
- **Backend / Server:** Node.js Express 4 (`server.ts`) handling proxy routes, static bundles, and child-process orchestration.
- **Python OMR & Inference Service:** FastAPI (`python/service.py`) running HOMR, `pypdfium2`, `music21`, `scipy`/`numpy`, and `llama-cpp-python`.
- **Deployment & Infrastructure:** Dockerized multi-stage container running on Google Cloud Run with robust Python subprocess error-handling and fallback engines.

---

## 6. Open-Weight AI Integration Details

- **Model:** `bartowski/SmolLM2-360M-Instruct-GGUF` (`SmolLM2-360M-Instruct-Q4_K_M.gguf`)
- **Hosting & Inference:** Runs entirely locally within the container or fallback Node.js runtime using 4-bit quantization, ensuring low memory footprint (<300MB RAM) and zero dependency on closed-source APIs for core music intelligence.
- **OMR Engine:** HOMR (Full-Score Optical Music Recognition) combined with deterministic `music21` parsing for mathematically sound music theory conversions.

---

## 7. Verification & Live Status

- **Build Status:** Passing TypeScript compilation (`tsc --noEmit`), Vite production build, and `npm ci` lockfile verification.
- **Live Deployment:** Fully operational on Google Cloud Run (`https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app`).
