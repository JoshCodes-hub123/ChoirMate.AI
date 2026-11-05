"""
ChoirMate AI batch worker for Camber.

This worker deliberately reuses the same Python service functions as the live API:
- service.analyze() for PDF, image, and MusicXML processing
- service.export_audio_endpoint() for practice audio

It does not start FastAPI or the Node.js server. Run it from the repository root.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any, Dict

from python.service import (
    AnalyzeRequest,
    ExportAudioRequest,
    analyze,
    export_audio_endpoint,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze a sheet-music file and export practice audio."
    )
    parser.add_argument("--input", required=True, help="Local PDF, image, XML, or MusicXML file")
    parser.add_argument("--run-id", default=None, help="Unique Camber job/run identifier")
    parser.add_argument("--output-dir", default="./choirmate-output", help="Directory for results")
    parser.add_argument("--title", default=None, help="Score title (defaults to the input filename)")
    parser.add_argument("--composer", default="Unknown Composer", help="Composer name")
    parser.add_argument("--tempo", type=int, default=76, help="Tempo in BPM")
    parser.add_argument("--audio-format", choices=("mp3", "wav"), default="mp3")
    parser.add_argument("--voice", choices=("choir", "piano", "strings"), default="choir")
    parser.add_argument("--metronome", action="store_true", help="Include a metronome click")
    return parser.parse_args()


def load_analysis_request(input_path: Path, title: str, composer: str, tempo: int) -> AnalyzeRequest:
    raw = input_path.read_bytes()
    encoded = base64.b64encode(raw).decode("ascii")
    suffix = input_path.suffix.lower()

    common: Dict[str, Any] = {
        "title": title,
        "composer": composer,
        "tempo": tempo,
    }

    if suffix == ".pdf":
        return AnalyzeRequest(pdfBase64=encoded, pdfFileName=input_path.name, **common)

    if suffix in (".xml", ".musicxml"):
        xml_text = raw.decode("utf-8-sig")
        return AnalyzeRequest(musicxml=xml_text, **common)

    mime_type, _ = mimetypes.guess_type(input_path.name)
    if suffix in (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp"):
        mime_type = mime_type or "image/png"
        image_data_url = f"data:{mime_type};base64,{encoded}"
        return AnalyzeRequest(imageBase64=image_data_url, **common)

    raise ValueError(
        f"Unsupported input type '{suffix}'. Use PDF, PNG, JPG, WEBP, TIFF, BMP, XML, or MusicXML."
    )


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.is_file():
        print(f"Input file does not exist: {input_path}", file=sys.stderr)
        return 2

    title = args.title or input_path.stem.replace("_", " ").replace("-", " ").strip()
    print(f"[ChoirMate worker] Input: {input_path.name}", flush=True)
    print("[ChoirMate worker] Starting score analysis using the existing Python service...", flush=True)

    try:
        request = load_analysis_request(input_path, title, args.composer, args.tempo)
        analysis_result = analyze(request)
    except Exception as exc:
        print(f"[ChoirMate worker] Analysis crashed: {exc}", file=sys.stderr, flush=True)
        return 1

    if not isinstance(analysis_result, dict) or not analysis_result.get("success"):
        error_result = analysis_result if isinstance(analysis_result, dict) else {
            "success": False,
            "error": "The analysis service returned an unexpected response.",
        }
        write_json(output_dir / "analysis-error.json", error_result)
        print(f"[ChoirMate worker] Analysis failed: {error_result.get('error', 'Unknown error')}", file=sys.stderr)
        return 1

    score = analysis_result.get("data") or {}
    write_json(output_dir / "analysis.json", analysis_result)
    print(
        f"[ChoirMate worker] Analysis complete: {len(score.get('notes') or [])} notes detected.",
        flush=True,
    )

    notes = score.get("notes") or []
    audio_file_name = None
    audio_export_success = False

    if notes:
        print(f"[ChoirMate worker] Exporting {args.audio_format.upper()} practice audio...", flush=True)
        try:
            audio_result = export_audio_endpoint(
                ExportAudioRequest(
                    notes=notes,
                    title=title,
                    partName="Full Score",
                    scopeLabel="Full Song",
                    tempo=args.tempo,
                    voice=args.voice,
                    format=args.audio_format,
                    metronome=args.metronome,
                )
            )
        except Exception as exc:
            audio_result = {"success": False, "error": f"Audio export crashed: {exc}"}

        if isinstance(audio_result, dict) and audio_result.get("success") and audio_result.get("audioBase64"):
            audio_path = output_dir / audio_result.get("fileName", f"practice.{args.audio_format}")
            audio_path.write_bytes(base64.b64decode(audio_result["audioBase64"]))
            audio_file_name = audio_path.name
            audio_export_success = True
            audio_metadata = {key: value for key, value in audio_result.items() if key != "audioBase64"}
            write_json(output_dir / "audio-metadata.json", audio_metadata)
        else:
            error_result = audio_result if isinstance(audio_result, dict) else {
                "success": False,
                "error": "The audio exporter returned an unexpected response.",
            }
            write_json(output_dir / "audio-error.json", error_result)
            print(
                f"[ChoirMate worker] Audio export unavailable: {error_result.get('error', 'Unknown error')}",
                file=sys.stderr,
                flush=True,
            )
    else:
        write_json(output_dir / "audio-error.json", {
            "success": False,
            "error": "Analysis completed, but no notes were available for audio export.",
        })
        print("[ChoirMate worker] Analysis has no notes; preserving analysis output without audio.", flush=True)

    manifest = {
        "success": True,
        "runId": args.run_id,
        "inputFile": input_path.name,
        "title": title,
        "notesDetected": len(notes),
        "analysisFile": "analysis.json",
        "audioExportSuccess": audio_export_success,
        "audioFile": audio_file_name,
        "audioFormat": args.audio_format if audio_export_success else None,
        "tempo": args.tempo,
    }
    write_json(output_dir / "manifest.json", manifest)

    print(f"[ChoirMate worker] Finished. Results saved in: {output_dir}", flush=True)
    if audio_export_success:
        print(f"[ChoirMate worker] Audio file: {audio_file_name}", flush=True)
    else:
        print("[ChoirMate worker] Analysis is available; audio export needs attention.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
