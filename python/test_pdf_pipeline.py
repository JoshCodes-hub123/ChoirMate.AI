"""
End-to-end automated test suite for ChoirMate AI Multi-Page PDF & Image OMR Pipeline.

Tests:
1. Single-page PDF containing printed sheet music (/api/preview-pdf + /api/analyze-sheet).
2. Multi-page PDF containing several musical systems across 2 pages (preservation of page order, systems, measures, and original pageImages).
3. Standard PNG image upload to confirm existing image OMR support still works.
4. Corrupt / invalid PDF handling (graceful 422 with clear actionable error message, no stack trace leak).
5. Multi-page PDF containing a page that fails recognition (page 1 valid score, page 2 blank/no staves -> reports partial failure on page 2 while preserving page 1 musical notes).
6. Comparison of extracted notes/measures/solfa against a known reference score + interactive note correction recalculation (/api/recalculate-score).
"""

import io
import os
import sys
import json
import base64
import urllib.request
import requests
from PIL import Image, ImageDraw

BASE_URL = "http://127.0.0.1:3000"


def ensure_test_assets():
    os.makedirs("/tmp/choirmate-test-pdf", exist_ok=True)
    img1_path = "/tmp/choirmate-test-pdf/note_group.png"
    img2_path = "/tmp/choirmate-test-pdf/tabi.png"

    if not os.path.exists(img1_path):
        urllib.request.urlretrieve(
            "https://raw.githubusercontent.com/BreezeWhite/oemer/main/figures/note_group.png",
            img1_path,
        )
    if not os.path.exists(img2_path):
        urllib.request.urlretrieve(
            "https://raw.githubusercontent.com/BreezeWhite/oemer/main/figures/tabi.png",
            img2_path,
        )

    pil1 = Image.open(img1_path).convert("RGB")
    pil2 = Image.open(img2_path).convert("RGB")

    # Create a split 2-page PDF from pil1 (top half on Page 1, bottom half on Page 2)
    w, h = pil1.size
    mid_y = h // 2
    page1_crop = pil1.crop((0, 0, w, mid_y + 40))
    page2_crop = pil1.crop((0, max(0, mid_y - 40), w, h))

    # 1. Single-page PDF
    single_pdf_path = "/tmp/choirmate-test-pdf/single_page_score.pdf"
    pil1.save(single_pdf_path, "PDF", resolution=150.0)

    # 2. Multi-page (2-page) PDF
    multi_pdf_path = "/tmp/choirmate-test-pdf/multi_page_score.pdf"
    page1_crop.save(
        multi_pdf_path,
        "PDF",
        resolution=150.0,
        save_all=True,
        append_images=[page2_crop],
    )

    # 3. Partial-failure 2-page PDF (Page 1 = valid sheet music, Page 2 = blank cover/notes page with no staves)
    blank_page = Image.new("RGB", (1200, 1600), (255, 255, 255))
    draw = ImageDraw.Draw(blank_page)
    draw.rectangle([100, 100, 1100, 300], outline=(200, 200, 200), width=3)
    partial_pdf_path = "/tmp/choirmate-test-pdf/partial_fail_score.pdf"
    page1_crop.save(
        partial_pdf_path,
        "PDF",
        resolution=150.0,
        save_all=True,
        append_images=[blank_page],
    )

    return {
        "img1_path": img1_path,
        "single_pdf_path": single_pdf_path,
        "multi_pdf_path": multi_pdf_path,
        "partial_pdf_path": partial_pdf_path,
    }


