"""
ChoirMate AI - Python Open-Weight Microservice (FastAPI).
Serves Full-Page HOMR Optical Music Recognition and SmolLM2-360M-Instruct-GGUF music coaching.
Host: 127.0.0.1
Port: 5001
"""

import hmac
import os
import sys
import threading
import traceback
from typing import Optional, Dict, Any, List


def _load_local_env_files() -> None:
    """
    Loads .env.windows.local and .env from the repository root into os.environ
    (without overwriting existing environment variables and without logging secrets).
    """
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for env_name in (".env.windows.local", ".env.local", ".env"):
        env_path = os.path.join(repo_root, env_name)
        if not os.path.isfile(env_path):
            continue
        try:
            with open(env_path, "r", encoding="utf-8") as fh:
                for raw_line in fh:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except Exception:
            pass


_load_local_env_files()

try:
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False
    class FastAPI:  # type: ignore
        def __init__(self, *args: Any, **kwargs: Any): pass
        def get(self, *args: Any, **kwargs: Any): return lambda f: f
        def post(self, *args: Any, **kwargs: Any): return lambda f: f
        def add_middleware(self, *args: Any, **kwargs: Any): pass
        def include_router(self, *args: Any, **kwargs: Any): pass
    class CORSMiddleware: pass  # type: ignore
    class BaseModel:  # type: ignore
        def __init__(self, **kwargs: Any):
            for k, v in getattr(self.__class__, "__dict__", {}).items():
                if not k.startswith("_") and not callable(v):
                    setattr(self, k, v)
            for k, v in kwargs.items():
                setattr(self, k, v)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from music_theory import parse_musicxml_string, recalculate_corrected_notes
from smollm2_teacher import SmolLM2Teacher
from audio_exporter import export_practice_audio
from voice_studio_api import (
    router as voice_studio_router,
    VoiceExtractionRequest,
    VoiceAudioRequest,
    get_voices,
    generate_voice_audio,
)

try:
    from omr_engine import recognize_score_pages
    HAS_OMR = True
except Exception as _omr_imp_err:
    HAS_OMR = False
    recognize_score_pages = None  # type: ignore

try:
    from pdf_processor import decode_pdf_base64, render_pdf_document, MAX_PDF_PAGES
    HAS_PDF_PROCESSOR = True
except Exception as _pdf_imp_err:
    HAS_PDF_PROCESSOR = False
    decode_pdf_base64 = None  # type: ignore
    render_pdf_document = None  # type: ignore
    MAX_PDF_PAGES = 12


def _detect_missing_omr_dependencies() -> List[str]:
    required = [
        ("homr", "homr"),
        ("cv2", "opencv-python-headless"),
        ("PIL", "Pillow"),
        ("numpy", "numpy"),
        ("scipy", "scipy"),
        ("pypdfium2", "pypdfium2"),
        ("onnxruntime", "onnxruntime"),
    ]
    missing: List[str] = []
    for mod_name, pkg_label in required:
        try:
            __import__(mod_name)
        except Exception:
            missing.append(pkg_label)
    return missing


MISSING_OMR_DEPENDENCIES = _detect_missing_omr_dependencies()
PYTHON_HOST = os.environ.get("PYTHON_HOST", "127.0.0.1").strip() or "127.0.0.1"
PYTHON_PORT = int(os.environ.get("PYTHON_PORT", "5001") or "5001")
PYTHON_SERVICE_SECRET = (
    os.environ.get("PYTHON_SERVICE_SECRET")
    or os.environ.get("CHOIRMATE_BACKEND_SECRET")
    or ""
).strip()


def _is_valid_secret(candidate: str) -> bool:
    if not PYTHON_SERVICE_SECRET:
        return True
    if not candidate:
        return False
    return hmac.compare_digest(
        candidate.encode("utf-8"),
        PYTHON_SERVICE_SECRET.encode("utf-8"),
    )


