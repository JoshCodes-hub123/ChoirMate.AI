"""
ChoirMate AI - Full-Score Optical Music Recognition Engine (HOMR Direct Pipeline).

Fixes root-cause defects in HOMR's default CLI pipeline:
1. Bypasses HOMR's `_create_grandstaffs()` which blindly merges staff pairs (0&1, 2&3)
   into a single low-resolution crop, halving vertical resolution and mangling choir parts.
2. Bypasses HOMR's `_ensure_same_number_of_staffs()` which silently deletes the first or last
   system when staff counts vary across systems.
3. Processes every detected staff individually at full vertical resolution while grouping staves
   into systems in top-to-bottom reading order using vertical gap clustering and brace/barline spans.
4. Preserves normalized [0..1] bounding boxes (`x, y, width, height`) on the original image
   for every system and staff so the UI can synchronize recognized notes with the original score.
5. Propagates key signature and intra-measure accidentals across notes in the same measure.
6. Supports single-page and multi-page score uploads with honest per-section diagnostics.
"""

import os
import io
import sys
import base64
import tempfile
import threading
import traceback
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import cv2
from PIL import Image, ImageOps

from homr.main import (
    autocrop,
    resize_image,
    get_predictions,
    filter_predictions,
    make_lines_stronger,
    predict_symbols,
    break_wide_fragments,
    combine_noteheads_with_stems,
    detect_bar_lines,
    detect_staff,
    add_notes_to_staffs,
    download_weights,
)
from homr import color_adjust, constants
from homr.debug import Debug
from homr.brace_dot_detection import (
    prepare_brace_dot_image,
    _filter_for_tall_elements,
    _get_connections_between_staffs,
)
from homr.bounding_boxes import create_rotated_bounding_boxes
from homr.staff_regions import StaffRegions
from homr.model import Staff, MultiStaff
from homr.staff_parsing import prepare_staff_image
from homr.transformer.configs import default_config
from homr.transformer.staff2score import Staff2Score
from homr.transformer.vocabulary import (
    EncodedSymbol,
    remove_duplicated_symbols,
    empty,
    nonote,
)
from homr.music_xml_generator import generate_xml, XmlGeneratorArguments

_STAFF2SCORE_SINGLETON: Optional[Staff2Score] = None
_WEIGHTS_VERIFIED: bool = False
_OMR_LOCK = threading.Lock()

SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"]


def ensure_homr_weights() -> None:
    """Ensures HOMR ONNX segmentation and transformer weights are downloaded."""
    global _WEIGHTS_VERIFIED
    if not _WEIGHTS_VERIFIED:
        download_weights(False)
        _WEIGHTS_VERIFIED = True


def get_staff2score() -> Staff2Score:
    """Lazily initializes and caches the TrOMR Staff2Score model in memory."""
    global _STAFF2SCORE_SINGLETON
    ensure_homr_weights()
    default_config.use_gpu_inference = False
    if _STAFF2SCORE_SINGLETON is None:
        _STAFF2SCORE_SINGLETON = Staff2Score(default_config)
    return _STAFF2SCORE_SINGLETON


def preprocess_image_bytes(image_bytes: bytes) -> Tuple[str, int, int]:
    """
    Normalizes an uploaded score image:
    - Applies EXIF orientation transpose.
    - Composites RGBA/LA/P transparency onto pure white (255, 255, 255) so OpenCV never sees black backgrounds.
    - Upscales low-resolution images (< 1000px wide) using Lanczos resampling so staff lines are sharp.
    Returns (temp_png_path, original_width, original_height).
    """
    if not image_bytes or len(image_bytes) < 32:
        raise ValueError("Uploaded image data is empty or truncated.")

    pil_img = Image.open(io.BytesIO(image_bytes))
    pil_img = ImageOps.exif_transpose(pil_img)

    if pil_img.mode in ("RGBA", "LA") or (pil_img.mode == "P" and "transparency" in pil_img.info):
        rgba = pil_img.convert("RGBA")
        white_bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        pil_img = Image.alpha_composite(white_bg, rgba).convert("RGB")
    else:
        pil_img = pil_img.convert("RGB")

    orig_w, orig_h = pil_img.size
    if orig_w < 32 or orig_h < 32:
        raise ValueError(
            f"Image dimensions ({orig_w}x{orig_h}px) are too small to contain readable musical staves."
        )

    if orig_w < 1000:
        scale = 1400.0 / max(orig_w, 1)
        new_w = int(round(orig_w * scale))
        new_h = int(round(orig_h * scale))
        pil_img = pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        pil_img.save(tmp.name, format="PNG")
        return tmp.name, orig_w, orig_h


