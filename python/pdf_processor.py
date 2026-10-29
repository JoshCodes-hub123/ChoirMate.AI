"""
ChoirMate AI - PDF Sheet Music Validation, Rendering & Preprocessing Pipeline.

Provides:
- Strict validation of uploaded PDF bytes (magic header %PDF-, size limits, page-count limits, encryption check).
- Sequential page-by-page rendering via pypdfium2 (with Ghostscript fallback) to avoid loading all high-resolution pages in memory at once.
- Orientation/deskew inspection and gentle contrast normalization that preserves 5-line musical staves, noteheads, stems, and accidentals.
- Document preview extraction (page count, dimensions, and base64 page thumbnails/images).
"""

import io
import os
import sys
import base64
import shutil
import tempfile
import subprocess
from typing import Dict, Any, List, Optional, Tuple
import numpy as np
import cv2
from PIL import Image, ImageOps

MAX_PDF_BYTES = int(os.environ.get("CHOIRMATE_MAX_PDF_BYTES", 25 * 1024 * 1024))  # 25 MB default
MAX_PDF_PAGES = int(os.environ.get("CHOIRMATE_MAX_PDF_PAGES", 12))  # 12 pages default


def decode_pdf_base64(pdf_base64: str) -> bytes:
    """Decodes a base64 or data-URI PDF string into raw bytes and validates basic limits."""
    if not pdf_base64 or not isinstance(pdf_base64, str):
        raise ValueError("Empty PDF data received.")

    raw_b64 = pdf_base64.strip()
    if "," in raw_b64 and raw_b64.split(",", 1)[0].startswith("data:"):
        header = raw_b64.split(",", 1)[0].lower()
        if "pdf" not in header and "octet-stream" not in header:
            raise ValueError("Uploaded file is not a valid PDF document.")
        raw_b64 = raw_b64.split(",", 1)[1].strip()

    try:
        pdf_bytes = base64.b64decode(raw_b64, validate=False)
    except Exception as exc:
        raise ValueError(f"Could not decode PDF base64 payload: {exc}")

    validate_pdf_bytes(pdf_bytes)
    return pdf_bytes


def validate_pdf_bytes(pdf_bytes: bytes, max_bytes: int = MAX_PDF_BYTES) -> None:
    """Validates that the raw bytes represent a non-empty, within-limit PDF file."""
    if not pdf_bytes or len(pdf_bytes) < 64:
        raise ValueError("The uploaded PDF file is empty or truncated.")

    if len(pdf_bytes) > max_bytes:
        limit_mb = max_bytes / (1024 * 1024)
        actual_mb = len(pdf_bytes) / (1024 * 1024)
        raise ValueError(
            f"The PDF file ({actual_mb:.1f} MB) exceeds the {limit_mb:.0f} MB upload limit."
        )

    # Check PDF magic signature within first 1024 bytes
    header_window = pdf_bytes[:1024]
    if b"%PDF-" not in header_window:
        raise ValueError(
            "Invalid PDF format: missing %PDF- header. Please upload a genuine PDF document or PNG/JPG image."
        )


