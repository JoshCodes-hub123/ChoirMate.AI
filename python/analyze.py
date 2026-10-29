"""
ChoirMate AI Pipeline Runner.
Coordinates: Image(s) -> HOMR Full-Score OMR -> MusicXML Parsing & Validation -> SmolLM2 Explanation.
Enforces OPEN//BUILD 2026 challenge requirements:
- No Gemini calls or fallbacks.
- Transparent reporting of OMR recognition status and per-section diagnostics.
- Meaningful use of open-weight SmolLM2-360M-Instruct.
"""

import sys
import os
import json
import traceback
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def emit_json_and_exit(payload: Dict[str, Any], exit_code: int = 0) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()
    sys.exit(exit_code)


def run_pipeline() -> None:
    try:
        from music_theory import parse_musicxml_string, recalculate_corrected_notes
        from smollm2_teacher import SmolLM2Teacher
        from omr_engine import recognize_score_pages
        from pdf_processor import decode_pdf_base64, render_pdf_document
        from audio_exporter import export_practice_audio
    except Exception as imp_err:
        sys.stderr.write(f"[ChoirMate Analyze] Dependency import error: {imp_err}\n")
        traceback.print_exc(file=sys.stderr)
        emit_json_and_exit({
            "success": False,
            "errorCode": "PYTHON_DEPENDENCY_MISSING",
            "error": (
                "The Optical Music Recognition Python environment is still initializing or missing required packages. "
                "Please wait a moment and try again."
            )
        }, 0)
        return

    raw_input = ""
    if len(sys.argv) >= 2 and sys.argv[1] != '-':
        raw_input = sys.argv[1]
    else:
        raw_input = sys.stdin.read()

    if not raw_input.strip():
        emit_json_and_exit({
            'success': False,
            'errorCode': 'EMPTY_PAYLOAD',
            'error': 'Missing input payload. Please provide a sheet music PDF, image, or MusicXML file.'
        }, 0)
        return

    try:
        input_data = json.loads(raw_input)
    except Exception as e:
        sys.stderr.write(f"[ChoirMate Analyze] Invalid JSON input: {e}\n")
        emit_json_and_exit({
            'success': False,
            'errorCode': 'INVALID_JSON',
            'error': 'Invalid request format received during score analysis.'
        }, 0)
        return

    action = input_data.get('action', 'analyze')

    if action == 'export_audio':
        try:
            res = export_practice_audio(
                notes=input_data.get('notes', []),
                title=input_data.get('title', 'Practice Score'),
                part_name=input_data.get('partName', 'Vocal Part'),
                scope_label=input_data.get('scopeLabel', 'Full Song'),
                tempo=int(input_data.get('tempo', 88)),
                voice=input_data.get('voice', 'choir'),
                fmt=input_data.get('format', 'mp3'),
                metronome=bool(input_data.get('metronome', False)),
            )
            emit_json_and_exit(res, 0)
        except ValueError as val_err:
            emit_json_and_exit({
                'success': False,
                'errorCode': 'INVALID_AUDIO_EXPORT_REQUEST',
                'error': str(val_err),
            }, 0)
        except Exception as exc:
            sys.stderr.write(f"[ChoirMate Analyze] export_audio error: {exc}\n")
            traceback.print_exc(file=sys.stderr)
            emit_json_and_exit({
                'success': False,
                'errorCode': 'AUDIO_EXPORT_FAILED',
                'error': 'Could not generate downloadable practice audio. Please check your selected notes and try again.',
            }, 0)
        return

    if action == 'preview_pdf':
        pdf_b64 = input_data.get('pdfBase64', '')
        file_name = input_data.get('fileName', 'score.pdf')
        try:
            pdf_bytes = decode_pdf_base64(pdf_b64)
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
            emit_json_and_exit({
                "success": True,
                "fileName": file_name,
                "pageCount": rendered["pageCount"],
                "processedPages": rendered["processedPages"],
                "pages": pages_out,
            }, 0)
        except ValueError as val_err:
            emit_json_and_exit({
                "success": False,
                "errorCode": "INVALID_PDF",
                "error": str(val_err),
            }, 0)
        except Exception as exc:
            sys.stderr.write(f"[ChoirMate Analyze] preview_pdf error: {exc}\n")
            traceback.print_exc(file=sys.stderr)
            emit_json_and_exit({
                "success": False,
                "errorCode": "PDF_PREVIEW_FAILED",
                "error": "Could not render a preview of the uploaded PDF document. Please verify the file is a valid PDF.",
            }, 0)
        return

    teacher = SmolLM2Teacher()

    if action == 'ask_teacher':
        try:
            res = teacher.answer_question(
                question=input_data.get('question', ''),
                title=input_data.get('title', 'Active Score'),
                part_name=input_data.get('partName', 'Vocal Part'),
                key_signature=input_data.get('keySignature'),
                time_signature=input_data.get('timeSignature'),
                notes=input_data.get('notes', []),
            )
            emit_json_and_exit({'success': True, 'data': res}, 0)
        except ValueError as val_err:
            emit_json_and_exit({
                'success': False,
                'errorCode': 'EMPTY_QUESTION',
                'error': str(val_err),
            }, 0)
        except Exception as exc:
            sys.stderr.write(f"[ChoirMate Analyze] ask_teacher error: {exc}\n")
            traceback.print_exc(file=sys.stderr)
            emit_json_and_exit({
                'success': False,
                'errorCode': 'TEACHER_QA_FAILED',
                'error': 'Could not generate a coaching response right now.',
            }, 0)
        return

    if action == 'recalculate':
        try:
            updated_score = recalculate_corrected_notes(
                score_data=input_data['score'],
                part_id=input_data.get('partId'),
                updated_notes=input_data.get('updatedNotes', []),
                new_fifths=input_data.get('fifths')
            )
            explanation = teacher.explain_score(
                title=updated_score.get('title', 'Corrected Score'),
                key_signature=updated_score['keySignature'],
                time_signature=updated_score['timeSignature'],
                notes=updated_score['notes'],
                parts=updated_score.get('parts', []),
                recognition_summary=updated_score.get('recognitionSummary', {})
            )
            updated_score['rhythmBreakdown'] = explanation['rhythmBreakdown']
            updated_score['simpleExplanation'] = explanation['simpleExplanation']
            updated_score['practiceSteps'] = explanation['practiceSteps']
            emit_json_and_exit({'success': True, 'data': updated_score}, 0)
        except Exception as err:
            sys.stderr.write(f"[ChoirMate Analyze] Recalculate error: {err}\n")
            traceback.print_exc(file=sys.stderr)
            emit_json_and_exit({
                'success': False,
                'errorCode': 'RECALCULATE_FAILED',
                'error': 'Could not recalculate the edited notes. Please check that pitch and duration values are valid.'
            }, 0)
        return

    image_base64 = input_data.get('imageBase64')
    pages = input_data.get('pages')
    pdf_base64 = input_data.get('pdfBase64')
    musicxml_raw = input_data.get('musicxml')
    title = input_data.get('title') or 'Analyzed Score'
    composer = input_data.get('composer') or 'HOMR Full-Score OMR + SmolLM2 Teacher'
    tempo = input_data.get('tempo') or 76

    if musicxml_raw:
        try:
            parsed = parse_musicxml_string(musicxml_raw)
            notes = parsed.get('notes', [])
            if not notes:
                emit_json_and_exit({
                    'success': False,
                    'errorCode': 'EMPTY_MUSICXML',
                    'error': 'The provided MusicXML file did not contain any readable vocal note elements.'
                }, 0)
                return

            explanation = teacher.explain_score(
                title,
                parsed['keySignature'],
                parsed['timeSignature'],
                notes,
                parsed.get('parts', []),
                parsed.get('recognitionSummary', {})
            )
            result = {
                'id': f'score-{os.urandom(4).hex()}',
                'title': title,
                'composer': composer,
                'source': 'musicxml_parsed',
                'isDemonstration': False,
                'clef': parsed.get('clef', 'treble'),
                'tempo': tempo,
                'keySignature': parsed['keySignature'],
                'timeSignature': parsed['timeSignature'],
                'notes': notes,
                'parts': parsed.get('parts', []),
                'measures': parsed.get('measures', []),
                'totalMeasures': parsed.get('totalMeasures', 1),
                'totalSystems': parsed.get('totalSystems', 1),
                'totalParts': parsed.get('totalParts', 1),
                'systemsMetadata': parsed.get('systemsMetadata', []),
                'sectionDiagnostics': parsed.get('sectionDiagnostics', []),
                'recognitionSummary': parsed.get('recognitionSummary', {}),
                'rawMusicXml': musicxml_raw,
                'rhythmBreakdown': explanation['rhythmBreakdown'],
                'simpleExplanation': explanation['simpleExplanation'],
                'practiceSteps': explanation['practiceSteps'],
                'aiTeacher': {
                    'model': explanation['model'],
                    'license': explanation['modelLicense'],
                    'openWeight': True,
                    'isLocalAi': explanation.get('isLocalAi', True)
                }
            }
            emit_json_and_exit({'success': True, 'data': result}, 0)
        except Exception as err:
            sys.stderr.write(f"[ChoirMate Analyze] MusicXML parse error: {err}\n")
            traceback.print_exc(file=sys.stderr)
            emit_json_and_exit({
                'success': False,
                'errorCode': 'INVALID_MUSICXML',
                'error': 'Could not parse the uploaded MusicXML file. Please verify that it is valid MusicXML.'
            }, 0)
        return

    page_list: List[Any] = []
    page_numbers: List[int] = []
    rendered_display_urls: List[str] = []
    pdf_render_failures: List[Dict[str, Any]] = []
    total_doc_pages = 0

    if pdf_base64:
        try:
            pdf_bytes = decode_pdf_base64(pdf_base64)
            rendered = render_pdf_document(pdf_bytes, preview_only=False)
            total_doc_pages = rendered["pageCount"]
            pdf_render_failures = rendered.get("pageFailures", [])
            for p in rendered.get("pages", []):
                if p.get("dataUrl"):
                    rendered_display_urls.append(p["dataUrl"])
                if p["status"] == "ok" and p.get("pngBytes"):
                    page_list.append(p["pngBytes"])
                    page_numbers.append(p["pageNumber"])
        except ValueError as pdf_val_err:
            emit_json_and_exit({
                'success': False,
                'errorCode': 'INVALID_PDF',
                'error': str(pdf_val_err)
            }, 0)
            return
        except Exception as pdf_err:
            sys.stderr.write(f"[ChoirMate Analyze] PDF rendering error: {pdf_err}\n")
            traceback.print_exc(file=sys.stderr)
            emit_json_and_exit({
                'success': False,
                'errorCode': 'PDF_RENDER_FAILED',
                'error': 'The uploaded PDF document could not be rendered for Optical Music Recognition.'
            }, 0)
            return
    elif pages and isinstance(pages, list) and len(pages) > 0:
        page_list = pages
        rendered_display_urls = pages
        total_doc_pages = len(pages)
    elif image_base64:
        page_list = [image_base64]
        rendered_display_urls = [image_base64]
        total_doc_pages = 1

    if page_list:
        omr_res = recognize_score_pages(
            page_list,
            title=title,
            page_numbers=page_numbers if page_numbers else None
        )
        combined_diagnostics = pdf_render_failures + omr_res.get('sectionDiagnostics', [])
        if omr_res.get('success') and omr_res.get('musicxml'):
            try:
                musicxml_str = omr_res['musicxml']
                systems_meta = omr_res.get('systemsMetadata', [])
                parsed = parse_musicxml_string(
                    musicxml_str,
                    part_names_override=omr_res.get('partNames'),
                    systems_metadata=systems_meta,
                    section_diagnostics=combined_diagnostics
                )
                notes = parsed.get('notes', [])
                if notes:
                    recognition_summary = {
                        **parsed.get('recognitionSummary', {}),
                        'totalPages': total_doc_pages or omr_res.get('totalPages', len(page_list)),
                        'pageCount': total_doc_pages or omr_res.get('totalPages', len(page_list)),
                        'recognizedPages': omr_res.get('recognizedPages', []),
                        'failedPages': omr_res.get('failedPages', []),
                        'totalSystems': omr_res.get('totalSystems', parsed.get('totalSystems', 1)),
                        'totalDetectedStaves': omr_res.get('totalStaves', 1),
                        'segmentedNoteheads': omr_res.get('totalSegmentedNoteheads', 0),
                        'recognizedNotes': omr_res.get('totalRecognizedNotes', len(notes)),
                    }
                    explanation = teacher.explain_score(
                        title,
                        parsed['keySignature'],
                        parsed['timeSignature'],
                        notes,
                        parsed.get('parts', []),
                        recognition_summary
                    )
                    result = {
                        'id': f'homr-{os.urandom(4).hex()}',
                        'title': title,
                        'composer': composer,
                        'source': 'homr_pdf_omr_recognition' if pdf_base64 else 'homr_omr_recognition',
                        'isDemonstration': False,
                        'clef': parsed.get('clef', 'treble'),
                        'tempo': tempo,
                        'keySignature': parsed['keySignature'],
                        'timeSignature': parsed['timeSignature'],
                        'notes': notes,
                        'parts': parsed.get('parts', []),
                        'measures': parsed.get('measures', []),
                        'totalMeasures': parsed.get('totalMeasures', 1),
                        'totalSystems': parsed.get('totalSystems', 1),
                        'totalParts': parsed.get('totalParts', 1),
                        'systemsMetadata': systems_meta,
                        'sectionDiagnostics': combined_diagnostics,
                        'recognitionSummary': recognition_summary,
                        'rawMusicXml': musicxml_str,
                        'rhythmBreakdown': explanation['rhythmBreakdown'],
                        'simpleExplanation': explanation['simpleExplanation'],
                        'practiceSteps': explanation['practiceSteps'],
                        'imageUrl': rendered_display_urls[0] if rendered_display_urls else None,
                        'pageImages': rendered_display_urls if rendered_display_urls else None,
                        'aiTeacher': {
                            'model': 'SmolLM2-360M-Instruct-GGUF',
                            'license': 'Apache 2.0',
                            'openWeight': True,
                            'isLocalAi': explanation.get('isLocalAi', True)
                        }
                    }
                    emit_json_and_exit({'success': True, 'data': result}, 0)
                    return
            except Exception as parse_err:
                sys.stderr.write(f"[ChoirMate Analyze] Post-OMR MusicXML parse error: {parse_err}\n")
                traceback.print_exc(file=sys.stderr)
                emit_json_and_exit({
                    'success': False,
                    'errorCode': 'OMR_PARSE_ERROR',
                    'error': 'Musical symbols were detected, but the score structure could not be parsed cleanly.',
                    'sectionDiagnostics': combined_diagnostics,
                    'omrAttempted': True,
                }, 0)
                return

        emit_json_and_exit({
            'success': False,
            'errorCode': 'OMR_RECOGNITION_FAILED',
            'error': omr_res.get('error') or (
                'HOMR Optical Music Recognition could not detect clean musical staves from this document. '
                'Please ensure your sheet music has clear staff lines and sufficient contrast.'
            ),
            'sectionDiagnostics': combined_diagnostics,
            'omrAttempted': True,
            'recognitionEngine': 'HOMR (Open-Source OMR)',
            'aiTeacher': 'SmolLM2-360M-Instruct-GGUF'
        }, 0)
        return

    emit_json_and_exit({
        'success': False,
        'errorCode': 'NO_INPUT_PROVIDED',
        'error': 'No sheet music PDF, image, or MusicXML file was provided.'
    }, 0)


if __name__ == '__main__':
    try:
        run_pipeline()
    except Exception as fatal_err:
        sys.stderr.write(f"[ChoirMate Analyze] Unhandled exception: {fatal_err}\n")
        traceback.print_exc(file=sys.stderr)
        emit_json_and_exit({
            'success': False,
            'errorCode': 'INTERNAL_ANALYSIS_ERROR',
            'error': 'Could not complete score recognition on the uploaded file. Please verify the file is a clear PDF, PNG, or JPG of printed sheet music.'
        }, 0)

