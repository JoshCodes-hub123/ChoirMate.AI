# ChoirMate AI — Project Story

## OPEN//BUILD 2026 | “AI belongs to everyone.”

### One-Sentence Pitch
ChoirMate AI is an open-source, open-weight music-learning companion that empowers beginner singers and community choir members to transform printed sheet music and multi-page PDFs into understandable notes, Movable-Do Solfa, interactive correction, downloadable practice audio, and patient AI coaching.

---

### The Problem We Are Solving
A printed choir score can feel like an intimidating wall of symbols to someone who is still learning to read music notation. A beginner sees five staff lines, clefs, accidentals, noteheads, rests, key signatures, and time signatures without knowing what pitch to sing or how to count the rhythm.

In community and church choirs, this creates a major rehearsal barrier:
- Singers want to prepare at home between rehearsals, but without a piano or a vocal coach beside them, they get stuck on unfamiliar intervals or complex rhythms.
- Existing commercial music software (Sibelius, Finale, Dorico) is expensive, desktop-only, and built for professional composers, not everyday learners.
- Generic AI chatbots hallucinate melodies or invent notes because they cannot visually read notation or understand musical pitch systems.

The obstacle is not a lack of musical passion or willingness to practise. It is the gap between written musical notation and an approachable, honest explanation that a beginner can immediately act upon.

---

### Our Idea & Architecture
ChoirMate AI was created to make that first step welcoming and practical. Instead of leaving a singer alone with an intimidating page, it guides them through an honest, structured pipeline:

1. **Intake Multi-Page PDF & Image Scores**: Accept complete single-page or multi-page PDF documents, PNG/JPG scans, or MusicXML files. The original score is preserved page-by-page so the learner always has their authentic reference.
2. **Optical Music Recognition (HOMR)**: Use open-weight deep neural networks to detect staff lines, clefs, noteheads, and measures in reading order.
3. **Deterministic Music Theory Processing (music21)**: Map note frequencies, time signatures, key signatures, and Movable-Do Solfa syllables (Do, Re, Mi, Fa, Sol, La, Ti) across SATB parts without language-model guesswork.
4. **Interactive Note Review & Recalculation**: If an accidental or rhythm is misread or unclear, the singer can edit the note directly and recalculate the score in real time.
5. **Downloadable Practice Audio (`MP3` & `WAV`)**: Synthesize high-quality practice audio (`Choir Synth`, `Piano`, or `Strings`) matching all note corrections and export genuine MP3 (via FFmpeg) or WAV files to take on their phone.
6. **Open-Weight AI Vocal Coach (SmolLM2-360M-Instruct)**: Explain the score's essence, vocal range, and rhythm counting in plain language, and answer learner questions grounded strictly in validated score facts.
7. **Optional Voice Q&A (AssemblyAI)**: Singers can speak their rehearsal questions, transcribe them via AssemblyAI with explicit consent, and receive grounded answers from the local coach.

---

### Why This Fits “AI Belongs to Everyone”
Artificial intelligence should not only benefit prompt engineers, corporate executives, or professional software developers. It should empower ordinary people learning a human craft—like singing in harmony with their neighbors.

By keeping the core architecture open-weight, locally runnable on modest CPU hardware, and free of proprietary paywalls, ChoirMate AI democratizes musical literacy for choral singers everywhere.

---

### What Makes the Technical Decisions Meaningful
The core technical principle of ChoirMate AI is the **strict separation of responsibilities**:

- **HOMR** handles computer vision: detecting staves, clefs, noteheads, and accidentals to output structured MusicXML.
- **music21 & deterministic algorithms** calculate intervals, frequencies, measure beat sums, and Movable-Do Solfa.
- **FFmpeg & Web Audio** synthesize and encode audio tracks from validated musical events.
- **SmolLM2-360M-Instruct-GGUF** handles language coaching: it receives structured musical facts (key, tonality, vocal range, note count, solfa syllables, rhythm patterns) and generates supportive pedagogical guidance.

**SmolLM2 is never described as an image model.** It does not inspect raw pixels. This architectural clarity eliminates hallucinations, makes the system debuggable, and ensures every note played or explained is grounded in reality.

---

### Completed Capabilities vs. Future Roadmap

#### Completed & Verified Capabilities
- Full single-page and multi-page PDF sheet music processing (up to 12 pages / 25 MB).
- Multi-page document preview with high-resolution page thumbnails.
- HOMR optical music recognition pipeline across multiple systems, staves, and SATB vocal parts.
- Preservation of original score reference alongside reconstructed interactive notation staves.
- Movable-Do Solfa syllable mapping anchored to key signatures.
- Interactive note review table with real-time recalculation of pitches, solfa, and measure beat validation.
- Genuine MP3 practice audio export encoded via FFmpeg (`libmp3lame`) with meaningful filenames.
- 44.1 kHz 16-bit PCM WAV audio export for full scores and selected practice sections.
- Full playback transport controls: Play, Pause, Resume, Restart, Stop, Loop Section, Tempo slider, Metronome click, and Voice instrument switcher.
- Responsible AssemblyAI speech-to-text integration with explicit user consent.
- Local SmolLM2-360M-Instruct-GGUF text and voice Q&A grounded in active score data.
- 100% offline fallback: typed Q&A, playback, solfa, and audio export work with zero external API keys.

#### Future Roadmap
- Direct camera capture with real-time framing and glare detection on mobile.
- Polyphonic multi-part simultaneous audio mixing (e.g., mute your own part while other choir parts sing harmony).
- Lyric alignment and syllabic text-to-solfa synchronizer.

---

### Open Source, Licensing & Acknowledgements
- **ChoirMate AI**: Licensed under the GNU General Public License v3.0 (GPL-3.0).
- **SmolLM2-360M-Instruct**: Apache-2.0 (Hugging Face).
- **HOMR (oemer)**: GPL-3.0 (BreezeWhite).
- **llama-cpp-python**: MIT License (Andrei Betlen).
- **pypdfium2**: Apache-2.0 / BSD-3-Clause.
- **music21**: BSD-3-Clause (Michael Scott Cuthbert).
- **FFmpeg**: LGPL-2.1+ / GPL-2.0+.

Developed with the assistance of Google AI Studio Build agents and audited by human software engineers for OPEN//BUILD 2026.