def _correct_page_orientation_and_skew(pil_img: Image.Image) -> Tuple[Image.Image, Dict[str, Any]]:
    """
    Checks rendered page orientation and slight scanner skew without distorting staff lines.
    - If a scanned score was accidentally rotated 90/270 degrees (vertical staff lines dominate horizontal staff lines),
      rotates it upright so horizontal 5-line staves are restored.
    - Applies gentle small-angle deskew (<= 4 degrees) with white border fill if needed.
    """
    info: Dict[str, Any] = {"rotatedDegrees": 0, "deskewAngle": 0.0}
    rgb = pil_img.convert("RGB")
    arr = np.array(rgb)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    # Detect strong horizontal vs vertical staff line energy using morphological open
    inv = 255 - gray
    _, bw = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    h, w = bw.shape[:2]
    horiz_kernel_len = max(25, w // 30)
    vert_kernel_len = max(25, h // 30)

    horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (horiz_kernel_len, 1))
    vert_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, vert_kernel_len))

    horiz_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, horiz_kernel)
    vert_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, vert_kernel)

    horiz_energy = float(np.sum(horiz_lines > 0))
    vert_energy = float(np.sum(vert_lines > 0))

    # If vertical long lines outnumber horizontal long lines by > 2.5x, page is rotated 90 degrees
    if vert_energy > horiz_energy * 2.5 and vert_energy > 2000:
        rgb = rgb.rotate(90, expand=True)
        info["rotatedDegrees"] = 90
        arr = np.array(rgb)
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        inv = 255 - gray
        _, bw = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        h, w = bw.shape[:2]
        horiz_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(25, w // 30), 1))
        horiz_lines = cv2.morphologyEx(bw, cv2.MORPH_OPEN, horiz_kernel)

    # Small-angle deskew check using HoughLinesP on horizontal staff line candidates
    lines = cv2.HoughLinesP(
        horiz_lines,
        rho=1.0,
        theta=np.pi / 720.0,
        threshold=max(60, w // 12),
        minLineLength=max(80, w // 6),
        maxLineGap=15,
    )
    if lines is not None and len(lines) >= 5:
        angles: List[float] = []
        for line in lines[:120]:
            coords = np.asarray(line).reshape(-1)
            if len(coords) >= 4:
                x1, y1, x2, y2 = float(coords[0]), float(coords[1]), float(coords[2]), float(coords[3])
                if abs(x2 - x1) > 40:
                    deg = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
                    if -4.5 <= deg <= 4.5:
                        angles.append(deg)
        if len(angles) >= 5:
            median_angle = float(np.median(angles))
            if 0.35 <= abs(median_angle) <= 4.0:
                center = (w / 2.0, h / 2.0)
                rot_mat = cv2.getRotationMatrix2D(center, median_angle, 1.0)
                deskewed = cv2.warpAffine(
                    arr,
                    rot_mat,
                    (w, h),
                    flags=cv2.INTER_CUBIC,
                    borderMode=cv2.BORDER_CONSTANT,
                    borderValue=(255, 255, 255),
                )
                rgb = Image.fromarray(deskewed)
                info["deskewAngle"] = round(median_angle, 2)

    return rgb, info


def _pil_to_data_url(pil_img: Image.Image, max_width: int = 1600, fmt: str = "PNG") -> str:
    """Encodes a PIL image as a clean data URL for frontend preview & synchronized display."""
    w, h = pil_img.size
    if w > max_width:
        scale = max_width / float(w)
        pil_img = pil_img.resize((max_width, int(round(h * scale))), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    if fmt.upper() == "JPEG":
        pil_img.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
        mime = "image/jpeg"
    else:
        pil_img.save(buf, format="PNG", optimize=True)
        mime = "image/png"
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def render_pdf_document(
    pdf_bytes: bytes,
    max_pages: int = MAX_PDF_PAGES,
    target_long_edge_px: int = 2000,
    preview_only: bool = False,
) -> Dict[str, Any]:
    """
    Validates and sequentially renders a PDF document into high-resolution page images
    suitable for HOMR Optical Music Recognition, plus lightweight display data URLs.

    Returns:
      {
        "success": bool,
        "pageCount": int,
        "processedPages": int,
        "pages": [
          {
            "pageNumber": int,
            "width": int,
            "height": int,
            "pngBytes": bytes (omitted if preview_only=True),
            "dataUrl": str,
            "thumbnailDataUrl": str,
            "rotation": int,
            "deskewAngle": float,
            "status": "ok" | "failed",
            "error": str | None,
          }
        ],
        "pageFailures": [...],
      }
    """
    validate_pdf_bytes(pdf_bytes)

    try:
        import pypdfium2 as pdfium
    except ImportError:
        return _render_pdf_with_ghostscript_fallback(
            pdf_bytes, max_pages=max_pages, preview_only=preview_only
        )

    try:
        doc = pdfium.PdfDocument(pdf_bytes)
    except Exception as open_err:
        err_text = str(open_err)
        if "password" in err_text.lower():
            raise ValueError(
                "This PDF document is password-protected. Please upload an unlocked PDF score."
            )
        raise ValueError(
            "The uploaded PDF file appears to be corrupted or unreadable. Please verify the file and try again."
        )

    try:
        total_pages = len(doc)
    except Exception:
        doc.close()
        raise ValueError("Could not read the page structure of the uploaded PDF file.")

    if total_pages <= 0:
        doc.close()
        raise ValueError("The uploaded PDF contains 0 pages.")

    if total_pages > max_pages:
        doc.close()
        raise ValueError(
            f"This PDF contains {total_pages} pages, which exceeds the {max_pages}-page limit per upload. "
            f"Please upload a PDF with up to {max_pages} pages."
        )

    rendered_pages: List[Dict[str, Any]] = []
    page_failures: List[Dict[str, Any]] = []

    try:
        for idx in range(total_pages):
            page_num = idx + 1
            page_obj = None
            bitmap = None
            try:
                page_obj = doc[idx]
                pw, ph = page_obj.get_size()
                if pw <= 10 or ph <= 10:
                    raise ValueError(f"Page {page_num} has invalid dimensions ({pw}x{ph} pt).")

                long_pt = max(float(pw), float(ph), 1.0)
                if preview_only:
                    scale = min(3.0, max(1.5, 1300.0 / long_pt))
                else:
                    scale = min(3.5, max(2.0, float(target_long_edge_px) / long_pt))

                bitmap = page_obj.render(scale=scale, rotation=0)
                pil_img = bitmap.to_pil()

                if pil_img.mode in ("RGBA", "LA"):
                    white_bg = Image.new("RGBA", pil_img.size, (255, 255, 255, 255))
                    pil_img = Image.alpha_composite(white_bg, pil_img.convert("RGBA")).convert("RGB")
                else:
                    pil_img = pil_img.convert("RGB")

                pil_img, orient_info = _correct_page_orientation_and_skew(pil_img)
                final_w, final_h = pil_img.size

                png_bytes = b""
                if not preview_only:
                    out_buf = io.BytesIO()
                    pil_img.save(out_buf, format="PNG")
                    png_bytes = out_buf.getvalue()

                display_data_url = _pil_to_data_url(pil_img, max_width=1400, fmt="PNG")
                thumb_data_url = _pil_to_data_url(pil_img, max_width=420, fmt="JPEG")

                rendered_pages.append({
                    "pageNumber": page_num,
                    "width": final_w,
                    "height": final_h,
                    "pngBytes": png_bytes,
                    "dataUrl": display_data_url,
                    "thumbnailDataUrl": thumb_data_url,
                    "rotatedDegrees": orient_info["rotatedDegrees"],
                    "deskewAngle": orient_info["deskewAngle"],
                    "status": "ok",
                    "error": None,
                })
            except Exception as page_err:
                sys.stderr.write(f"[PDF Processor] Failed to render page {page_num}: {page_err}\n")
                failure_msg = f"Page {page_num} could not be rendered from the PDF ({page_err})."
                page_failures.append({
                    "page": page_num,
                    "pageNumber": page_num,
                    "system": 0,
                    "systemIndex": 0,
                    "staff": 0,
                    "staffIndex": 0,
                    "status": "failed",
                    "confidence": "low",
                    "severity": "error",
                    "message": failure_msg,
                })
                rendered_pages.append({
                    "pageNumber": page_num,
                    "width": 0,
                    "height": 0,
                    "pngBytes": b"",
                    "dataUrl": "",
                    "thumbnailDataUrl": "",
                    "rotatedDegrees": 0,
                    "deskewAngle": 0.0,
                    "status": "failed",
                    "error": failure_msg,
                })
            finally:
                if bitmap is not None:
                    try:
                        bitmap.close()
                    except Exception:
                        pass
                if page_obj is not None:
                    try:
                        page_obj.close()
                    except Exception:
                        pass
    finally:
        try:
            doc.close()
        except Exception:
            pass

    ok_pages = [p for p in rendered_pages if p["status"] == "ok"]
    if not ok_pages:
        raise ValueError(
            "None of the pages in the uploaded PDF could be rendered. The PDF may be corrupted."
        )

    return {
        "success": True,
        "pageCount": total_pages,
        "processedPages": len(ok_pages),
        "pages": rendered_pages,
        "pageFailures": page_failures,
    }


def _render_pdf_with_ghostscript_fallback(
    pdf_bytes: bytes,
    max_pages: int = MAX_PDF_PAGES,
    preview_only: bool = False,
) -> Dict[str, Any]:
    """Fallback PDF renderer using system `/usr/bin/gs` if pypdfium2 is unavailable."""
    tmp_dir = tempfile.mkdtemp(prefix="choirmate_pdf_")
    pdf_path = os.path.join(tmp_dir, "input.pdf")
    try:
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)

        dpi = 150 if preview_only else 200
        out_pattern = os.path.join(tmp_dir, "page_%03d.png")
        cmd = [
            "gs",
            "-dSAFER",
            "-dBATCH",
            "-dNOPAUSE",
            "-sDEVICE=png16m",
            f"-r{dpi}",
            f"-dFirstPage=1",
            f"-dLastPage={max_pages + 1}",
            f"-sOutputFile={out_pattern}",
            pdf_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        page_files = sorted(
            f for f in os.listdir(tmp_dir) if f.startswith("page_") and f.endswith(".png")
        )
        if proc.returncode != 0 and not page_files:
            raise ValueError("The uploaded PDF file is corrupted or unreadable.")

        if not page_files:
            raise ValueError("No pages could be rendered from the PDF document.")

        if len(page_files) > max_pages:
            raise ValueError(
                f"This PDF exceeds the {max_pages}-page limit per upload. Please upload a PDF with up to {max_pages} pages."
            )

        rendered_pages: List[Dict[str, Any]] = []
        for idx, fname in enumerate(page_files):
            page_num = idx + 1
            fpath = os.path.join(tmp_dir, fname)
            pil_img = Image.open(fpath).convert("RGB")
            pil_img, orient_info = _correct_page_orientation_and_skew(pil_img)
            w, h = pil_img.size
            png_bytes = b""
            if not preview_only:
                buf = io.BytesIO()
                pil_img.save(buf, format="PNG")
                png_bytes = buf.getvalue()

            rendered_pages.append({
                "pageNumber": page_num,
                "width": w,
                "height": h,
                "pngBytes": png_bytes,
                "dataUrl": _pil_to_data_url(pil_img, max_width=1400, fmt="PNG"),
                "thumbnailDataUrl": _pil_to_data_url(pil_img, max_width=420, fmt="JPEG"),
                "rotatedDegrees": orient_info["rotatedDegrees"],
                "deskewAngle": orient_info["deskewAngle"],
                "status": "ok",
                "error": None,
            })

        return {
            "success": True,
            "pageCount": len(rendered_pages),
            "processedPages": len(rendered_pages),
            "pages": rendered_pages,
            "pageFailures": [],
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
