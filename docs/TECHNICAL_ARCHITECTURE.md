# Technical Architecture: ChoirMate AI

**OPEN//BUILD 2026 Submission | Theme: "AI belongs to everyone."**  
**Team:** Abayomi Joshua O. & Adam Lawal (Federal University of Technology, Akure - FUTA)  
**Repository:** [https://github.com/JoshCodes-hub123/ChoirMate.AI](https://github.com/JoshCodes-hub123/ChoirMate.AI)  
**Live Application:** [https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app](https://ais-pre-647inpvrvo4qp5v32ic7hu-664748108050.europe-west2.run.app)

---

## 1. Architectural Overview

ChoirMate AI is engineered as a robust hybrid web application combining a responsive React client interface with a dual-tier backend consisting of a Node.js Express gateway (`server.ts`) and a specialized Python FastAPI microservice (`python/service.py`). 

This separation of concerns ensures that high-performance UI rendering, state management, and Web Audio playback happen instantly on the client, while compute-intensive Optical Music Recognition (OMR), music theory calculations, waveform synthesis, and open-weight LLM inference run securely in a Python container environment with graceful Node.js fallbacks.

---

## 2. Complete System Architecture (Mermaid Diagram)

```mermaid
graph TD
    subgraph Browser Client (React 19 & TypeScript)
        UI[ChoirMate Conservatory UI]
        ScoreViewer[Interactive Score & Stave Viewer]
        AudioEngine[Web Audio API Player]
        VoiceInput[Voice Q&A Recording]
    end

    subgraph Node.js Express Gateway (server.ts)
        Server[Express HTTP Server on PORT 3000]
        Static[Static Frontend Asset Serving]
        Proxy[API Proxy & Subprocess Orchestration]
        NodeFallback[Deterministic Node.js Fallback Engine]
    end

    subgraph Python FastAPI Microservice (python/service.py on port 5001)
        FastAPI[FastAPI Router]
        OMR[HOMR Optical Music Recognition Engine]
        Parser[music21 Music Theory Parser & Movable-Do Generator]
        Synth[SciPy / NumPy Polyphonic Audio Synthesizer]
        FFmpeg[/usr/bin/ffmpeg libmp3lame Encoder]
        LLM[SmolLM2-360M-Instruct-GGUF Local CPU LLM]
    end

    subgraph External & Cloud Services
        AssemblyAI[AssemblyAI Speech-to-Text API (Optional, Explicit Consent)]
        CloudRun[Google Cloud Run Container Deployment]
    end

    %% Flow Connections
    UI -->|HTTP / JSON / FormData| Server
    Server -->|Proxy Request| FastAPI
    Server -->|Subprocess Launch / Fallback| NodeFallback
    
    FastAPI --> OMR
    FastAPI --> Parser
    FastAPI --> Synth
    FastAPI --> LLM

    Synth --> FFmpeg --> FastAPI --> Server --> UI
    OMR --> Parser --> FastAPI
    LLM --> FastAPI

    VoiceInput -->|Audio Blob| Server -->|Optional STT| AssemblyAI --> Server --> LLM
    
    CloudRun --> Server
    CloudRun --> FastAPI
```

---

## 3. Core Component Breakdown

### A. Frontend Client (`src/`)
- **React 19 & TypeScript:** Provides strongly-typed state management for sheet uploads, part selection (Soprano, Alto, Tenor, Bass), interactive note editing, and rehearsal sessions.
- **Tailwind CSS:** Delivers a polished conservatory design system with high-contrast notation views, accessible typography, and zero-clutter layouts.
- **Web Audio API:** Enables real-time browser playback of synthesized choir parts, metronome clicks, and pitch reference tones.

### B. Node.js Express Gateway (`server.ts`)
- **Port Binding & Cloud Run Readiness:** Explicitly listens on `process.env.PORT || 3000` and binds to `0.0.0.0`, satisfying Google Cloud Run health-check requirements.
- **Subprocess Orchestration:** Spawns and supervises the Python FastAPI service on port `5001`.
- **Resilient Fallback Engine:** If the Python subprocess encounters startup constraints (such as missing Python dependencies or sandbox limitations), the Node.js server seamlessly invokes built-in deterministic parsers and pre-rendered sample score analysis, guaranteeing 100% uptime and zero unhandled server crashes.

### C. Python Processing Microservice (`python/service.py`)
- **HOMR OMR Engine:** Ingests PDF pages (`pypdfium2`), normalizes images, and performs deep neural vision recognition to extract staves, clefs, time signatures, key signatures, noteheads, and rests into standardized MusicXML data structures.
- **`music21` Music Theory Parser:** Analyzes pitch classes, intervals, key signatures, and rhythmic values to automatically generate Movable-Do Solfa syllables (*Do, Re, Mi, Fa, Sol, La, Ti*) mapped precisely to the correct tonic.
- **Polyphonic Waveform Synthesizer:** Converts parsed MIDI note events into raw PCM audio streams using NumPy and SciPy, piped through `/usr/bin/ffmpeg` with `libmp3lame` encoding to generate pristine `MP3` and `WAV` practice files for individual SATB voice parts.
- **Local AI Coach (`SmolLM2-360M-Instruct-GGUF`):** Runs `bartowski/SmolLM2-360M-Instruct-GGUF` (4-bit quantized Q4_K_M) locally via `llama-cpp-python` on CPU. It provides grounded pedagogical explanations of rhythm, harmony, and vocal technique without requiring external proprietary API keys.

---

## 4. End-to-End Sheet Music Processing Workflow

1. **Intake & Upload:** The user uploads a multi-page PDF choir score, PNG/JPG scan, or MusicXML file via the React drag-and-drop studio interface.
2. **Gateway Forwarding:** The React client sends a `multipart/form-data` POST request to `/api/analyze-sheet` on the Express server.
3. **OMR Vision Analysis:** Express proxies the payload to the Python FastAPI microservice. HOMR converts PDF pages to high-resolution images and detects musical symbols and stave lines.
4. **Theory Calculation:** `music21` processes the extracted notes, computes time and key signatures, assigns Movable-Do Solfa syllables, and separates SATB vocal parts.
5. **AI Coaching Contextualization:** SmolLM2 analyzes the score's key, range, and rhythmic structure to formulate a personalized practice summary and coach response.
6. **Audio Export Generation:** SciPy and FFmpeg synthesize downloadable MP3/WAV rehearsal tracks for each voice part.
7. **Studio Render:** JSON results are returned to the React frontend, rendering the interactive score viewer, solfa breakdown, AI coach chat, and audio practice players.

---

## 5. Security, Privacy, and Error Handling

- **Zero-Data Leakage:** Core OMR and LLM inference run entirely locally within the container. No sheet music or user practice data is sent to external cloud LLM providers.
- **Optional Voice Q&A:** Voice queries are processed via AssemblyAI strictly with explicit user consent (`[X] Voice Consent Enabled`). If consent is disabled, the system defaults to secure text chat.
- **Graceful Error Recovery:** Robust try/catch blocks across Express and FastAPI ensure that if an invalid file format or processing timeout occurs, structured error JSON is returned with actionable user remediation steps rather than stack traces or 500 crashes.

---

## 6. Deployment Architecture

- **Multi-Stage Dockerfile:** Packages Node.js, Python 3, FastAPI, HOMR, music21, ffmpeg, and the SmolLM2 GGUF model weights into a single optimized Linux container image.
- **Google Cloud Run:** Deployed as a fully managed serverless container service with automatic scale-to-zero, secure HTTPS termination, and 3000 port binding.