FRIENDLY_HOMR_UNAVAILABLE_MESSAGE = (
    "Sheet music image and PDF recognition is temporarily unavailable because the HOMR Optical Music "
    "Recognition engine is currently offline. You can still upload MusicXML (.musicxml or .xml) files "
    "for full note analysis, SATB voice extraction, and practice audio generation."
)


app = FastAPI(title="ChoirMate Open-Weight Full-Score Analysis Service")
app.include_router(voice_studio_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if HAS_FASTAPI and PYTHON_SERVICE_SECRET:
    from fastapi import Request
    from fastapi.responses import JSONResponse

    @app.middleware("http")
    async def verify_service_secret(request: Request, call_next: Any):
        if request.method == "OPTIONS":
            return await call_next(request)
        header_secret = (
            request.headers.get("x-choirmate-secret")
            or request.headers.get("authorization", "").replace("Bearer ", "")
        ).strip()
        if not _is_valid_secret(header_secret):
            return JSONResponse(
                status_code=401,
                content={
                    "success": False,
                    "errorCode": "UNAUTHORIZED_PYTHON_CLIENT",
                    "error": "Unauthorized request to ChoirMate Python engine.",
                },
            )
        return await call_next(request)

# Initialize open-weight SmolLM2 teacher in memory
teacher = SmolLM2Teacher()
_SERVICE_LOCK = threading.Lock()


class PdfPreviewRequest(BaseModel):
    pdfBase64: str = ""
    fileName: Optional[str] = "score.pdf"


class AnalyzeRequest(BaseModel):
    imageBase64: Optional[str] = None
    pages: Optional[List[str]] = None
    pdfBase64: Optional[str] = None
    pdfFileName: Optional[str] = None
    musicxml: Optional[str] = None
    sampleId: Optional[str] = None
    title: Optional[str] = "Analyzed Score"
    composer: Optional[str] = "Unknown Composer"
    tempo: Optional[int] = 76


class RecalculateRequest(BaseModel):
    score: Dict[str, Any] = {}
    partId: Optional[str] = None
    updatedNotes: List[Dict[str, Any]] = []
    fifths: Optional[int] = None


class ExportAudioRequest(BaseModel):
    notes: List[Dict[str, Any]] = []
    title: Optional[str] = "Practice Score"
    partName: Optional[str] = "Vocal Part"
    scopeLabel: Optional[str] = "Full Song"
    tempo: Optional[int] = 88
    voice: Optional[str] = "choir"
    format: Optional[str] = "mp3"
    metronome: Optional[bool] = False


class AskTeacherRequest(BaseModel):
    question: str = ""
    title: Optional[str] = "Active Score"
    partName: Optional[str] = "Vocal Part"
    keySignature: Optional[Dict[str, Any]] = None
    timeSignature: Optional[Dict[str, Any]] = None
    notes: Optional[List[Dict[str, Any]]] = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ChoirMate Open-Weight Python Service",
        "host": PYTHON_HOST,
        "port": PYTHON_PORT,
        "authRequired": bool(PYTHON_SERVICE_SECRET),
        "recognitionEngine": "HOMR (Full-Score Optical Music Recognition)",
        "omrAvailable": HAS_OMR,
        "omrEngineStatus": "ready" if HAS_OMR else "unavailable_in_environment",
        "missingOmrDependencies": [] if HAS_OMR else MISSING_OMR_DEPENDENCIES,
        "pdfSupport": HAS_PDF_PROCESSOR,
        "musicXmlSupport": True,
        "voiceStudioAvailable": True,
        "audioExportAvailable": True,
        "maxPdfPages": MAX_PDF_PAGES,
        "aiTeacher": "SmolLM2-360M-Instruct-GGUF",
        "modelLoaded": teacher.llm is not None,
        "modelLicense": "Apache 2.0",
    }