def _group_staffs_into_systems(staffs: List[Staff], brace_dot: list) -> List[List[Staff]]:
    """
    Groups detected staves into systems in top-to-bottom reading order WITHOUT calling
    `_create_grandstaffs()` (so each staff remains an independent Staff object for full-resolution OMR).
    """
    sorted_staffs = sorted(staffs, key=lambda s: float(s.min_y))
    n = len(sorted_staffs)
    if n == 0:
        return []
    if n == 1:
        return [sorted_staffs]

    gaps: List[float] = []
    connected_by_brace: List[bool] = []

    for i in range(n - 1):
        s_curr = sorted_staffs[i]
        s_next = sorted_staffs[i + 1]
        gap = max(0.0, float(s_next.min_y) - float(s_curr.max_y))
        gaps.append(gap)

        has_spanning_connector = False
        try:
            connections = _get_connections_between_staffs(s_curr, s_next, brace_dot)
            if len(connections) >= constants.minimum_connections_to_form_combined_staff:
                has_spanning_connector = True
        except Exception:
            pass

        if not has_spanning_connector:
            curr_cy = (float(s_curr.min_y) + float(s_curr.max_y)) / 2.0
            next_cy = (float(s_next.min_y) + float(s_next.max_y)) / 2.0
            mid_y = (float(s_curr.max_y) + float(s_next.min_y)) / 2.0
            for bd in brace_dot:
                bd_min_y = float(bd.top_left[1])
                bd_max_y = float(bd.bottom_right[1])
                if bd_min_y <= curr_cy and bd_max_y >= next_cy:
                    if float(bd.size[0]) < float(s_curr.average_unit_size) * 4:
                        has_spanning_connector = True
                        break
                elif bd_min_y < mid_y < bd_max_y and float(bd.size[1]) > gap * 0.75:
                    has_spanning_connector = True
                    break

        connected_by_brace.append(has_spanning_connector)

    min_gap = min(gaps)
    max_gap = max(gaps)

    systems: List[List[Staff]] = [[sorted_staffs[0]]]

    if any(connected_by_brace) and not all(connected_by_brace):
        for i in range(n - 1):
            if connected_by_brace[i]:
                systems[-1].append(sorted_staffs[i + 1])
            else:
                systems.append([sorted_staffs[i + 1]])
    elif max_gap > min_gap * 1.35 and n >= 4:
        threshold = (min_gap + max_gap) / 2.0
        for i in range(n - 1):
            if gaps[i] <= threshold:
                systems[-1].append(sorted_staffs[i + 1])
            else:
                systems.append([sorted_staffs[i + 1]])
    else:
        for i in range(n - 1):
            systems.append([sorted_staffs[i + 1]])

    return systems


