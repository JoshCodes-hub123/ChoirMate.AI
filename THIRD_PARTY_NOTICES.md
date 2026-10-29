# Third-Party Notices and Acknowledgements

ChoirMate AI incorporates and relies on the following open-source libraries, open-weight models, and system utilities. We gratefully acknowledge the authors and communities behind these works.

---

### 1. Open-Weight Language Model: SmolLM2-360M-Instruct
- **Identifier**: `HuggingFaceTB/SmolLM2-360M-Instruct`
- **GGUF Quantization**: `bartowski/SmolLM2-360M-Instruct-GGUF` (file: `SmolLM2-360M-Instruct-Q4_K_M.gguf`)
- **Author**: Hugging Face / Loubna Ben Allal, Anton Lozhkov, Elie Bakouch, Gabriel Martin Blazquez, Lewis Tunstall, Leandro von Werra
- **License**: Apache License 2.0 (Apache-2.0)
- **Role in ChoirMate AI**: Text-only musicological explanation and sight-reading coaching based strictly on validated, parsed MusicXML facts. It does not inspect images or perform optical recognition.
- **Notice**: Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0

---

### 2. Optical Music Recognition: HOMR (oemer)
- **Identifier**: `homr` (version 0.6.2) / `oemer`
- **Repository**: https://github.com/BreezeWhite/oemer
- **Author**: BreezeWhite (Tsung-Ping Chen)
- **License**: GNU General Public License v3.0 (GPL-3.0)
- **Role in ChoirMate AI**: End-to-end Optical Music Recognition (OMR) system that analyzes printed staff lines, clefs, noteheads, and measures to generate structured MusicXML.
- **Notice**: This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

---

### 3. Local Model Runtime: llama-cpp-python
- **Repository**: https://github.com/abetlen/llama-cpp-python
- **Author**: Andrei Betlen
- **License**: MIT License
- **Role in ChoirMate AI**: Provides in-process CPU inference bindings for the SmolLM2 GGUF model in Python without requiring GPU resources.

---

### 4. PDF Rendering: pypdfium2
- **Repository**: https://github.com/pypdfium2-team/pypdfium2
- **License**: Apache-2.0 or BSD-3-Clause
- **Role in ChoirMate AI**: Fast, high-fidelity PDF page rendering and thumbnail generation for multi-page sheet music documents.

---

### 5. Music Theory & MusicXML Parsing: music21
- **Repository**: https://github.com/cuthbertLab/music21
- **Author**: Michael Scott Cuthbert and contributors (MIT)
- **License**: BSD 3-Clause License
- **Role in ChoirMate AI**: Musical stream representation, transposition, key signature deduction, and MusicXML serialization.

---

### 6. Media Encoding: FFmpeg
- **Website**: https://ffmpeg.org
- **License**: LGPL-2.1+ / GPL-2.0+ (depending on build flags; libmp3lame is LGPL/GPL)
- **Role in ChoirMate AI**: Server-side encoding of 44.1 kHz 16-bit PCM WAV into genuine MPEG Layer-3 (`.mp3`) practice audio files.

---

### 7. Frontend Framework & UI Libraries
- **React**: MIT License (Meta Platforms, Inc.)
- **Vite**: MIT License (Evan You & Vite Contributors)
- **Tailwind CSS**: MIT License (Tailwind Labs, Inc.)
- **Lucide React**: ISC License (Lucide Contributors)

---

### 8. Cloud Voice Transcription: AssemblyAI (Optional Integration)
- **Provider**: AssemblyAI Inc.
- **Service**: Speech-to-Text REST API (`/v2/upload` + `/v2/transcript`)
- **Usage**: Used strictly on the backend to transcribe user-recorded voice questions and rehearsal reflections into text. Requires explicit user consent before audio transmission. Core OMR, note editing, Solfa decoding, audio synthesis, and typed SmolLM2 coaching do not require AssemblyAI and run 100% locally.

---

### 9. AI-Assisted Development Disclosure
ChoirMate AI was developed with the assistance of Google AI Studio Build agents. The project architecture, safety boundaries, prompt engineering, test suites, and integration logic were iteratively tested, audited, and verified by human software engineers.