@app.post("/preview-pdf")
def preview_pdf(req: PdfPreviewRequest):
    """
    Validates an uploaded PDF and renders lightweight page thumbnails and display images
    so the user can preview page count and thumbnails before running full OMR analysis.
    """
    if not HAS_PDF_PROCESSOR or decode_pdf_base64 is None or render_pdf_document is None:
        return {
            "success": False,
            "errorCode": "PDF_PROCESSOR_UNAVAILABLE",
            "error": FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
        }
    try:
        pdf_bytes = decode_pdf_base64(req.pdfBase64)
        rendered = render_pdf_document(pdf_bytes, preview_only=True)
        pages_out = [
            {
                "pageNumber": p["pageNumber"],
                "width": p["width"],
                "height": p["height"],
                "dataUrl": p["dataUrl"],
                "thumbnailDataUrl": p["thumbnailDataUrl"],
                "rotatedDegrees": p.get("rotatedDegrees", 0),
                "deskewAngle": p.get("deskewAngle", 0.0),
                "status": p["status"],
                "error": p.get("error"),
            }
            for p in rendered.get("pages", [])
        ]
        return {
            "success": True,
            "fileName": req.fileName or "score.pdf",
            "pageCount": rendered["pageCount"],
            "processedPages": rendered["processedPages"],
            "pages": pages_out,
        }
    except ValueError as val_err:
        return {
            "success": False,
            "errorCode": "INVALID_PDF",
            "error": str(val_err),
        }
    except Exception as exc:
        sys.stderr.write(f"[Python Service] /preview-pdf error: {exc}\n")
        traceback.print_exc(file=sys.stderr)
        return {
            "success": False,
            "errorCode": "PDF_PREVIEW_FAILED",
            "error": "Could not render a preview of the uploaded PDF document. Please verify the file is a valid PDF.",
        }