def _apply_key_and_measure_accidentals(symbols: List[EncodedSymbol]) -> List[EncodedSymbol]:
    """
    Propagates key signature sharps/flats and intra-measure accidentals (#, b, N)
    across notes within the same measure so MusicXML <alter> tags are accurate.
    Uses `homr.transformer.vocabulary.EncodedSymbol.lift` and `.change_lift()`.
    """
    current_fifths = 0
    key_step_alter: Dict[str, str] = {}
    measure_pitch_alter: Dict[str, str] = {}

    def rebuild_key_map(fifths: int) -> Dict[str, str]:
        mapping: Dict[str, str] = {}
        if fifths > 0:
            for s in SHARP_ORDER[:min(fifths, 7)]:
                mapping[s] = "#"
        elif fifths < 0:
            for s in FLAT_ORDER[:min(-fifths, 7)]:
                mapping[s] = "b"
        return mapping

    fifths_name_map = {
        "C": 0, "G": 1, "D": 2, "A": 3, "E": 4, "B": 5, "F#": 6, "C#": 7,
        "F": -1, "Bb": -2, "Eb": -3, "Ab": -4, "Db": -5, "Gb": -6, "Cb": -7,
    }

    result: List[EncodedSymbol] = []
    for sym in symbols:
        r = sym.rhythm
        if r.startswith("keySignature_"):
            ks_type = r.split("_", 1)[1]
            if ks_type.lstrip("-").isdigit():
                current_fifths = int(ks_type)
            else:
                current_fifths = fifths_name_map.get(ks_type, 0)
            key_step_alter = rebuild_key_map(current_fifths)
            measure_pitch_alter.clear()
            result.append(sym)
        elif "barline" in r or "repeat" in r or r in ("|", "newline"):
            measure_pitch_alter.clear()
            result.append(sym)
        elif r.startswith("note_"):
            p = sym.pitch
            if not p or p in (empty, nonote) or len(p) < 2:
                result.append(sym)
                continue
            step = p[0].upper()
            explicit_lift = sym.lift
            if explicit_lift in ("#", "##", "b", "bb", "N"):
                measure_pitch_alter[p] = empty if explicit_lift == "N" else explicit_lift
                result.append(sym)
            elif p in measure_pitch_alter:
                result.append(sym.change_lift(measure_pitch_alter[p]))
            elif step in key_step_alter:
                result.append(sym.change_lift(key_step_alter[step]))
            else:
                result.append(sym)
        else:
            result.append(sym)

    return result


def _normalize_tokens_for_voice(system_token_lists: List[List[EncodedSymbol]]) -> List[EncodedSymbol]:
    """
    Combines a voice's tokens across all systems in reading order:
    - Inserts `barline` (if missing at end of system) + `newline` markers between systems
      so `homr.music_xml_generator` emits `<print new-system="yes"/>`.
    - Deduplicates repeated clefs/key signatures at system starts while preserving intentional clef/key changes.
    - Propagates key signature and measure accidentals.
    """
    if not system_token_lists:
        return []

    initial_clef: Optional[EncodedSymbol] = None
    initial_key: Optional[EncodedSymbol] = None
    initial_time: Optional[EncodedSymbol] = None

    for sys_tokens in system_token_lists:
        for t in sys_tokens[:6]:
            if initial_clef is None and t.rhythm.startswith("clef_"):
                initial_clef = t.to_upper_position()
            elif initial_key is None and t.rhythm.startswith("keySignature_"):
                initial_key = t
            elif initial_time is None and t.rhythm.startswith("timeSignature"):
                initial_time = t

    non_empty_systems = [ [t.to_upper_position() for t in st if not t.is_control_symbol()] for st in system_token_lists if st ]
    non_empty_systems = [ st for st in non_empty_systems if st ]
    if not non_empty_systems:
        return []

    combined: List[EncodedSymbol] = []
    for sys_idx, cleaned in enumerate(non_empty_systems):
        if sys_idx > 0:
            while cleaned and cleaned[0].rhythm.startswith(("clef_", "keySignature_", "timeSignature")):
                tok = cleaned[0]
                if tok.rhythm.startswith("clef_") and initial_clef and tok.rhythm != initial_clef.rhythm:
                    break
                if tok.rhythm.startswith("keySignature_") and initial_key and tok.rhythm != initial_key.rhythm:
                    break
                if tok.rhythm.startswith("timeSignature") and initial_time and tok.rhythm != initial_time.rhythm:
                    break
                cleaned.pop(0)

            if combined:
                last_r = combined[-1].rhythm
                if not ("barline" in last_r or "repeat" in last_r):
                    combined.append(EncodedSymbol("barline"))
                combined.append(EncodedSymbol("newline"))

        combined.extend(cleaned)

    has_clef = any(t.rhythm.startswith("clef_") for t in combined[:4])
    if not has_clef:
        combined.insert(0, initial_clef or EncodedSymbol("clef_G2", position="upper"))

    has_time = any(t.rhythm.startswith("timeSignature") for t in combined[:6])
    if not has_time:
        insert_pos = 1
        for i, t in enumerate(combined[:6]):
            if t.rhythm.startswith(("clef_", "keySignature_")):
                insert_pos = i + 1
        combined.insert(insert_pos, initial_time or EncodedSymbol("timeSignature/4"))

    deduped = remove_duplicated_symbols(combined)
    return _apply_key_and_measure_accidentals(deduped)


