# ChoirMate AI — Judge & Evaluator Demo Guide

**OPEN//BUILD 2026 Presentation & Demonstration Flow**  
Target Duration: 3-Minute Presentation + 5-Minute Live Interactive Demonstration

---

## Part 1: 3-Minute Presentation

### 0:00–0:40 — The Problem & Purpose
> “Printed sheet music can feel like an intimidating wall of symbols for a beginner singer. In community and school choirs, singers often struggle to practise independently because they cannot decode staff notes, solfa syllables, or tricky rhythms on their own.”
> 
> “ChoirMate AI is an open-source, open-weight platform built to transform printed choir scores and multi-page PDFs into clear Solfa guidance, patient AI vocal coaching, and downloadable rehearsal audio tracks.”

### 0:40–1:30 — The Open-Weight Architecture Difference
> “Most AI demos show a general-purpose chatbot or a model guessing melodies from a prompt. ChoirMate AI takes a rigorous, trustworthy approach by separating responsibilities:
> 
> 1. **HOMR (Optical Music Recognition)** detects physical staff lines, clefs, noteheads, and measures from scanned PDFs or images to generate structured MusicXML.
> 2. **Deterministic Music Theory (music21)** calculates exact frequencies, measure beat sums, and Movable-Do Solfa syllables (Do, Re, Mi) across SATB vocal parts.
> 3. **SmolLM2-360M-Instruct-GGUF** runs locally on CPU via `llama-cpp-python`. It is not an image model—it acts strictly as the choir director, explaining the structured musical facts in plain language and answering learner questions so it never hallucinates notes.
> 4. **FFmpeg & Web Audio** synthesize genuine MP3 and WAV rehearsal tracks matching any note corrections made by the singer.”

### 1:30–2:20 — Core Innovation Highlights
> - **Full Multi-Page PDF & Image Support**: Upload multi-page choral scores (up to 12 pages / 25 MB) with page thumbnail previews.
> - **Original Score Preserved**: The uploaded score is displayed alongside the interactive notation stave so singers never lose their authentic reference.
> - **Interactive Note Review**: Edit misread notes or accidentals directly with instant recalculation.
> - **Take-Home Audio**: Download MP3 and WAV files with custom tempo, metronome click, and meaningful filenames for mobile rehearsal.
> - **Responsible Speech-to-Text**: Optional AssemblyAI integration for spoken rehearsal Q&A with explicit user consent and 100% offline fallback.

### 2:20–3:00 — Alignment with “AI Belongs to Everyone” & Closing
> “By relying on open-weight models that run locally on standard CPU hardware without proprietary cloud subscriptions, ChoirMate AI democratizes musical literacy for choral singers everywhere.”

---

## Part 2: 5-Minute Live Interactive Demonstration

### Step 1: Open Studio Home & Review Architecture (0:00–0:45)
1. Open the application at [http://localhost:3000](http://localhost:3000) (or live preview URL).
2. Point out the top conservatory navigation bar: **Studio Home**, **Upload Score**, **Learn & Audio**, and **Practice Coach**.
3. Highlight the 4-step workflow: Full-Document OMR -> Solfa & Note Review -> Take-Home Audio -> Pitch & Voice Coach.

### Step 2: Upload a Score or Open Sample Hymn (0:45–1:45)
1. Click **Upload Score** or **Open Sample Hymn & Export Audio**.
2. To demonstrate PDF intake: drop a multi-page PDF document. Point out the page thumbnails, page count indicator, and rotation/contrast validation.
3. Click **Analyze Full Score**. Point out that the system recognizes all staves, measures, and parts without forcing manual line-by-line cropping.

### Step 3: Explore Solfa, Synchronized Staves & Audio Playback (1:45–2:45)
1. In **Learn & Audio**:
   - Point out the **Key Signature** (e.g., F Major), **Movable-Do Solfa** anchor, and vocal part switcher (Soprano / Alto / Tenor / Bass).
   - Point out the **Original Score Reference** on the left and the **Reconstructed Interactive Notation Stave** on the right.
   - Click a detected system on the original sheet music: notice how the interactive stave and note inspector jump to that exact measure and staff.
   - Click **Play Reference** on the Practice Audio Bar: listen to the synthesized reference tone with animated event-by-event progress.
   - Demonstrate **Pause**, **Resume**, **Restart**, and **Loop Section**.

### Step 4: Demonstrate Note Correction & Recalculation (2:45–3:30)
1. Click **Review & Correct Notes** to open the interactive note review table.
2. Edit a note (e.g., change note 1 from `C4` to `G4`).
3. Click **Apply Corrections & Regenerate Lesson**.
4. Show that the Solfa syllable instantly recomputes to `Sol`, the audio playback updates to play `G4`, and SmolLM2 updates its guidance.

### Step 5: Download Practice Audio (MP3 & WAV) (3:30–4:15)
1. In the Practice Audio Bar, toggle between **Entire Vocal Part** and **Selected Section**.
2. Click **Download MP3**: show the browser downloading a genuine MP3 file with a descriptive name (e.g., `amazing-grace_soprano_full-song_88bpm.mp3`).
3. Click **Download WAV**: show the clean uncompressed 44.1 kHz WAV download.
4. Point out the honest notice: *Synthesized instrumental/choral reference audio generated from validated notation*.

### Step 6: Test AI Coaching & Voice Q&A (4:15–5:00)
1. Scroll to **Ask Your Choir Coach**:
   - Point out the privacy notice: speech transcription requires explicit consent; pitch detection and SmolLM2 run locally.
   - If `ASSEMBLYAI_API_KEY` is configured: check the consent box, click **Ask by Voice**, speak a question (*"What is my vocal range?"*), and show the transcribed text and SmolLM2 answer.
   - If `ASSEMBLYAI_API_KEY` is not set: click a quick preset (*"What is my vocal range and opening Solfa sequence?"*) or type a question: show SmolLM2 answering in 2 seconds using verified score facts.

---

## Contingency Guidance
- If live OMR of an external user scan is blurry or unreadable, the application surfaces an honest error banner identifying the issue. Switch smoothly to a sample hymn (e.g., *Amazing Grace*) to demonstrate the downstream Solfa, audio export, and coaching workflow.