def _build_score_response(
    parsed: Dict[str, Any],
    title: str,
    composer: str,
    tempo: int,
    source: str,
    raw_musicxml: Optional[str] = None,
    systems_metadata: Optional[List[Dict[str, Any]]] = None,
    section_diagnostics: Optional[List[Dict[str, Any]]] = None,
    omr_summary: Optional[Dict[str, Any]] = None,
    page_images: Optional[List[str]] = None,
) -> Dict[str, Any]:
    notes = parsed["notes"]
    parts = parsed.get("parts", [])
    key_sig = parsed["keySignature"]
    time_sig = parsed["timeSignature"]
    recognition_summary = parsed.get("recognitionSummary", {})
    if omr_summary:
        recognition_summary = {**recognition_summary, **omr_summary}

    explanation = teacher.explain_score(
        title=title,
        key_signature=key_sig,
        time_signature=time_sig,
        notes=notes,
        parts=parts,
        recognition_summary=recognition_summary
    )

    resp: Dict[str, Any] = {
        "id": f"score-{os.urandom(4).hex()}",
        "title": title,
        "composer": composer,
        "source": source,
        "isDemonstration": False,
        "clef": parsed.get("clef", "treble"),
        "tempo": tempo,
        "keySignature": key_sig,
        "timeSignature": time_sig,
        "notes": notes,
        "parts": parts,
        "measures": parsed.get("measures", []),
        "totalMeasures": parsed.get("totalMeasures", 1),
        "totalSystems": parsed.get("totalSystems", 1),
        "totalParts": parsed.get("totalParts", 1),
        "systemsMetadata": systems_metadata or parsed.get("systemsMetadata", []),
        "sectionDiagnostics": section_diagnostics or parsed.get("sectionDiagnostics", []),
        "recognitionSummary": recognition_summary,
        "rawMusicXml": raw_musicxml,
        "rhythmBreakdown": explanation["rhythmBreakdown"],
        "simpleExplanation": explanation["simpleExplanation"],
        "practiceSteps": explanation["practiceSteps"],
        "aiTeacher": {
            "model": "SmolLM2-360M-Instruct-GGUF",
            "license": "Apache 2.0",
            "openWeight": True,
            "isLocalAi": explanation.get("isLocalAi", True)
        }
    }
    if page_images:
        resp["imageUrl"] = page_images[0]
        resp["pageImages"] = page_images
    return resp


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    with _SERVICE_LOCK:
        try:
            # 1. Direct MusicXML input
            if req.musicxml:
                try:
                    parsed = parse_musicxml_string(req.musicxml)
                    notes = parsed.get("notes", [])
                    if not notes:
                        return {
                            "success": False,
                            "errorCode": "EMPTY_MUSICXML",
                            "error": "The MusicXML file did not contain any readable musical notes or rests."
                        }
                    result = _build_score_response(
                        parsed=parsed,
                        title=req.title or "Imported Score",
                        composer=req.composer or "MusicXML Import",
                        tempo=req.tempo or 76,
                        source="musicxml_parsed",
                        raw_musicxml=req.musicxml
                    )
                    return {"success": True, "data": result}
                except Exception as e:
                    sys.stderr.write(f"[Python Service] MusicXML parse error: {e}\n")
                    traceback.print_exc(file=sys.stderr)
                    return {
                        "success": False,
                        "errorCode": "INVALID_MUSICXML",
                        "error": "Could not parse the uploaded MusicXML file. Please verify that it is valid MusicXML."
                    }

            # 2. PDF or Image input
            page_inputs: List[Any] = []
            page_numbers: Optional[List[int]] = None
            rendered_display_urls: List[str] = []
            pdf_render_failures: List[Dict[str, Any]] = []
            total_doc_pages = 0

            if req.pdfBase64:
                if not HAS_PDF_PROCESSOR or decode_pdf_base64 is None or render_pdf_document is None:
                    return {
                        "success": False,
                        "errorCode": "HOMR_ENVIRONMENT_REQUIRED",
                        "error": FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
                    }
                try:
                    pdf_bytes = decode_pdf_base64(req.pdfBase64)
                    rendered = render_pdf_document(pdf_bytes, preview_only=False)
                except ValueError as pdf_val_err:
                    return {
                        "success": False,
                        "errorCode": "INVALID_PDF",
                        "error": str(pdf_val_err),
                    }
                except Exception as pdf_err:
                    sys.stderr.write(f"[Python Service] PDF rendering error: {pdf_err}\n")
                    traceback.print_exc(file=sys.stderr)
                    return {
                        "success": False,
                        "errorCode": "PDF_RENDER_FAILED",
                        "error": "The uploaded PDF document could not be rendered for Optical Music Recognition.",
                    }

                total_doc_pages = rendered["pageCount"]
                pdf_render_failures = rendered.get("pageFailures", [])
                page_numbers = []
                for p in rendered.get("pages", []):
                    if p.get("dataUrl"):
                        rendered_display_urls.append(p["dataUrl"])
                    if p["status"] == "ok" and p.get("pngBytes"):
                        page_inputs.append(p["pngBytes"])
                        page_numbers.append(p["pageNumber"])

            elif req.pages and len(req.pages) > 0:
                first_item = req.pages[0]
                if isinstance(first_item, str) and first_item.startswith("data:application/pdf"):
                    if not HAS_PDF_PROCESSOR or decode_pdf_base64 is None or render_pdf_document is None:
                        return {
                            "success": False,
                            "errorCode": "HOMR_ENVIRONMENT_REQUIRED",
                            "error": FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
                        }
                    try:
                        pdf_bytes = decode_pdf_base64(first_item)
                        rendered = render_pdf_document(pdf_bytes, preview_only=False)
                        total_doc_pages = rendered["pageCount"]
                        pdf_render_failures = rendered.get("pageFailures", [])
                        page_numbers = []
                        for p in rendered.get("pages", []):
                            if p.get("dataUrl"):
                                rendered_display_urls.append(p["dataUrl"])
                            if p["status"] == "ok" and p.get("pngBytes"):
                                page_inputs.append(p["pngBytes"])
                                page_numbers.append(p["pageNumber"])
                    except ValueError as pdf_val_err:
                        return {
                            "success": False,
                            "errorCode": "INVALID_PDF",
                            "error": str(pdf_val_err),
                        }
                else:
                    page_inputs = req.pages
                    rendered_display_urls = req.pages
                    total_doc_pages = len(req.pages)
            elif req.imageBase64:
                if req.imageBase64.startswith("data:application/pdf"):
                    if not HAS_PDF_PROCESSOR or decode_pdf_base64 is None or render_pdf_document is None:
                        return {
                            "success": False,
                            "errorCode": "HOMR_ENVIRONMENT_REQUIRED",
                            "error": FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
                        }
                    try:
                        pdf_bytes = decode_pdf_base64(req.imageBase64)
                        rendered = render_pdf_document(pdf_bytes, preview_only=False)
                        total_doc_pages = rendered["pageCount"]
                        pdf_render_failures = rendered.get("pageFailures", [])
                        page_numbers = []
                        for p in rendered.get("pages", []):
                            if p.get("dataUrl"):
                                rendered_display_urls.append(p["dataUrl"])
                            if p["status"] == "ok" and p.get("pngBytes"):
                                page_inputs.append(p["pngBytes"])
                                page_numbers.append(p["pageNumber"])
                    except ValueError as pdf_val_err:
                        return {
                            "success": False,
                            "errorCode": "INVALID_PDF",
                            "error": str(pdf_val_err),
                        }
                else:
                    page_inputs = [req.imageBase64]
                    rendered_display_urls = [req.imageBase64]
                    total_doc_pages = 1

            if page_inputs:
                if not HAS_OMR or recognize_score_pages is None:
                    return {
                        "success": False,
                        "errorCode": "HOMR_ENVIRONMENT_REQUIRED",
                        "error": FRIENDLY_HOMR_UNAVAILABLE_MESSAGE,
                        "omrAttempted": False,
                        "recognitionEngine": "HOMR",
                    }
                omr_res = recognize_score_pages(
                    page_inputs,
                    title=req.title or "Recognized Score",
                    page_numbers=page_numbers,
                )
                combined_diagnostics = pdf_render_failures + omr_res.get("sectionDiagnostics", [])
                if not omr_res.get("success") or not omr_res.get("musicxml"):
                    return {
                        "success": False,
                        "errorCode": "OMR_RECOGNITION_FAILED",
                        "error": omr_res.get("error") or (
                            "HOMR Optical Music Recognition could not detect readable musical staves from this document."
                        ),
                        "sectionDiagnostics": combined_diagnostics,
                        "omrAttempted": True,
                        "recognitionEngine": "HOMR",
                        "aiTeacher": "SmolLM2-360M-Instruct-GGUF"
                    }

                try:
                    musicxml_str = omr_res["musicxml"]
                    systems_meta = omr_res.get("systemsMetadata", [])
                    parsed = parse_musicxml_string(
                        musicxml_str,
                        part_names_override=omr_res.get("partNames"),
                        systems_metadata=systems_meta,
                        section_diagnostics=combined_diagnostics
                    )
                    notes = parsed.get("notes", [])
                    if not notes:
                        return {
                            "success": False,
                            "errorCode": "NO_NOTES_DECODED",
                            "error": "Musical staves were detected, but no pitched notes or rests could be decoded.",
                            "sectionDiagnostics": combined_diagnostics,
                            "omrAttempted": True
                        }

                    omr_summary = {
                        "totalPages": total_doc_pages or omr_res.get("totalPages", len(page_inputs)),
                        "pageCount": total_doc_pages or omr_res.get("totalPages", len(page_inputs)),
                        "recognizedPages": omr_res.get("recognizedPages", []),
                        "failedPages": omr_res.get("failedPages", []),
                        "totalSystems": omr_res.get("totalSystems", parsed.get("totalSystems", 1)),
                        "totalDetectedStaves": omr_res.get("totalStaves", 1),
                        "segmentedNoteheads": omr_res.get("totalSegmentedNoteheads", 0),
                        "recognizedNotes": omr_res.get("totalRecognizedNotes", len(notes)),
                    }

                    result = _build_score_response(
                        parsed=parsed,
                        title=req.title or "Recognized Score",
                        composer=req.composer or "HOMR Full-Score OMR + SmolLM2 Teacher",
                        tempo=req.tempo or 76,
                        source="homr_pdf_omr_recognition" if req.pdfBase64 else "homr_omr_recognition",
                        raw_musicxml=musicxml_str,
                        systems_metadata=systems_meta,
                        section_diagnostics=combined_diagnostics,
                        omr_summary=omr_summary,
                        page_images=rendered_display_urls if rendered_display_urls else None,
                    )
                    return {"success": True, "data": result}
                except Exception as parse_err:
                    sys.stderr.write(f"[Python Service] Parse error: {parse_err}\n")
                    traceback.print_exc(file=sys.stderr)
                    return {
                        "success": False,
                        "errorCode": "OMR_PARSE_ERROR",
                        "error": "Musical symbols were detected, but the score structure could not be parsed cleanly.",
                        "sectionDiagnostics": combined_diagnostics,
                        "omrAttempted": True
                    }

            return {
                "success": False,
                "errorCode": "NO_INPUT_PROVIDED",
                "error": "No sheet music PDF, image, or MusicXML payload provided."
            }
        except Exception as err:
            sys.stderr.write(f"[Python Service] Unhandled /analyze error: {err}\n")
            traceback.print_exc(file=sys.stderr)
            return {
                "success": False,
                "errorCode": "INTERNAL_ANALYSIS_ERROR",
                "error": "Could not complete score recognition on the uploaded file. Please verify the file is a clear PDF, PNG, or JPG of printed sheet music."
            }