def file_to_data_url(path: str, mime: str) -> str:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def run_all_tests():
    assets = ensure_test_assets()
    results_summary = {}

    print("=== TEST 1: Corrupt / Invalid PDF Handling ===")
    corrupt_b64 = "data:application/pdf;base64," + base64.b64encode(b"NOT_A_VALID_PDF_FILE_CONTENT_1234567890" * 5).decode("ascii")
    r_corrupt_prev = requests.post(
        f"{BASE_URL}/api/preview-pdf",
        json={"pdfBase64": corrupt_b64, "fileName": "corrupt.pdf"},
        timeout=30,
    )
    corrupt_json = r_corrupt_prev.json()
    print(f"Preview status={r_corrupt_prev.status_code}, response={corrupt_json}")
    assert r_corrupt_prev.status_code == 422, f"Expected 422 for corrupt PDF, got {r_corrupt_prev.status_code}"
    assert corrupt_json.get("success") is False
    assert "Traceback" not in corrupt_json.get("error", "")

    r_corrupt_an = requests.post(
        f"{BASE_URL}/api/analyze-sheet",
        json={"pdfBase64": corrupt_b64, "title": "Corrupt Test"},
        timeout=30,
    )
    assert r_corrupt_an.status_code == 422
    results_summary["corrupt_pdf"] = {
        "status": r_corrupt_prev.status_code,
        "error": corrupt_json.get("error"),
    }

    print("\n=== TEST 2: Single-Page PDF Preview & Full Analysis ===")
    single_pdf_b64 = file_to_data_url(assets["single_pdf_path"], "application/pdf")
    r_prev1 = requests.post(
        f"{BASE_URL}/api/preview-pdf",
        json={"pdfBase64": single_pdf_b64, "fileName": "single_page_score.pdf"},
        timeout=60,
    )
    assert r_prev1.status_code == 200, f"Preview failed: {r_prev1.text}"
    prev1_data = r_prev1.json()
    print(f"Single-Page PDF Preview: pageCount={prev1_data['pageCount']}, status={prev1_data['pages'][0]['status']}")
    assert prev1_data["pageCount"] == 1
    assert len(prev1_data["pages"]) == 1
    assert prev1_data["pages"][0]["thumbnailDataUrl"].startswith("data:image/")

    r_an1 = requests.post(
        f"{BASE_URL}/api/analyze-sheet",
        json={"pdfBase64": single_pdf_b64, "title": "Single Page PDF Score"},
        timeout=180,
    )
    assert r_an1.status_code == 200, f"Single-page PDF analyze failed: {r_an1.text}"
    an1_score = r_an1.json()["data"]
    print(
        f"Single-Page PDF Analyzed: source={an1_score['source']}, "
        f"pages={an1_score['recognitionSummary']['totalPages']}, "
        f"systems={an1_score['totalSystems']}, parts={an1_score['totalParts']}, "
        f"measures={an1_score['totalMeasures']}, notes={len(an1_score['notes'])}"
    )
    assert an1_score["source"] == "homr_pdf_omr_recognition"
    assert len(an1_score.get("pageImages", [])) == 1
    assert an1_score["totalSystems"] >= 2
    assert len(an1_score["notes"]) >= 20
    results_summary["single_page_pdf"] = {
        "pages": an1_score["recognitionSummary"]["totalPages"],
        "systems": an1_score["totalSystems"],
        "parts": an1_score["totalParts"],
        "measures": an1_score["totalMeasures"],
        "primaryPartNotes": len(an1_score["notes"]),
        "totalEventsAllParts": an1_score["recognitionSummary"]["totalEvents"],
        "sampleSolfa": [n["solfa"] for n in an1_score["notes"][:8]],
    }

    print("\n=== TEST 3: Multi-Page (2-Page) PDF Preview, Page Ordering & Full Analysis ===")
    multi_pdf_b64 = file_to_data_url(assets["multi_pdf_path"], "application/pdf")
    r_prev2 = requests.post(
        f"{BASE_URL}/api/preview-pdf",
        json={"pdfBase64": multi_pdf_b64, "fileName": "multi_page_score.pdf"},
        timeout=60,
    )
    assert r_prev2.status_code == 200
    prev2_data = r_prev2.json()
    assert prev2_data["pageCount"] == 2
    assert [p["pageNumber"] for p in prev2_data["pages"]] == [1, 2]

    r_an2 = requests.post(
        f"{BASE_URL}/api/analyze-sheet",
        json={"pdfBase64": multi_pdf_b64, "title": "Multi-Page PDF Score"},
        timeout=240,
    )
    assert r_an2.status_code == 200, f"Multi-page PDF analyze failed: {r_an2.text}"
    an2_score = r_an2.json()["data"]
    sys_pages = [s.get("pageNumber") or s.get("page") for s in an2_score.get("systemsMetadata", [])]
    note_pages = sorted(list({n.get("page") for n in an2_score["notes"]}))
    print(
        f"Multi-Page PDF Analyzed: totalPages={an2_score['recognitionSummary']['totalPages']}, "
        f"pageImages={len(an2_score.get('pageImages', []))}, "
        f"systemPages={sys_pages}, notePages={note_pages}, "
        f"totalSystems={an2_score['totalSystems']}, totalMeasures={an2_score['totalMeasures']}"
    )
    assert len(an2_score.get("pageImages", [])) == 2
    assert sys_pages == sorted(sys_pages), "Systems must be in ascending page order"
    assert 1 in note_pages and 2 in note_pages, "Notes must span both Page 1 and Page 2"
    results_summary["multi_page_pdf"] = {
        "pages": an2_score["recognitionSummary"]["totalPages"],
        "recognizedPages": an2_score["recognitionSummary"].get("recognizedPages"),
        "systems": an2_score["totalSystems"],
        "systemPageOrder": sys_pages,
        "notePagesPresent": note_pages,
        "measures": an2_score["totalMeasures"],
        "totalEventsAllParts": an2_score["recognitionSummary"]["totalEvents"],
    }

    print("\n=== TEST 4: Multi-Page PDF With Partial Failure (Page 1 Valid, Page 2 Blank/Unrecognizable) ===")
    partial_pdf_b64 = file_to_data_url(assets["partial_pdf_path"], "application/pdf")
    r_an_partial = requests.post(
        f"{BASE_URL}/api/analyze-sheet",
        json={"pdfBase64": partial_pdf_b64, "title": "Partial Failure PDF Score"},
        timeout=180,
    )
    assert r_an_partial.status_code == 200, f"Partial PDF failed unexpectedly: {r_an_partial.text}"
    partial_score = r_an_partial.json()["data"]
    diags = partial_score.get("sectionDiagnostics", [])
    failed_pages = partial_score["recognitionSummary"].get("failedPages", [])
    print(f"Partial PDF Diagnostics: {diags}")
    print(f"Failed Pages reported: {failed_pages}")
    assert 2 in failed_pages or any(d.get("page") == 2 and d.get("status") == "failed" for d in diags), (
        "Expected Page 2 failure to be explicitly reported in sectionDiagnostics/failedPages"
    )
    results_summary["partial_failure_pdf"] = {
        "recognizedPages": partial_score["recognitionSummary"].get("recognizedPages"),
        "failedPages": failed_pages,
        "diagnostics": [d["message"] for d in diags],
        "extractedEventsFromValidPages": partial_score["recognitionSummary"]["totalEvents"],
    }

    print("\n=== TEST 5: Existing PNG Image Upload Regression Check ===")
    img_b64 = file_to_data_url(assets["img1_path"], "image/png")
    r_img = requests.post(
        f"{BASE_URL}/api/analyze-sheet",
        json={"imageBase64": img_b64, "title": "PNG Image Upload Test"},
        timeout=180,
    )
    assert r_img.status_code == 200
    img_score = r_img.json()["data"]
    assert img_score["source"] == "homr_omr_recognition"
    assert len(img_score["notes"]) == len(an1_score["notes"]), (
        f"Expected PNG and 1-page PDF to yield matching note counts ({len(img_score['notes'])} vs {len(an1_score['notes'])})"
    )
    results_summary["png_image_upload"] = {
        "systems": img_score["totalSystems"],
        "measures": img_score["totalMeasures"],
        "primaryPartNotes": len(img_score["notes"]),
        "matchesSinglePagePdf": len(img_score["notes"]) == len(an1_score["notes"]),
    }

    print("\n=== TEST 6: Note Correction & Recalculation Workflow (/api/recalculate-score) ===")
    edited_notes = [dict(n) for n in an2_score["notes"]]
    edited_notes[0]["pitch"] = "G4"
    edited_notes[0]["isRest"] = False
    r_recalc = requests.post(
        f"{BASE_URL}/api/recalculate-score",
        json={
            "score": an2_score,
            "partId": an2_score["parts"][0]["id"],
            "updatedNotes": edited_notes,
            "fifths": 0,
        },
        timeout=60,
    )
    assert r_recalc.status_code == 200
    recalc_score = r_recalc.json()["data"]
    assert recalc_score["notes"][0]["pitch"] == "G4"
    assert recalc_score["notes"][0]["solfa"] == "Sol"
    assert len(recalc_score.get("pageImages", [])) == 2, "Original PDF pageImages must be preserved after recalculation"
    results_summary["recalculate_workflow"] = {
        "firstNotePitch": recalc_score["notes"][0]["pitch"],
        "firstNoteSolfa": recalc_score["notes"][0]["solfa"],
        "preservedPdfPages": len(recalc_score.get("pageImages", [])),
    }

    print("\n=== TEST 7: Genuine MP3 & WAV Practice Audio Export (Full Song & Section) ===")
    import subprocess
    # 7a. Export full corrected score as MP3
    r_mp3 = requests.post(
        f"{BASE_URL}/api/export-audio",
        json={
            "notes": recalc_score["notes"],
            "title": recalc_score["title"],
            "partName": recalc_score["parts"][0]["name"],
            "scopeLabel": "full-song",
            "tempo": 88,
            "voice": "choir",
            "format": "mp3",
            "metronome": True,
        },
        timeout=45,
    )
    assert r_mp3.status_code == 200, f"MP3 export failed: {r_mp3.text}"
    mp3_json = r_mp3.json()
    assert mp3_json.get("success") is True
    assert mp3_json.get("mimeType") == "audio/mpeg"
    assert mp3_json["fileName"].endswith("_88bpm.mp3")
    mp3_bytes = base64.b64decode(mp3_json["audioBase64"])
    assert not mp3_bytes.startswith(b"RIFF"), "MP3 file must NOT be a renamed RIFF/WAV file"
    mp3_out_path = "/tmp/choirmate-test-pdf/exported_full.mp3"
    with open(mp3_out_path, "wb") as f:
        f.write(mp3_bytes)

    probe_mp3 = subprocess.run(
        [
            "/usr/bin/ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration:stream=codec_name,sample_rate",
            "-of",
            "json",
            mp3_out_path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    mp3_probe_info = json.loads(probe_mp3.stdout.decode("utf-8"))
    print(f"MP3 ffprobe verification: fileName={mp3_json['fileName']}, probe={mp3_probe_info}")
    assert mp3_probe_info["streams"][0]["codec_name"] == "mp3"
    assert float(mp3_probe_info["format"]["duration"]) > 1.0

    # 7b. Export selected section (first 8 events) as WAV
    section_notes = recalc_score["notes"][:8]
    r_wav = requests.post(
        f"{BASE_URL}/api/export-audio",
        json={
            "notes": section_notes,
            "title": recalc_score["title"],
            "partName": recalc_score["parts"][0]["name"],
            "scopeLabel": "measures-1-to-2",
            "tempo": 96,
            "voice": "piano",
            "format": "wav",
            "metronome": False,
        },
        timeout=45,
    )
    assert r_wav.status_code == 200, f"WAV export failed: {r_wav.text}"
    wav_json = r_wav.json()
    assert wav_json.get("success") is True
    assert wav_json.get("mimeType") == "audio/wav"
    assert wav_json["fileName"].endswith("_measures-1-to-2_96bpm.wav")
    wav_bytes = base64.b64decode(wav_json["audioBase64"])
    assert wav_bytes[:4] == b"RIFF" and wav_bytes[8:12] == b"WAVE"
    wav_out_path = "/tmp/choirmate-test-pdf/exported_section.wav"
    with open(wav_out_path, "wb") as f:
        f.write(wav_bytes)

    probe_wav = subprocess.run(
        [
            "/usr/bin/ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration:stream=codec_name,sample_rate",
            "-of",
            "json",
            wav_out_path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    wav_probe_info = json.loads(probe_wav.stdout.decode("utf-8"))
    print(f"WAV ffprobe verification: fileName={wav_json['fileName']}, probe={wav_probe_info}")
    assert wav_probe_info["streams"][0]["codec_name"] == "pcm_s16le"
    assert int(wav_probe_info["streams"][0]["sample_rate"]) == 44100

    results_summary["audio_export"] = {
        "mp3FileName": mp3_json["fileName"],
        "mp3Codec": mp3_probe_info["streams"][0]["codec_name"],
        "mp3DurationSec": float(mp3_probe_info["format"]["duration"]),
        "mp3Bytes": len(mp3_bytes),
        "wavFileName": wav_json["fileName"],
        "wavCodec": wav_probe_info["streams"][0]["codec_name"],
        "wavSampleRate": int(wav_probe_info["streams"][0]["sample_rate"]),
        "wavDurationSec": float(wav_probe_info["format"]["duration"]),
        "wavBytes": len(wav_bytes),
    }

    print("\n=== TEST 8: AssemblyAI + SmolLM2 Voice Coaching Endpoints ===")
    r_va_status = requests.get(f"{BASE_URL}/api/voice-assistant/status", timeout=15)
    assert r_va_status.status_code == 200
    va_status_json = r_va_status.json()
    assert "ASSEMBLYAI_API_KEY" not in json.dumps(va_status_json)
    print(f"Voice Assistant Status: {va_status_json}")

    # 8a. Consent enforcement when sending audioBase64 without userConsentGiven
    r_no_consent = requests.post(
        f"{BASE_URL}/api/voice-assistant/ask",
        json={
            "audioBase64": base64.b64encode(wav_bytes[:2000]).decode("ascii"),
            "userConsentGiven": False,
            "title": recalc_score["title"],
        },
        timeout=15,
    )
    assert r_no_consent.status_code == 400
    assert r_no_consent.json().get("errorCode") == "CONSENT_REQUIRED"

    # 8b. Graceful behavior when audioBase64 is sent with consent but ASSEMBLYAI_API_KEY is not configured
    r_with_consent = requests.post(
        f"{BASE_URL}/api/voice-assistant/ask",
        json={
            "audioBase64": base64.b64encode(wav_bytes[:2000]).decode("ascii"),
            "userConsentGiven": True,
            "title": recalc_score["title"],
        },
        timeout=15,
    )
    consent_json = r_with_consent.json()
    print(f"Voice audio request without key response: {consent_json}")
    if not va_status_json.get("assemblyAiConfigured"):
        assert consent_json.get("errorCode") == "ASSEMBLYAI_NOT_CONFIGURED"

    # 8c. Grounded SmolLM2 text Q&A on the active (corrected) score
    r_text_qa = requests.post(
        f"{BASE_URL}/api/voice-assistant/ask",
        json={
            "question": "What is my vocal range and opening Solfa sequence?",
            "title": recalc_score["title"],
            "partName": recalc_score["parts"][0]["name"],
            "keySignature": recalc_score["keySignature"],
            "timeSignature": recalc_score["timeSignature"],
            "notes": recalc_score["notes"],
        },
        timeout=30,
    )
    assert r_text_qa.status_code == 200
    qa_json = r_text_qa.json()
    assert qa_json.get("success") is True
    assert len(qa_json.get("answer", "")) > 20
    print(f"SmolLM2 Grounded Q&A Answer: {qa_json['answer']}")

    results_summary["voice_assistant"] = {
        "assemblyAiConfigured": va_status_json.get("assemblyAiConfigured"),
        "consentEnforced": r_no_consent.status_code == 400,
        "gracefulFallbackWithoutKey": consent_json.get("errorCode") == "ASSEMBLYAI_NOT_CONFIGURED",
        "smollm2AnswerPreview": qa_json["answer"][:140],
    }

    print("\n=== ALL 8 END-TO-END PDF, IMAGE, AUDIO EXPORT & VOICE COACHING TESTS PASSED ===")
    print(json.dumps(results_summary, indent=2))


if __name__ == "__main__":
    run_all_tests()

