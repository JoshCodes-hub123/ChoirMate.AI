"""
ChoirMate AI - Camber batch worker.

This worker reuses the repository's existing HOMR, MusicXML, teaching,
and audio modules. It does not start a public web server or submit jobs.

Input: one PDF, PNG, or JPG file available in the job's local filesystem.
Output: result.json, recognized.musicxml, and a practice audio file.
"""

import argparse
import base64
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from omr_engine import recognize_score_pages
from pdf_processor import render_pdf_document
from music_theory import parse_musicxml_string
from smollm2_teacher import SmolLM2Teacher
from audio_exporter import export_practice_audio


def load_score_pages(source: Path) -> tuple[List[bytes], List[int], List[Dict[str, Any]]]:
    suffix = source.suffix.lower()

    if suffix == ".pdf":
        rendered = render_pdf_document(source.read_bytes(), preview_only=False)
        pages: List[bytes] = []
        page_numbers: List[int] = []

        for page in rendered.get("pages", []):
            if page.get("status") == "ok" and page.get("pngBytes"):
                pages.append(page["pngBytes"])
                page_numbers.append(int(page["pageNumber"]))

        if not pages:
            raise RuntimeError("The PDF did not produce any usable page images.")

        return pages, page_numbers, rendered.get("pageFailures", [])

    if suffix in {".png", ".jpg", ".jpeg"}:
        return [source.read_bytes()], [1], []

    raise ValueError("Input must be a PDF, PNG, JPG, or JPEG file.")


def write_json(path: Path, value: Dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )


def run(args: argparse.Namespace) -> Path:
    source = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not source.is_file():
        raise FileNotFoundError(f"Input file does not exist: {source}")

    print(f"[ChoirMate worker] Input: {source.name}", flush=True)

    # 1. Render PDF pages or load the uploaded image.
    page_images, page_numbers, render_failures = load_score_pages(source)
    print(f"[ChoirMate worker] Prepared {len(page_images)} page(s).", flush=True)

    # 2. Recognize the score using the existing HOMR engine.
    omr = recognize_score_pages(
        page_images,
        title=args.title,
        page_numbers=page_numbers,
    )
    if not omr.get("success") or not omr.get("musicxml"):
        raise RuntimeError(omr.get("error") or "HOMR could not recognize this score.")

    musicxml = omr["musicxml"]
    (output_dir / "recognized.musicxml").write_text(
        musicxml, encoding="utf-8"
    )

    # 3. Parse MusicXML into ChoirMate's structured score and solfa data.
    parsed = parse_musicxml_string(
        musicxml,
        part_names_override=omr.get("partNames"),
        systems_metadata=omr.get("systemsMetadata"),
        section_diagnostics=omr.get("sectionDiagnostics"),
    )
    notes = parsed.get("notes", [])
    if not notes:
        raise RuntimeError("MusicXML was generated, but no musical events were parsed.")

    print(
        f"[ChoirMate worker] Parsed {len(notes)} events across "
        f"{parsed.get('totalMeasures', 0)} measure(s).",
        flush=True,
    )

    # 4. Enable local SmolLM2 only when the configured model file exists.
    model_path = Path(
        os.environ.get(
            "SMOLLM2_MODEL_PATH",
            "/tmp/choirmate-models/SmolLM2-360M-Instruct-Q4_K_M.gguf",
        )
    )
    if model_path.is_file() and model_path.stat().st_size > 10_000_000:
        os.environ["SMOLLM2_ENABLED"] = "1"
    else:
        os.environ["SMOLLM2_ENABLED"] = "0"
        print(
            "[ChoirMate worker] SmolLM2 model file not found; "
            "using the existing deterministic teaching fallback.",
            flush=True,
        )

    teacher = SmolLM2Teacher()
    teaching = teacher.explain_score(
        title=args.title,
        key_signature=parsed["keySignature"],
        time_signature=parsed["timeSignature"],
        notes=notes,
        parts=parsed.get("parts", []),
        recognition_summary=parsed.get("recognitionSummary", {}),
    )

    # 5. Generate practice audio. WAV avoids requiring system FFmpeg.
    audio = export_practice_audio(
        notes=notes,
        title=args.title,
        part_name=args.part_name,
        scope_label="Full Score",
        tempo=args.tempo,
        voice=args.voice,
        fmt=args.audio_format,
        metronome=args.metronome,
    )
    if not audio.get("success") or not audio.get("audioBase64"):
        raise RuntimeError("Practice audio generation did not return audio data.")

    audio_path = output_dir / audio["fileName"]
    audio_path.write_bytes(base64.b64decode(audio["audioBase64"]))

    # 6. Save structured output separately from the binary audio.
    result = {
        "success": True,
        "runId": args.run_id,
        "title": args.title,
        "sourceFile": source.name,
        "recognitionEngine": "HOMR",
        "musicxmlFile": "recognized.musicxml",
        "score": parsed,
        "teaching": teaching,
        "audio": {
            key: value
            for key, value in audio.items()
            if key != "audioBase64"
        },
        "audioFile": audio_path.name,
        "recognition": {
            "partNames": omr.get("partNames", []),
            "systemsMetadata": omr.get("systemsMetadata", []),
            "sectionDiagnostics": omr.get("sectionDiagnostics", []),
            "recognizedPages": omr.get("recognizedPages", []),
            "failedPages": omr.get("failedPages", []),
            "pdfRenderFailures": render_failures,
        },
    }

    result_path = output_dir / "result.json"
    write_json(result_path, result)

    print(f"[ChoirMate worker] Completed. Result: {result_path}", flush=True)
    print(f"[ChoirMate worker] Audio: {audio_path}", flush=True)
    return result_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run one ChoirMate score-processing job.")
    parser.add_argument("--input", required=True, help="Local path to PDF or image input.")
    parser.add_argument("--output", default="./choirmate-output")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--title", default="ChoirMate Practice Score")
    parser.add_argument("--part-name", default="Choir Practice")
    parser.add_argument("--tempo", type=int, default=88)
    parser.add_argument("--voice", default="choir")
    parser.add_argument("--audio-format", choices=["wav", "mp3"], default="wav")
    parser.add_argument("--metronome", action="store_true")
    args = parser.parse_args()

    try:
        run(args)
        return 0
    except Exception as exc:
        print(f"[ChoirMate worker] FAILED: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc()
        output_dir = Path(args.output)
        output_dir.mkdir(parents=True, exist_ok=True)
        write_json(
            output_dir / "error.json",
            {"success": False, "runId": args.run_id, "error": str(exc)},
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
