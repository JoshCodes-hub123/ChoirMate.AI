"""
ChoirMate AI - Python Open-Weight Microservice (FastAPI).
Serves Full-Page HOMR Optical Music Recognition and SmolLM2-360M-Instruct-GGUF music coaching.
Host: 127.0.0.1
Port: 5001
"""

import os
import sys
import threading
import traceback
from typing import Optional, Dict, Any, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from music_theory import parse_musicxml_string, recalculate_corrected_notes
from smollm2_teacher import SmolLM2Teacher
from omr_engine import recognize_score_pages
from pdf_processor import decode_pdf_base64, render_pdf_document, MAX_PDF_PAGES
from audio_exporter import export_practice_audio


app = FastAPI(title="ChoirMate Open-Weight Full-Score Analysis Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize open-weight SmolLM2 teacher in memory
teacher = SmolLM2Teacher()
_SERVICE_LOCK = threading.Lock()


class PdfPreviewRequest(BaseModel):
    pdfBase64: str
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
    score: Dict[str, Any]
    partId: Optional[str] = None
    updatedNotes: List[Dict[str, Any]]
    fifths: Optional[int] = None


class ExportAudioRequest(BaseModel):
    notes: List[Dict[str, Any]]
    title: Optional[str] = "Practice Score"
    partName: Optional[str] = "Vocal Part"
    scopeLabel: Optional[str] = "Full Song"
    tempo: Optional[int] = 88
    voice: Optional[str] = "choir"
    format: Optional[str] = "mp3"
    metronome: Optional[bool] = False


class AskTeacherRequest(BaseModel):
    question: str
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
        "host": "127.0.0.1",
        "port": 5001,
        "recognitionEngine": "HOMR (Full-Score Optical Music Recognition)",
        "pdfSupport": True,
        "maxPdfPages": MAX_PDF_PAGES,
        "aiTeacher": "SmolLM2-360M-Instruct-GGUF",
        "modelLoaded": teacher.llm is not None,
        "modelLicense": "Apache 2.0"
    }


@app.post("/preview-pdf")
def preview_pdf(req: PdfPreviewRequest):
    """
    Validates an uploaded PDF and renders lightweight page thumbnails and display images
    so the user can preview page count and thumbnails before running full OMR analysis.
    """
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
                # Check if a single base64 PDF was passed inside pages[0]
                first_item = req.pages[0]
                if isinstance(first_item, str) and first_item.startswith("data:application/pdf"):
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

