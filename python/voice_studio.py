
"""Voice-aware MusicXML extraction for ChoirMate Voice Studio."""

import xml.etree.ElementTree as ET
from collections import defaultdict


def extract_voices(xml_content: str) -> list[dict]:
    """Extract independent voices with their timing in quarter-note beats."""
    root = ET.fromstring(xml_content)
    part_names = {}

    for score_part in root.findall("./part-list/score-part"):
        part_id = score_part.get("id")
        part_names[part_id] = score_part.findtext("part-name") or part_id

    voices = []

    for part in root.findall("part"):
        part_id = part.get("id", "P1")
        divisions = 1
        measure_start = 0.0
        tracks = defaultdict(list)

        for measure in part.findall("measure"):
            cursor = 0.0
            max_end = 0.0
            last_onset = 0.0
            measure_number = measure.get("number", "")

            for element in measure:
                if element.tag == "attributes":
                    value = element.findtext("divisions")
                    if value:
                        divisions = max(1, int(value))
                    continue

                if element.tag in ("backup", "forward"):
                    duration = int(element.findtext("duration") or 0) / divisions
                    cursor += -duration if element.tag == "backup" else duration
                    continue

                if element.tag != "note" or element.find("grace") is not None:
                    continue

                duration = int(element.findtext("duration") or 0) / divisions
                is_chord = element.find("chord") is not None
                onset = last_onset if is_chord else cursor
                voice_id = element.findtext("voice") or "1"
                staff_id = element.findtext("staff") or "1"
                pitch = element.find("pitch")

                note = {
                    "measure": measure_number,
                    "startBeat": round(measure_start + onset, 6),
                    "duration": duration,
                    "isRest": element.find("rest") is not None,
                    "voiceId": voice_id,
                    "staffIndex": int(staff_id),
                    "pitch": None,
                }

                if pitch is not None:
                    step = pitch.findtext("step") or "C"
                    alter = int(pitch.findtext("alter") or 0)
                    octave = int(pitch.findtext("octave") or 4)
                    note["pitch"] = {
                        "step": step,
                        "alter": alter,
                        "octave": octave,
                    }

                tracks[(staff_id, voice_id)].append(note)

                if not is_chord:
                    last_onset = cursor
                    cursor += duration

                max_end = max(max_end, onset + duration, cursor)

            measure_start += max_end

        for (staff_id, voice_id), notes in tracks.items():
            voices.append({
                "id": f"{part_id}-s{staff_id}-v{voice_id}",
                "partId": part_id,
                "partName": part_names.get(part_id, part_id),
                "staffIndex": int(staff_id),
                "voiceId": voice_id,
                "notes": notes,
            })

    return voices