@app.post("/recalculate")
def recalculate(req: RecalculateRequest):
    """
    Re-validates user-corrected notes, updates Movable-Do solfa, frequencies,
    measure beat-sum validation, and regenerates SmolLM2 teacher coaching.
    """
    with _SERVICE_LOCK:
        try:
            updated_score = recalculate_corrected_notes(
                score_data=req.score,
                part_id=req.partId,
                updated_notes=req.updatedNotes,
                new_fifths=req.fifths
            )
            explanation = teacher.explain_score(
                title=updated_score.get("title", "Corrected Score"),
                key_signature=updated_score["keySignature"],
                time_signature=updated_score["timeSignature"],
                notes=updated_score["notes"],
                parts=updated_score.get("parts", []),
                recognition_summary=updated_score.get("recognitionSummary", {})
            )
            updated_score["rhythmBreakdown"] = explanation["rhythmBreakdown"]
            updated_score["simpleExplanation"] = explanation["simpleExplanation"]
            updated_score["practiceSteps"] = explanation["practiceSteps"]
            return {"success": True, "data": updated_score}
        except Exception as e:
            sys.stderr.write(f"[Python Service] Recalculate error: {e}\n")
            traceback.print_exc(file=sys.stderr)
            return {
                "success": False,
                "errorCode": "RECALCULATE_FAILED",
                "error": "Could not recalculate the edited notes. Please verify pitch and duration values."
            }