def _infer_part_names(num_parts: int, clefs: List[str]) -> List[str]:
    if num_parts == 1:
        return ["Melody (Lead Vocal)"]
    if num_parts == 2:
        if clefs == ["treble", "bass"]:
            return ["Treble Voices (Soprano / Alto)", "Bass Voices (Tenor / Bass)"]
        return ["Part 1 (Soprano / Upper Voice)", "Part 2 (Alto / Lower Voice)"]
    if num_parts == 3:
        return ["Part 1 (Soprano)", "Part 2 (Alto)", "Part 3 (Tenor / Bass)"]
    if num_parts == 4:
        return ["Soprano", "Alto", "Tenor", "Bass"]
    return [f"Vocal Part {i + 1}" for i in range(num_parts)]


def recognize_score_pages(
    pages_input: List[Any],
    title: Optional[str] = None,
    page_numbers: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Processes one or more pages of printed sheet music in reading order.
    Accepts either raw bytes or base64 data URLs/strings per page.
    Preserves page, system, staff, and measure hierarchy + bounding boxes.
    """
    if not pages_input:
        return {"success": False, "error": "No score page images were provided."}

    pages_bytes: List[Tuple[int, bytes]] = []
    for idx, item in enumerate(pages_input):
        page_num = page_numbers[idx] if (page_numbers and idx < len(page_numbers)) else (idx + 1)
        if isinstance(item, bytes):
            pages_bytes.append((page_num, item))
        elif isinstance(item, str):
            try:
                clean_b64 = item.split(",")[-1].strip()
                decoded = base64.b64decode(clean_b64)
                if len(decoded) > 16 * 1024 * 1024:
                    return {
                        "success": False,
                        "error": f"Page {page_num} exceeds the 16MB image limit."
                    }
                pages_bytes.append((page_num, decoded))
            except Exception as e:
                return {
                    "success": False,
                    "error": f"Invalid base64 image encoding on page {page_num}: {e}"
                }
        else:
            return {"success": False, "error": f"Unsupported page input type on page {page_num}"}

    with _OMR_LOCK:
        try:
            s2s = get_staff2score()
        except Exception as init_err:
            sys.stderr.write(f"[OMR Engine] Failed to initialize HOMR Staff2Score: {init_err}\n")
            traceback.print_exc(file=sys.stderr)
            return {
                "success": False,
                "error": "Optical Music Recognition model could not be initialized. Please try again.",
            }

        all_systems_metadata: List[Dict[str, Any]] = []
        all_section_diagnostics: List[Dict[str, Any]] = []
        page_systems_tokens: List[Tuple[int, int, List[List[EncodedSymbol]]]] = []
        max_parts_across_pages = 1
        modal_parts_candidates: List[int] = []

        global_system_counter = 0
        total_segmented_noteheads = 0
        total_recognized_notes = 0
        total_staves_count = 0

        for page_num, img_bytes in pages_bytes:
            try:
                tmp_path, orig_w, orig_h = preprocess_image_bytes(img_bytes)
            except Exception as img_err:
                all_section_diagnostics.append({
                    "page": page_num,
                    "pageNumber": page_num,
                    "system": 0,
                    "systemIndex": 0,
                    "staff": 0,
                    "staffIndex": 0,
                    "status": "failed",
                    "confidence": "low",
                    "severity": "error",
                    "message": f"Page {page_num} could not be decoded as a valid sheet music image: {img_err}"
                })
                continue

            try:
                raw_img = cv2.imread(tmp_path)
                if raw_img is None:
                    all_section_diagnostics.append({
                        "page": page_num,
                        "pageNumber": page_num,
                        "system": 0,
                        "systemIndex": 0,
                        "staff": 0,
                        "staffIndex": 0,
                        "status": "failed",
                        "confidence": "low",
                        "severity": "error",
                        "message": f"Page {page_num} could not be decoded as a valid image."
                    })
                    continue

                try:
                    cropped_img = autocrop(raw_img)
                    if cropped_img is None or cropped_img.shape[0] < 60 or cropped_img.shape[1] < 200:
                        cropped_img = raw_img
                except Exception:
                    cropped_img = raw_img

                crop_h, crop_w = cropped_img.shape[:2]
                raw_h, raw_w = raw_img.shape[:2]
                offset_x = max(0, (raw_w - crop_w) // 2)
                offset_y = max(0, (raw_h - crop_h) // 2)

                resized_img = resize_image(cropped_img)
                proc_h, proc_w = resized_img.shape[:2]

                preprocessed = color_adjust.apply_clahe(resized_img)
                predictions = get_predictions(resized_img, preprocessed, tmp_path, False, False)
                debug = Debug(predictions.original, tmp_path, False)
                predictions = filter_predictions(predictions, debug)
                predictions.staff = make_lines_stronger(predictions.staff, (1, 2))

                symbols = predict_symbols(debug, predictions)
                symbols.staff_fragments = break_wide_fragments(symbols.staff_fragments)
                noteheads_with_stems = combine_noteheads_with_stems(symbols.noteheads, symbols.stems_rest)

                if len(noteheads_with_stems) == 0:
                    all_section_diagnostics.append({
                        "page": page_num,
                        "pageNumber": page_num,
                        "system": 0,
                        "systemIndex": 0,
                        "staff": 0,
                        "staffIndex": 0,
                        "status": "failed",
                        "confidence": "low",
                        "severity": "error",
                        "message": f"Page {page_num}: No musical noteheads were detected on this page."
                    })
                    continue

                avg_nh_height = float(np.median([nh.notehead.size[1] for nh in noteheads_with_stems]))
                all_nh = [nh.notehead for nh in noteheads_with_stems]
                all_stems = [n.stem for n in noteheads_with_stems if n.stem is not None]
                bars = [
                    line for line in symbols.bar_lines
                    if not line.is_overlapping_with_any(all_nh)
                    and not line.is_overlapping_with_any(all_stems)
                ]
                bar_line_boxes = detect_bar_lines(bars, avg_nh_height)

                try:
                    staffs = detect_staff(
                        debug, predictions.staff, symbols.staff_fragments, symbols.clefs_keys, bar_line_boxes
                    )
                except Exception as staff_det_err:
                    sys.stderr.write(f"[OMR Engine] Staff detection failed on page {page_num}: {staff_det_err}\n")
                    staffs = []

                if len(staffs) == 0:
                    all_section_diagnostics.append({
                        "page": page_num,
                        "pageNumber": page_num,
                        "system": 0,
                        "systemIndex": 0,
                        "staff": 0,
                        "staffIndex": 0,
                        "status": "failed",
                        "confidence": "low",
                        "severity": "error",
                        "message": f"Page {page_num}: No 5-line musical staves could be segmented on this page."
                    })
                    continue

                add_notes_to_staffs(staffs, noteheads_with_stems, predictions.symbols, predictions.notehead)

                brace_dot_img = prepare_brace_dot_image(predictions.symbols, predictions.staff)
                brace_dot = create_rotated_bounding_boxes(brace_dot_img, skip_merging=True, max_size=(100, -1))
                brace_dot = _filter_for_tall_elements(brace_dot, staffs)

                systems_staffs: List[List[Staff]] = _group_staffs_into_systems(staffs, brace_dot)
                all_individual_ms = [MultiStaff([s], []) for s in sorted(staffs, key=lambda st: st.min_y)]
                regions = StaffRegions(all_individual_ms)

                staff_counts = [len(sys_st) for sys_st in systems_staffs]
                if staff_counts:
                    modal_parts_candidates.extend(staff_counts)
                    max_parts_across_pages = max(max_parts_across_pages, max(staff_counts))

                global_staff_idx = 0
                for sys_local_idx, sys_staff_list in enumerate(systems_staffs):
                    global_system_counter += 1
                    sys_num = global_system_counter

                    sys_min_x = min(float(s.min_x) for s in sys_staff_list)
                    sys_max_x = max(float(s.max_x) for s in sys_staff_list)
                    sys_min_y = min(float(s.min_y) for s in sys_staff_list)
                    sys_max_y = max(float(s.max_y) for s in sys_staff_list)

                    pad_y = float(sys_staff_list[0].average_unit_size) * 3.5

                    def to_orig_bbox(x0: float, y0: float, x1: float, y1: float) -> Dict[str, float]:
                        cx0 = (x0 / max(proc_w, 1)) * crop_w + offset_x
                        cy0 = (y0 / max(proc_h, 1)) * crop_h + offset_y
                        cx1 = (x1 / max(proc_w, 1)) * crop_w + offset_x
                        cy1 = (y1 / max(proc_h, 1)) * crop_h + offset_y
                        nx = max(0.0, min(1.0, cx0 / max(raw_w, 1)))
                        ny = max(0.0, min(1.0, cy0 / max(raw_h, 1)))
                        nw = max(0.02, min(1.0 - nx, (cx1 - cx0) / max(raw_w, 1)))
                        nh = max(0.02, min(1.0 - ny, (cy1 - cy0) / max(raw_h, 1)))
                        return {
                            "x": round(nx, 4),
                            "y": round(ny, 4),
                            "width": round(nw, 4),
                            "height": round(nh, 4),
                        }

                    sys_bbox = to_orig_bbox(
                        sys_min_x - 20, sys_min_y - pad_y, sys_max_x + 20, sys_max_y + pad_y
                    )

                    staves_meta: List[Dict[str, Any]] = []
                    sys_decoded_tokens: List[List[EncodedSymbol]] = []

                    for local_idx, staff_obj in enumerate(sys_staff_list):
                        seg_notes = staff_obj.get_number_of_notes()
                        staff_bbox = to_orig_bbox(
                            float(staff_obj.min_x) - 15,
                            float(staff_obj.min_y) - pad_y,
                            float(staff_obj.max_x) + 15,
                            float(staff_obj.max_y) + pad_y,
                        )

                        try:
                            staff_img, _ = prepare_staff_image(
                                debug, global_staff_idx, staff_obj, predictions.preprocessed, regions=regions
                            )
                            raw_tokens = s2s.predict(staff_img)
                            tokens = [r for r in raw_tokens if r.position != "lower"]
                            if not tokens and raw_tokens:
                                tokens = [r.to_upper_position() for r in raw_tokens]
                        except Exception as st_err:
                            sys.stderr.write(
                                f"[OMR Engine] Staff decoding error (p.{page_num}, sys.{sys_num}, st.{local_idx+1}): {st_err}\n"
                            )
                            traceback.print_exc(file=sys.stderr)
                            tokens = []
                            all_section_diagnostics.append({
                                "page": page_num,
                                "pageNumber": page_num,
                                "system": sys_num,
                                "systemIndex": sys_num,
                                "staff": local_idx + 1,
                                "staffIndex": local_idx + 1,
                                "status": "failed",
                                "confidence": "low",
                                "severity": "error",
                                "message": f"Page {page_num}, System {sys_num}, Staff {local_idx + 1} failed OMR decoding."
                            })

                        rec_notes = sum(1 for t in tokens if t.rhythm.startswith("note_"))
                        rec_rests = sum(1 for t in tokens if t.rhythm.startswith("rest_"))
                        rec_bars = sum(1 for t in tokens if "barline" in t.rhythm or "repeat" in t.rhythm)

                        total_segmented_noteheads += seg_notes
                        total_recognized_notes += rec_notes
                        total_staves_count += 1

                        if len(tokens) == 0 or (seg_notes > 3 and rec_notes == 0):
                            confidence = "low"
                            all_section_diagnostics.append({
                                "page": page_num,
                                "pageNumber": page_num,
                                "system": sys_num,
                                "systemIndex": sys_num,
                                "staff": local_idx + 1,
                                "staffIndex": local_idx + 1,
                                "status": "failed",
                                "confidence": "low",
                                "severity": "error",
                                "message": (
                                    f"Page {page_num}, System {sys_num}, Staff {local_idx + 1}: "
                                    f"Detected {seg_notes} noteheads during segmentation, but 0 notes could be decoded."
                                )
                            })
                        elif seg_notes > 0 and abs(rec_notes - seg_notes) / max(seg_notes, 1) > 0.35:
                            confidence = "medium"
                            all_section_diagnostics.append({
                                "page": page_num,
                                "pageNumber": page_num,
                                "system": sys_num,
                                "systemIndex": sys_num,
                                "staff": local_idx + 1,
                                "staffIndex": local_idx + 1,
                                "status": "warning",
                                "confidence": "medium",
                                "severity": "warning",
                                "message": (
                                    f"Page {page_num}, System {sys_num}, Staff {local_idx + 1}: "
                                    f"Segmented {seg_notes} noteheads vs {rec_notes} decoded notes. Review recommended."
                                )
                            })
                        else:
                            confidence = "high"

                        staves_meta.append({
                            "staffIndex": local_idx + 1,
                            "staffIndexInSystem": local_idx + 1,
                            "globalStaffNumber": total_staves_count,
                            "partIndex": local_idx,
                            "page": page_num,
                            "pageNumber": page_num,
                            "segmentedNoteheads": seg_notes,
                            "recognizedNotes": rec_notes,
                            "recognizedRests": rec_rests,
                            "recognizedBarlines": rec_bars,
                            "measureCount": max(1, rec_bars),
                            "clef": "bass" if any(t.rhythm.startswith("clef_F") for t in tokens[:6]) else "treble",
                            "keyFifths": 0,
                            "confidence": confidence,
                            "status": "ok" if confidence == "high" else "warning",
                            "bbox": staff_bbox,
                        })

                        sys_decoded_tokens.append(tokens)
                        global_staff_idx += 1

                    sys_seg = sum(st["segmentedNoteheads"] for st in staves_meta)
                    sys_rec = sum(st["recognizedNotes"] for st in staves_meta)
                    sys_conf = "low" if any(st["confidence"] == "low" for st in staves_meta) else (
                        "medium" if any(st["confidence"] == "medium" for st in staves_meta) else "high"
                    )
                    all_systems_metadata.append({
                        "page": page_num,
                        "pageNumber": page_num,
                        "systemNumber": sys_num,
                        "systemIndex": sys_num,
                        "pageSystemNumber": sys_local_idx + 1,
                        "staffCount": len(sys_staff_list),
                        "measureCount": max((st["measureCount"] for st in staves_meta), default=1),
                        "segmentedNoteheads": sys_seg,
                        "recognizedNotes": sys_rec,
                        "confidence": sys_conf,
                        "bbox": sys_bbox,
                        "staves": staves_meta,
                    })
                    page_systems_tokens.append((page_num, sys_num, sys_decoded_tokens))
            except Exception as page_err:
                sys.stderr.write(f"[OMR Engine] Page {page_num} processing failed: {page_err}\n")
                traceback.print_exc(file=sys.stderr)
                all_section_diagnostics.append({
                    "page": page_num,
                    "pageNumber": page_num,
                    "system": 0,
                    "systemIndex": 0,
                    "staff": 0,
                    "staffIndex": 0,
                    "status": "failed",
                    "confidence": "low",
                    "severity": "error",
                    "message": f"Page {page_num} could not be processed by Optical Music Recognition."
                })
            finally:
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        if not page_systems_tokens:
            err_msg = (
                all_section_diagnostics[0]["message"]
                if all_section_diagnostics
                else "HOMR Optical Music Recognition could not detect clean musical staves from the uploaded document."
            )
            return {
                "success": False,
                "error": err_msg,
                "systemsMetadata": all_systems_metadata,
                "sectionDiagnostics": all_section_diagnostics,
            }

        modal_parts = (
            max(set(modal_parts_candidates), key=modal_parts_candidates.count)
            if modal_parts_candidates else 1
        )
        num_parts = modal_parts if modal_parts > 1 else max_parts_across_pages

        part_system_tokens: List[List[List[EncodedSymbol]]] = [[] for _ in range(num_parts)]
        for page_num, sys_num, sys_tokens_list in page_systems_tokens:
            if len(sys_tokens_list) != num_parts and num_parts > 1:
                all_section_diagnostics.append({
                    "page": page_num,
                    "pageNumber": page_num,
                    "system": sys_num,
                    "systemIndex": sys_num,
                    "staff": 0,
                    "staffIndex": 0,
                    "status": "warning",
                    "confidence": "medium",
                    "severity": "warning",
                    "message": (
                        f"Page {page_num}, System {sys_num} has {len(sys_tokens_list)} staff(s) while the score layout has "
                        f"{num_parts} vocal parts."
                    )
                })
            for p_idx in range(num_parts):
                if p_idx < len(sys_tokens_list):
                    part_system_tokens[p_idx].append(sys_tokens_list[p_idx])

        voices_tokens: List[List[EncodedSymbol]] = []
        part_clefs: List[str] = []
        for p_idx in range(num_parts):
            combined_voice = _normalize_tokens_for_voice(part_system_tokens[p_idx])
            if combined_voice:
                voices_tokens.append(combined_voice)
                clef_str = "treble"
                for t in combined_voice[:6]:
                    if t.rhythm.startswith("clef_F"):
                        clef_str = "bass"
                        break
                    elif t.rhythm.startswith("clef_G"):
                        clef_str = "treble"
                        break
                part_clefs.append(clef_str)

        if not voices_tokens:
            return {
                "success": False,
                "error": "OMR detected staves on the page, but could not decode any musical notes or rhythms.",
                "systemsMetadata": all_systems_metadata,
                "sectionDiagnostics": all_section_diagnostics,
            }

        try:
            xml_args = XmlGeneratorArguments(large_page=False, metronome=None, tempo=None)
            xml_element = generate_xml(xml_args, voices_tokens, title or "")

            with tempfile.NamedTemporaryFile(suffix=".musicxml", delete=False) as xml_tmp:
                xml_tmp_path = xml_tmp.name

            xml_element.write(xml_tmp_path)
            with open(xml_tmp_path, "r", encoding="utf-8") as f:
                musicxml_str = f.read()
            try:
                os.remove(xml_tmp_path)
            except OSError:
                pass
        except Exception as xml_err:
            sys.stderr.write(f"[OMR Engine] MusicXML generation failed: {xml_err}\n")
            traceback.print_exc(file=sys.stderr)
            return {
                "success": False,
                "error": "Optical Music Recognition decoded staff symbols, but could not assemble a valid MusicXML score.",
                "systemsMetadata": all_systems_metadata,
                "sectionDiagnostics": all_section_diagnostics,
            }

        part_names = _infer_part_names(len(voices_tokens), part_clefs)
        recognized_page_numbers = sorted(list({p_num for p_num, _, _ in page_systems_tokens}))
        failed_page_numbers = sorted(list(
            {p_num for p_num, _ in pages_bytes if p_num not in recognized_page_numbers}
        ))

        return {
            "success": True,
            "musicxml": musicxml_str,
            "partNames": part_names,
            "partClefs": part_clefs,
            "systemsMetadata": all_systems_metadata,
            "sectionDiagnostics": all_section_diagnostics,
            "pageCount": len(pages_bytes),
            "totalPages": len(pages_bytes),
            "recognizedPages": recognized_page_numbers,
            "failedPages": failed_page_numbers,
            "totalSystems": global_system_counter,
            "totalStaves": total_staves_count,
            "totalSegmentedNoteheads": total_segmented_noteheads,
            "totalRecognizedNotes": total_recognized_notes,
        }


def recognize_score_page(image_bytes: Any, page_number: int = 1) -> Dict[str, Any]:
    return recognize_score_pages([image_bytes], page_numbers=[page_number])

