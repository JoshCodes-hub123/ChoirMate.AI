# OPEN//BUILD 2026 Pitch Deck: ChoirMate AI

**Theme:** "AI belongs to everyone."  
**Submission Deadline:** Thursday, October 29, 2026 at 11:59 PM WAT  
**Repository:** [https://github.com/JoshCodes-hub123/ChoirMate.AI](https://github.com/JoshCodes-hub123/ChoirMate.AI)  
**Live Application Preview:** [https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app](https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app)  
**Team:** Abayomi Joshua O. & Adam Lawal (Federal University of Technology, Akure - FUTA)

---

## Slide 1 — The Vision
- **Title:** ChoirMate AI
- **Subtitle:** Making music easier to read, understand, and sing.
- **Visual Direction:** A cinematic, authentic photograph of a community church choir rehearsal in a warm wood-paneled room. Diverse choir members holding printed sheet music with genuine concentration. Warm natural lighting, editorial style, warm ivory and deep charcoal color grading.
- **Speaker Notes (Abayomi's Voice):**
  > "Hello judges and fellow builders. My name is Abayomi Joshua O., building alongside my teammate Adam Lawal from the Federal University of Technology, Akure. For our OPEN//BUILD 2026 submission, we created ChoirMate AI because we believe AI belongs to everyone—especially singers in community and church choirs who love music deeply but struggle to decode traditional sheet music notation."

---

## Slide 2 — The Problem Behind the Music
- **Title:** Loving to sing is not the same as knowing how to read music.
- **Subtitle:** The barrier between passion and independent rehearsal.
- **Visual Direction:** A close-up of a real musical score on a music stand, with a singer's hand following a line of notes. Plausible musical notation, soft focus, warm lighting.
- **Speaker Notes (Abayomi's Voice):**
  > "This challenge is personal. In many community choirs across Nigeria and around the world, singers receive complex choral sheets during weekly rehearsals. If you cannot read notes, you are forced to rely on rote learning—recording the choir master's piano on your phone or guessing your parts at home. The problem isn't talent or passion; it's the lack of accessible, personalized music learning support."

---

## Slide 3 — Our Solution
- **Title:** From unfamiliar notes to guided practice.
- **Subtitle:** An end-to-end workflow designed for the modern choir member.
- **Visual Direction:** A clean 4-step conceptual workflow diagram showing: (1) Upload Score (PDF/image) -> (2) HOMR Optical Music Recognition -> (3) Movable-Do Solfa Mapping -> (4) Audio Synthesis & AI Coaching.
- **Speaker Notes (Abayomi's Voice):**
  > "ChoirMate AI solves this through a clean four-step workflow. Users upload a PDF score or scan. Our backend processes it using HOMR optical music recognition, maps the notes into Movable-Do Solfa syllables across SATB voice parts, allows interactive note editing, and generates downloadable practice MP3s alongside grounded AI coaching."

---

## Slide 4 — How the Technology Works
- **Title:** A music-learning pipeline, not just a chatbot.
- **Subtitle:** Separating computer vision, music theory, and language generation.
- **Visual Direction:** A clear technical block diagram showing the data flow from React Frontend -> Node.js Express Gateway -> Python FastAPI backend (HOMR OMR + music21 theory engine + SciPy audio synthesis + SmolLM2 local inference).
- **Speaker Notes (Abayomi's Voice):**
  > "Architecturally, we deliberately separate concerns. We don't rely on a chatbot to guess musical notes. Computer vision via HOMR handles visual parsing; deterministic Python libraries like music21 handle music theory and Solfa calculations; and our compact open-weight language model explains theory and answers user questions."

---

## Slide 5 — Our Open-Weight AI Decision
- **Title:** Small model. Deliberate architecture.
- **Subtitle:** Why we chose SmolLM2-360M-Instruct in GGUF format.
- **Visual Direction:** A clean split layout comparing the lightweight efficiency of SmolLM2-360M on CPU (<300MB RAM) with the strict separation of deterministic music processing pipelines.
- **Speaker Notes (Abayomi's Voice):**
  > "We chose bartowski/SmolLM2-360M-Instruct-GGUF because it fits our ethos: lightweight, self-hosted, and efficient. It runs smoothly on standard CPU instances without hefty cloud GPU costs. We are transparent about its limitations—it provides pedagogical coaching, while our deterministic Python music-theory pipeline guarantees exact musical correctness."

---

## Slide 6 — Building Through Real Engineering Challenges
- **Title:** Making the prototype work beyond the development environment.
- **Subtitle:** Overcoming real infrastructure challenges on Cloud Run.
- **Visual Direction:** An editorial timeline or code-architecture visual illustrating process decoupling, port binding timeout fixes, and fallback handlers.
- **Speaker Notes (Abayomi's Voice):**
  > "Building a hybrid Node/Python app in serverless containers taught us valuable engineering lessons. We tackled port timeout issues caused by synchronous startup, resolved Python executable paths (`ENOENT`), and implemented robust fallback handlers. This ensures the app remains stable and responsive under all conditions."

---

## Slide 7 — The Future and Invitation
- **Title:** Every singer deserves a way to learn.
- **Subtitle:** Help us make music easier to read, understand, and sing.
- **Visual Direction:** A minimal closing visual of musical notation flowing into a choir singing together, symbolizing accessibility and shared musical understanding.
- **Speaker Notes (Abayomi's Voice):**
  > "In closing, every singer deserves a way to learn. ChoirMate AI bridges the gap between printed notation and independent musical confidence. Check out our GitHub repository and live demonstration. Thank you for your time, and help us make music easier to read, understand, and sing."