@app.post("/export-audio")
def export_audio_endpoint(req: ExportAudioRequest):
    """
    Synthesizes practice audio from the current (corrected) notes into WAV or genuine MP3 via FFmpeg.
    """
    try:
        result = export_practice_audio(
            notes=req.notes,
            title=req.title or "Practice Score",
            part_name=req.partName or "Vocal Part",
            scope_label=req.scopeLabel or "Full Song",
            tempo=req.tempo or 88,
            voice=req.voice or "choir",
            fmt=req.format or "mp3",
            metronome=bool(req.metronome),
        )
        return result
    except ValueError as val_err:
        return {
            "success": False,
            "errorCode": "INVALID_AUDIO_EXPORT_REQUEST",
            "error": str(val_err),
        }
    except Exception as exc:
        sys.stderr.write(f"[Python Service] /export-audio error: {exc}\n")
        traceback.print_exc(file=sys.stderr)
        return {
            "success": False,
            "errorCode": "AUDIO_EXPORT_FAILED",
            "error": "Could not generate downloadable practice audio. Please check your selected notes and try again.",
        }


@app.post("/ask-teacher")
def ask_teacher_endpoint(req: AskTeacherRequest):
    """
    Answers a learner's spoken (AssemblyAI-transcribed) or typed question using SmolLM2-360M-Instruct
    grounded strictly in the active score's validated notes, solfa, key, and rhythm.
    """
    try:
        res = teacher.answer_question(
            question=req.question,
            title=req.title or "Active Score",
            part_name=req.partName or "Vocal Part",
            key_signature=req.keySignature,
            time_signature=req.timeSignature,
            notes=req.notes,
        )
        return {"success": True, "data": res}
    except ValueError as val_err:
        return {
            "success": False,
            "errorCode": "EMPTY_QUESTION",
            "error": str(val_err),
        }
    except Exception as exc:
        sys.stderr.write(f"[Python Service] /ask-teacher error: {exc}\n")
        traceback.print_exc(file=sys.stderr)
        return {
            "success": False,
            "errorCode": "TEACHER_QA_FAILED",
            "error": "Could not generate a coaching response right now. Please try again.",
        }


if __name__ == "__main__":
    try:
        import uvicorn
        if not HAS_FASTAPI:
            raise ImportError("FastAPI not installed")
        uvicorn.run(app, host=PYTHON_HOST, port=PYTHON_PORT)
    except ImportError:
        import json
        from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

        class ChoirMateFallbackHTTPHandler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                pass

            def _check_auth(self) -> bool:
                if not PYTHON_SERVICE_SECRET:
                    return True
                header_secret = (
                    self.headers.get("X-ChoirMate-Secret")
                    or self.headers.get("x-choirmate-secret")
                    or (self.headers.get("Authorization") or "").replace("Bearer ", "")
                ).strip()
                if not _is_valid_secret(header_secret):
                    self._send_json(
                        401,
                        {
                            "success": False,
                            "errorCode": "UNAUTHORIZED_PYTHON_CLIENT",
                            "error": "Unauthorized request to ChoirMate Python engine.",
                        },
                    )
                    return False
                return True

            def _send_json(self, status_code: int, payload: Dict[str, Any]) -> None:
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status_code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self) -> None:
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ChoirMate-Secret")
                self.end_headers()

            def do_GET(self) -> None:
                if not self._check_auth():
                    return
                if self.path == "/health":
                    self._send_json(200, health())
                else:
                    self._send_json(404, {"success": False, "error": f"Unknown GET endpoint: {self.path}"})

            def do_POST(self) -> None:
                if not self._check_auth():
                    return
                if self.path == "/health":
                    self._send_json(200, health())
                    return

                content_length = int(self.headers.get("Content-Length") or 0)
                raw_body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
                try:
                    data = json.loads(raw_body) if raw_body.strip() else {}
                except Exception as exc:
                    self._send_json(400, {"success": False, "error": f"Invalid JSON payload: {exc}"})
                    return

                try:
                    if self.path == "/preview-pdf":
                        res = preview_pdf(PdfPreviewRequest(**data))
                    elif self.path == "/analyze":
                        res = analyze(AnalyzeRequest(**data))
                    elif self.path == "/recalculate":
                        res = recalculate(RecalculateRequest(**data))
                    elif self.path == "/export-audio":
                        res = export_audio_endpoint(ExportAudioRequest(**data))
                    elif self.path == "/ask-teacher":
                        res = ask_teacher_endpoint(AskTeacherRequest(**data))
                    elif self.path == "/voice-studio/voices":
                        res = get_voices(VoiceExtractionRequest(**data))
                    elif self.path == "/voice-studio/audio":
                        res = generate_voice_audio(VoiceAudioRequest(**data))
                    else:
                        self._send_json(404, {"success": False, "error": f"Unknown POST endpoint: {self.path}"})
                        return
                    self._send_json(200, res)
                except Exception as err:
                    sys.stderr.write(f"[Python Fallback HTTP] Error on {self.path}: {err}\n")
                    traceback.print_exc(file=sys.stderr)
                    self._send_json(500, {"success": False, "error": str(err)})

        server = ThreadingHTTPServer((PYTHON_HOST, PYTHON_PORT), ChoirMateFallbackHTTPHandler)
        print(f"[Python Service] Running ChoirMate Python HTTP service on {PYTHON_HOST}:{PYTHON_PORT}", flush=True)
        server.serve_forever()



