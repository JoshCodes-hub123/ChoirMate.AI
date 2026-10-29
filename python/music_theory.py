"""
Deterministic Music Theory, MusicXML Parser, and Validation Engine for ChoirMate AI.
Supports:
- Full multi-part (Solo, Duet, SATB) and multi-system MusicXML parsing.
- Treble and Bass clefs, Key signatures (Major/Minor), Time signatures, and Measure boundaries.
- Rests, Ties, Slurs, Dots, Tuplets, Chords, and Chromatic Accidentals (#, b, natural).
- Authentic choral Movable-Do Solfa (Do, Re, Mi, Fa, Sol, La, Ti + chromatic Fi, Si, Te, Me, etc.).
- Per-measure and per-note validation & confidence scoring.
"""

import math
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple, Any

# Semitones from C0
SEMITONES_FROM_C0: Dict[str, int] = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11
}

SOLFA_SHARP: Dict[int, Tuple[str, str]] = {
    0: ('Do', 'd'),
    1: ('Di', 'di'),
    2: ('Re', 'r'),
    3: ('Ri', 'ri'),
    4: ('Mi', 'm'),
    5: ('Fa', 'f'),
    6: ('Fi', 'fi'),
    7: ('Sol', 's'),
    8: ('Si', 'si'),
    9: ('La', 'l'),
    10: ('Te', 'ta'),
    11: ('Ti', 't')
}

SOLFA_FLAT: Dict[int, Tuple[str, str]] = {
    0: ('Do', 'd'),
    1: ('Ra', 'ra'),
    2: ('Re', 'r'),
    3: ('Me', 'me'),
    4: ('Mi', 'm'),
    5: ('Fa', 'f'),
    6: ('Se', 'se'),
    7: ('Sol', 's'),
    8: ('Le', 'le'),
    9: ('La', 'l'),
    10: ('Te', 't'),
    11: ('Ti', 't')
}

FIFTHS_TO_KEY: Dict[int, Tuple[str, str, int]] = {
    0: ('C Major', 'C', 0),
    1: ('G Major', 'G', 7),
    2: ('D Major', 'D', 2),
    3: ('A Major', 'A', 9),
    4: ('E Major', 'E', 4),
    5: ('B Major', 'B', 11),
    6: ('F# Major', 'F#', 6),
    7: ('C# Major', 'C#', 1),
    -1: ('F Major', 'F', 5),
    -2: ('Bb Major', 'Bb', 10),
    -3: ('Eb Major', 'Eb', 3),
    -4: ('Ab Major', 'Ab', 8),
    -5: ('Db Major', 'Db', 1),
    -6: ('Gb Major', 'Gb', 6),
    -7: ('Cb Major', 'Cb', 11),
}

FIFTHS_TO_MINOR_KEY: Dict[int, Tuple[str, str, int]] = {
    0: ('A Minor', 'C', 0),
    1: ('E Minor', 'G', 7),
    2: ('B Minor', 'D', 2),
    3: ('F# Minor', 'A', 9),
    4: ('C# Minor', 'E', 4),
    -1: ('D Minor', 'F', 5),
    -2: ('G Minor', 'Bb', 10),
    -3: ('C Minor', 'Eb', 3),
    -4: ('F Minor', 'Ab', 8),
}

SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"]
FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"]


def pitch_to_midi(step: str, alter: int, octave: int) -> int:
    base_semi = SEMITONES_FROM_C0.get(step.upper(), 0) + alter
    return 12 + octave * 12 + base_semi


def pitch_to_frequency(step: str, alter: int, octave: int) -> float:
    """Calculates frequency in Hz for standard equal temperament (A4 = 440 Hz)."""
    midi = pitch_to_midi(step, alter, octave)
    return round(440.0 * math.pow(2.0, (midi - 69) / 12.0), 2)


def get_solfa_syllable(step: str, alter: int, octave: int, key_tonic_semi: int) -> Tuple[str, str]:
    """Calculates movable-Do solfa syllable relative to the key center."""
    note_semi = SEMITONES_FROM_C0.get(step.upper(), 0) + alter
    rel_semi = (note_semi - key_tonic_semi) % 12
    if alter < 0:
        return SOLFA_FLAT.get(rel_semi, ('Do', 'd'))
    return SOLFA_SHARP.get(rel_semi, ('Do', 'd'))


def get_duration_info(
    duration_beats: float,
    xml_type: Optional[str] = None,
    dots: int = 0,
    is_rest: bool = False,
    is_tuplet: bool = False,
    is_full_measure_rest: bool = False
) -> Tuple[str, str, str]:
    """
    Returns (durationName, audioType, rhythmWord) from beats, XML note type, dots, and rest flag.
    """
    kind = "rest" if is_rest else "note"
    beat_label = f"{duration_beats:g} beat{'s' if duration_beats != 1 else ''}"

    if is_full_measure_rest:
        return (f"Whole-measure rest ({beat_label})", "whole", "Rest (full bar)")

    prefix = "Dotted " if dots == 1 else ("Double-dotted " if dots >= 2 else "")
    if is_tuplet:
        prefix = "Triplet " + prefix

    type_map = {
        "breve": ("Double whole", "whole", "Ta-ah-ah-ah"),
        "whole": ("Whole" if not prefix else "whole", "whole", "Ta-ah-ah-ah"),
        "half": ("Half" if not prefix else "half", "dotted-half" if dots > 0 else "half", "Ta-ah-ah" if dots > 0 else "Ta-ah"),
        "quarter": ("Quarter" if not prefix else "quarter", "quarter", "Ta-ah-ti" if dots > 0 else "Ta"),
        "eighth": ("Eighth" if not prefix else "eighth", "eighth", "Ti-ri" if dots > 0 else "Ti"),
        "16th": ("16th", "eighth", "Ti-ri"),
        "32nd": ("32nd", "eighth", "Ti-ri"),
    }

    if xml_type and xml_type in type_map:
        base_label, audio_type, word = type_map[xml_type]
        if is_rest:
            word = "Shh"
        return (f"{prefix}{base_label} {kind} ({beat_label})", audio_type, word)

    if duration_beats >= 3.5:
        return (f"Whole {kind} ({beat_label})", "whole", "Shh" if is_rest else "Ta-ah-ah-ah")
    elif duration_beats >= 2.75:
        return (f"Dotted half {kind} ({beat_label})", "dotted-half", "Shh" if is_rest else "Ta-ah-ah")
    elif duration_beats >= 1.85:
        return (f"Half {kind} ({beat_label})", "half", "Shh" if is_rest else "Ta-ah")
    elif duration_beats >= 1.35:
        return (f"Dotted quarter {kind} ({beat_label})", "quarter", "Shh" if is_rest else "Ta-ah-ti")
    elif duration_beats >= 0.85:
        return (f"Quarter {kind} ({beat_label})", "quarter", "Shh" if is_rest else "Ta")
    elif duration_beats >= 0.65:
        return (f"Dotted eighth {kind} ({beat_label})", "eighth", "Shh" if is_rest else "Ti-ri")
    elif duration_beats >= 0.4:
        return (f"Eighth {kind} ({beat_label})", "eighth", "Shh" if is_rest else "Ti")
    elif duration_beats >= 0.3:
        return (f"Triplet eighth {kind} ({beat_label})", "eighth", "Shh" if is_rest else "Tri-po-let")
    else:
        return (f"16th {kind} ({beat_label})", "eighth", "Shh" if is_rest else "Ti-ri")


def calculate_interval(prev_midi: Optional[int], curr_midi: int) -> Optional[str]:
    """Describes the melodic interval movement for choir singers."""
    if prev_midi is None:
        return 'Starting pitch'
    diff = curr_midi - prev_midi
    if diff == 0:
        return 'Repeated note (same pitch)'
    direction = 'up' if diff > 0 else 'down'
    abs_diff = abs(diff)
    names = {
        1: 'half-step (minor 2nd)',
        2: 'whole-step (major 2nd)',
        3: 'minor 3rd',
        4: 'major 3rd',
        5: 'perfect 4th',
        6: 'tritone',
        7: 'perfect 5th',
        8: 'minor 6th',
        9: 'major 6th',
        10: 'minor 7th',
        11: 'major 7th',
        12: 'octave'
    }
    interval_name = names.get(abs_diff, f'{abs_diff} semitones')
    move_word = 'Step' if abs_diff <= 2 else ('Skip' if abs_diff <= 4 else 'Leap')
    return f'{move_word} {direction} {interval_name} ({diff:+d} semitones)'


def _get_key_signature_info(fifths: int, mode: str) -> Tuple[Dict[str, Any], int]:
    if mode == 'minor' and fifths in FIFTHS_TO_MINOR_KEY:
        key_name, rel_major_tonic, tonic_semi = FIFTHS_TO_MINOR_KEY[fifths]
    else:
        key_name, rel_major_tonic, tonic_semi = FIFTHS_TO_KEY.get(fifths, ('C Major', 'C', 0))

    sharps_count = max(0, fifths)
    flats_count = max(0, -fifths)
    if sharps_count > 0:
        acc_list = ", ".join(f"{n}♯" for n in SHARP_ORDER[:sharps_count])
        desc = f"{key_name} has {sharps_count} sharp{'s' if sharps_count != 1 else ''} ({acc_list}). Movable-Do anchor: Do = {rel_major_tonic}."
    elif flats_count > 0:
        acc_list = ", ".join(f"{n}♭" for n in FLAT_ORDER[:flats_count])
        desc = f"{key_name} has {flats_count} flat{'s' if flats_count != 1 else ''} ({acc_list}). Movable-Do anchor: Do = {rel_major_tonic}."
    else:
        desc = f"{key_name} has no sharps or flats in the key signature. Movable-Do anchor: Do = {rel_major_tonic}."

    return ({
        'key': key_name,
        'tonality': 'minor' if mode == 'minor' else 'major',
        'fifths': fifths,
        'sharps': sharps_count,
        'flats': flats_count,
        'homeNote': rel_major_tonic,
        'homeSolfa': f'Do = {rel_major_tonic}',
        'explanation': desc,
    }, tonic_semi)


def parse_musicxml_string(
    xml_content: str,
    part_names_override: Optional[List[str]] = None,
    systems_metadata: Optional[List[Dict[str, Any]]] = None,
    section_diagnostics: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Parses a MusicXML string into structured multi-part, multi-system, and multi-measure
    musical representations with per-measure validation and confidence diagnostics.
    """
    root = ET.fromstring(xml_content)

    part_list_names: Dict[str, str] = {}
    for sp in root.findall('.//score-part'):
        pid = sp.attrib.get('id', '')
        pname_el = sp.find('part-name')
        if pid and pname_el is not None and pname_el.text and pname_el.text.strip():
            part_list_names[pid] = pname_el.text.strip()

    global_fifths = 0
    global_mode = 'major'
    global_beats = 4
    global_beat_type = 4

    for key_el in root.iter('key'):
        f_el = key_el.find('fifths')
        if f_el is not None and f_el.text:
            global_fifths = int(f_el.text.strip())
        m_el = key_el.find('mode')
        if m_el is not None and m_el.text:
            global_mode = m_el.text.strip().lower()
        break

    for time_el in root.iter('time'):
        b_el = time_el.find('beats')
        if b_el is not None and b_el.text:
            global_beats = int(b_el.text.strip())
        bt_el = time_el.find('beat-type')
        if bt_el is not None and bt_el.text:
            global_beat_type = int(bt_el.text.strip())
        break

    key_sig_info, tonic_semi = _get_key_signature_info(global_fifths, global_mode)
    expected_quarter_beats = round(global_beats * (4.0 / max(global_beat_type, 1)), 3)

    time_sig_info = {
        'numerator': global_beats,
        'denominator': global_beat_type,
        'beatsPerMeasure': global_beats,
        'beatUnit': 'Quarter note' if global_beat_type == 4 else ('Eighth note' if global_beat_type == 8 else 'Half note'),
        'explanation': f'{global_beats}/{global_beat_type} meter: {global_beats} beats per measure ({expected_quarter_beats:g} quarter-note pulses).',
        'countingPattern': ' - '.join(str(i + 1) for i in range(global_beats)),
    }

    sys_meta_by_num: Dict[int, Dict[str, Any]] = {}
    if systems_metadata:
        for sm in systems_metadata:
            sys_meta_by_num[int(sm.get('systemNumber', sm.get('systemIndex', 1)))] = sm

    part_elements = root.findall('part')
    parsed_parts: List[Dict[str, Any]] = []
    all_diagnostics: List[Dict[str, Any]] = list(section_diagnostics or [])

    for part_idx, part_el in enumerate(part_elements):
        part_id = part_el.attrib.get('id', f'P{part_idx + 1}')
        if part_names_override and part_idx < len(part_names_override):
            part_name = part_names_override[part_idx]
        else:
            default_label = (
                f'Part {part_idx + 1} ({"Soprano / Upper Voice" if part_idx == 0 else "Alto / Lower Voice"})'
                if len(part_elements) == 2
                else (f'Vocal Part {part_idx + 1}' if len(part_elements) > 1 else 'Melody (Lead Vocal)')
            )
            raw_pname = part_list_names.get(part_id, '')
            part_name = raw_pname if (raw_pname and not raw_pname.startswith('P')) else default_label

        divisions = 4
        current_clef: str = 'treble'
        current_system = 1
        part_notes: List[Dict[str, Any]] = []
        part_measures: List[Dict[str, Any]] = []
        prev_midi: Optional[int] = None
        step_num = 1

        measure_elements = part_el.findall('measure')
        total_measures_in_part = len(measure_elements)

        for m_idx, measure_el in enumerate(measure_elements):
            try:
                m_num = int(measure_el.attrib.get('number', m_idx + 1))
            except ValueError:
                m_num = m_idx + 1

            for print_el in measure_el.findall('print'):
                if print_el.attrib.get('new-system') == 'yes':
                    current_system += 1

            for attr_el in measure_el.findall('attributes'):
                div_el = attr_el.find('divisions')
                if div_el is not None and div_el.text:
                    divisions = max(1, int(div_el.text.strip()))
                for clef_el in attr_el.findall('clef'):
                    sign_el = clef_el.find('sign')
                    if sign_el is not None and sign_el.text:
                        s_val = sign_el.text.strip().upper()
                        if s_val == 'F':
                            current_clef = 'bass'
                        elif s_val == 'G':
                            current_clef = 'treble'

            sys_meta = sys_meta_by_num.get(current_system, {})
            page_num = int(sys_meta.get('page', sys_meta.get('pageNumber', 1)))
            sys_bbox = sys_meta.get('bbox')
            staff_bbox = sys_bbox
            staff_confidence = 'high'
            staves_list = sys_meta.get('staves', [])
            if part_idx < len(staves_list):
                staff_bbox = staves_list[part_idx].get('bbox', sys_bbox)
                staff_confidence = staves_list[part_idx].get('confidence', 'high')

            raw_note_els = measure_el.findall('note')
            measure_events: List[Dict[str, Any]] = []
            beat_cursor = 1.0

            non_chord_els = [ne for ne in raw_note_els if ne.find('chord') is None]
            is_single_whole_rest_measure = (
                len(non_chord_els) == 1
                and non_chord_els[0].find('rest') is not None
                and (
                    non_chord_els[0].find('rest').attrib.get('measure') == 'yes'  # type: ignore
                    or (non_chord_els[0].find('type') is not None and non_chord_els[0].find('type').text == 'whole')  # type: ignore
                )
            )

            for note_el in raw_note_els:
                if note_el.find('grace') is not None:
                    continue

                staff_el = note_el.find('staff')
                if staff_el is not None and staff_el.text and len(part_elements) == 1:
                    if staff_el.text.strip() != '1' and any(
                        (ne.find('staff') is None or ne.find('staff').text == '1')  # type: ignore
                        for ne in raw_note_els if ne.find('rest') is None
                    ):
                        continue

                is_chord_tone = note_el.find('chord') is not None
                is_rest = note_el.find('rest') is not None

                dur_el = note_el.find('duration')
                raw_dur = int(dur_el.text.strip()) if (dur_el is not None and dur_el.text) else divisions
                duration_beats = round(raw_dur / divisions, 3)

                if is_single_whole_rest_measure and is_rest:
                    duration_beats = expected_quarter_beats

                type_el = note_el.find('type')
                xml_type = type_el.text.strip() if (type_el is not None and type_el.text) else None
                dots_count = len(note_el.findall('dot'))
                is_tuplet = note_el.find('time-modification') is not None

                tie_type: Optional[str] = None
                for t_el in note_el.findall('tie'):
                    t_val = t_el.attrib.get('type')
                    if t_val in ('start', 'stop'):
                        tie_type = 'continue' if (tie_type and tie_type != t_val) else t_val
                for tied_el in note_el.findall('.//tied'):
                    t_val = tied_el.attrib.get('type')
                    if t_val in ('start', 'stop') and not tie_type:
                        tie_type = t_val

                slur_type: Optional[str] = None
                for slur_el in note_el.findall('.//slur'):
                    s_val = slur_el.attrib.get('type')
                    if s_val in ('start', 'stop'):
                        slur_type = s_val

                if is_rest:
                    if is_chord_tone:
                        continue
                    duration_name, audio_type, rhythm_word = get_duration_info(
                        duration_beats,
                        xml_type=xml_type,
                        dots=dots_count,
                        is_rest=True,
                        is_tuplet=is_tuplet,
                        is_full_measure_rest=is_single_whole_rest_measure,
                    )
                    rest_event: Dict[str, Any] = {
                        'id': f'{part_id}-m{m_num}-n{step_num}',
                        'step': step_num,
                        'partId': part_id,
                        'partName': part_name,
                        'staffIndex': part_idx + 1,
                        'page': page_num,
                        'system': current_system,
                        'measure': m_num,
                        'beatOffset': round(beat_cursor, 2),
                        'isRest': True,
                        'pitch': 'REST',
                        'name': 'Rest',
                        'octave': 4,
                        'accidental': None,
                        'solfa': 'Rest',
                        'solfaLetter': '—',
                        'duration': duration_beats,
                        'durationName': duration_name,
                        'audioType': audio_type,
                        'dots': dots_count,
                        'isTuplet': is_tuplet,
                        'tie': None,
                        'slur': None,
                        'clef': current_clef,
                        'lyric': '',
                        'singingTip': f'Hold silence for {duration_beats:g} beat{"s" if duration_beats != 1 else ""} ({rhythm_word}) while keeping a steady internal pulse.',
                        'frequency': 0.0,
                        'intervalFromPrev': 'Rest (breathe & count)',
                        'confidence': staff_confidence,
                        'confidenceReason': None,
                        'bbox': staff_bbox,
                    }
                    measure_events.append(rest_event)
                    beat_cursor += duration_beats
                    step_num += 1
                    continue

                pitch_el = note_el.find('pitch')
                if pitch_el is None:
                    continue

                step_el = pitch_el.find('step')
                octave_el = pitch_el.find('octave')
                alter_el = pitch_el.find('alter')

                step_letter = step_el.text.strip().upper() if (step_el is not None and step_el.text) else 'C'
                octave_val = int(octave_el.text.strip()) if (octave_el is not None and octave_el.text) else 4
                alter_val = int(alter_el.text.strip()) if (alter_el is not None and alter_el.text) else 0

                acc_sym = '#' if alter_val == 1 else ('##' if alter_val >= 2 else ('b' if alter_val == -1 else ('bb' if alter_val <= -2 else '')))
                note_name = f'{step_letter}{acc_sym}'
                pitch_str = f'{note_name}{octave_val}'
                freq = pitch_to_frequency(step_letter, alter_val, octave_val)
                curr_midi = pitch_to_midi(step_letter, alter_val, octave_val)
                solfa_syl, solfa_letter = get_solfa_syllable(step_letter, alter_val, octave_val, tonic_semi)

                if is_chord_tone and measure_events and not measure_events[-1].get('isRest'):
                    prev_ev = measure_events[-1]
                    chord_pitches = prev_ev.get('chordPitches') or [prev_ev['pitch']]
                    chord_freqs = prev_ev.get('chordFrequencies') or [prev_ev['frequency']]
                    if pitch_str not in chord_pitches:
                        chord_pitches.append(pitch_str)
                        chord_freqs.append(freq)
                    prev_ev['chordPitches'] = chord_pitches
                    prev_ev['chordFrequencies'] = chord_freqs

                    prev_midi_val = prev_ev.get('_midi', curr_midi)
                    if (part_idx == 0 and curr_midi > prev_midi_val) or (part_idx > 0 and curr_midi < prev_midi_val):
                        prev_ev['pitch'] = pitch_str
                        prev_ev['name'] = note_name
                        prev_ev['octave'] = octave_val
                        prev_ev['accidental'] = 'sharp' if alter_val > 0 else ('flat' if alter_val < 0 else None)
                        prev_ev['solfa'] = solfa_syl
                        prev_ev['solfaLetter'] = solfa_letter
                        prev_ev['frequency'] = freq
                        prev_ev['_midi'] = curr_midi
                    continue

                duration_name, audio_type, rhythm_word = get_duration_info(
                    duration_beats,
                    xml_type=xml_type,
                    dots=dots_count,
                    is_rest=False,
                    is_tuplet=is_tuplet,
                )

                lyric_text = ''
                lyric_el = note_el.find('lyric')
                if lyric_el is not None:
                    text_el = lyric_el.find('text')
                    if text_el is not None and text_el.text:
                        lyric_text = text_el.text.strip()

                interval_str = calculate_interval(prev_midi, curr_midi)

                note_conf = staff_confidence
                conf_reason: Optional[str] = None
                if prev_midi is not None and abs(curr_midi - prev_midi) > 19:
                    note_conf = 'medium'
                    conf_reason = f'Large melodic leap ({abs(curr_midi - prev_midi)} semitones) from previous note — verify octave or clef.'

                prev_midi = curr_midi

                note_event: Dict[str, Any] = {
                    'id': f'{part_id}-m{m_num}-n{step_num}',
                    'step': step_num,
                    'partId': part_id,
                    'partName': part_name,
                    'staffIndex': part_idx + 1,
                    'page': page_num,
                    'system': current_system,
                    'measure': m_num,
                    'beatOffset': round(beat_cursor, 2),
                    'isRest': False,
                    'pitch': pitch_str,
                    'name': note_name,
                    'octave': octave_val,
                    'accidental': 'sharp' if alter_val > 0 else ('flat' if alter_val < 0 else None),
                    'solfa': solfa_syl,
                    'solfaLetter': solfa_letter,
                    'duration': duration_beats,
                    'durationName': duration_name,
                    'audioType': audio_type,
                    'dots': dots_count,
                    'isTuplet': is_tuplet,
                    'tie': tie_type,
                    'slur': slur_type,
                    'clef': current_clef,
                    'lyric': lyric_text,
                    'singingTip': f'Sing {solfa_syl} ({pitch_str}) for {duration_beats:g} beat{"s" if duration_beats != 1 else ""} ({rhythm_word}).',
                    'frequency': freq,
                    'intervalFromPrev': interval_str,
                    'confidence': note_conf,
                    'confidenceReason': conf_reason,
                    'bbox': staff_bbox,
                    '_midi': curr_midi,
                }
                measure_events.append(note_event)
                beat_cursor += duration_beats
                step_num += 1

            for ev in measure_events:
                ev.pop('_midi', None)

            actual_beats = round(sum(ev['duration'] for ev in measure_events), 2)
            beat_diff = round(actual_beats - expected_quarter_beats, 2)
            is_first_or_last = (m_idx == 0 or m_idx == total_measures_in_part - 1)
            is_pickup = (m_idx == 0 and 0 < actual_beats < expected_quarter_beats)

            measure_warnings: List[str] = []
            measure_confidence = staff_confidence

            if len(measure_events) == 0:
                measure_confidence = 'low'
                measure_warnings.append(f'Measure {m_num} contains no decoded notes or rests.')
            elif abs(beat_diff) > 0.15 and not is_first_or_last:
                measure_confidence = 'medium'
                measure_warnings.append(
                    f'Measure {m_num} has {actual_beats:g} beats instead of expected {expected_quarter_beats:g} beats in {global_beats}/{global_beat_type} meter.'
                )
                for ev in measure_events:
                    if ev['confidence'] == 'high':
                        ev['confidence'] = 'medium'
                        ev['confidenceReason'] = measure_warnings[0]

            part_notes.extend(measure_events)
            part_measures.append({
                'measureNumber': m_num,
                'system': current_system,
                'systemNumber': current_system,
                'page': page_num,
                'pageNumber': page_num,
                'expectedBeats': expected_quarter_beats,
                'actualBeats': actual_beats,
                'beatDiff': beat_diff,
                'isPickup': is_pickup,
                'confidence': measure_confidence,
                'warning': measure_warnings[0] if measure_warnings else None,
                'warnings': measure_warnings,
                'bbox': staff_bbox,
                'noteCount': sum(1 for ev in measure_events if not ev.get('isRest')),
                'restCount': sum(1 for ev in measure_events if ev.get('isRest')),
            })

        if part_notes:
            parsed_parts.append({
                'id': part_id,
                'partId': part_id,
                'name': part_name,
                'staffIndex': part_idx + 1,
                'clef': current_clef,
                'noteCount': sum(1 for ev in part_notes if not ev.get('isRest')),
                'restCount': sum(1 for ev in part_notes if ev.get('isRest')),
                'notes': part_notes,
                'measures': part_measures,
            })

    primary_part = parsed_parts[0] if parsed_parts else {
        'id': 'P1',
        'partId': 'P1',
        'name': 'Melody',
        'staffIndex': 1,
        'clef': 'treble',
        'noteCount': 0,
        'restCount': 0,
        'notes': [],
        'measures': [],
    }

    uncertain_measures: List[int] = sorted(list({
        m['measureNumber']
        for p in parsed_parts
        for m in p['measures']
        if m['confidence'] != 'high' or m.get('warning')
    }))

    has_errors = any(d.get('severity') == 'error' for d in all_diagnostics)
    if has_errors or len(primary_part['notes']) == 0:
        overall_confidence = 'low'
    elif uncertain_measures or all_diagnostics:
        overall_confidence = 'medium'
    else:
        overall_confidence = 'high'

    total_systems = max(
        (m['system'] for p in parsed_parts for m in p['measures']),
        default=len(systems_metadata or []) or 1
    )
    total_measures = max(
        (len(p['measures']) for p in parsed_parts),
        default=0
    )
    sung_notes_count = sum(
        sum(1 for n in p['notes'] if not n.get('isRest'))
        for p in parsed_parts
    )
    rests_count = sum(
        sum(1 for n in p['notes'] if n.get('isRest'))
        for p in parsed_parts
    )

    return {
        'clef': primary_part['clef'],
        'keySignature': key_sig_info,
        'timeSignature': time_sig_info,
        'notes': primary_part['notes'],
        'parts': parsed_parts,
        'measures': primary_part['measures'],
        'totalMeasures': total_measures,
        'totalSystems': total_systems,
        'totalParts': len(parsed_parts),
        'systemsMetadata': systems_metadata or [],
        'sectionDiagnostics': all_diagnostics,
        'recognitionSummary': {
            'overallConfidence': overall_confidence,
            'totalPages': max((sm.get('page', sm.get('pageNumber', 1)) for sm in (systems_metadata or [])), default=1),
            'totalSystems': total_systems,
            'totalParts': len(parsed_parts),
            'totalMeasures': total_measures,
            'totalEvents': sung_notes_count + rests_count,
            'sungNotesCount': sung_notes_count,
            'restsCount': rests_count,
            'totalNotes': sung_notes_count,
            'totalRests': rests_count,
            'uncertainMeasuresCount': len(uncertain_measures),
            'uncertainMeasures': uncertain_measures,
            'needsReview': overall_confidence != 'high' or len(uncertain_measures) > 0,
        }
    }


def recalculate_corrected_notes(
    score_data: Dict[str, Any],
    part_id: Optional[str] = None,
    updated_notes: Optional[List[Dict[str, Any]]] = None,
    new_fifths: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Re-validates and recalculates Solfa syllables, frequencies, durations, and intervals
    when a user edits notes in the Recognition Review & Correction workflow, returning
    the updated ScoreAnalysis dictionary.
    """
    key_sig = dict(score_data.get('keySignature', {}))
    if new_fifths is not None:
        key_sig, tonic_semi = _get_key_signature_info(int(new_fifths), key_sig.get('tonality', 'major'))
    else:
        home_note = key_sig.get('homeNote', 'C')
        tonic_semi = SEMITONES_FROM_C0.get(home_note, 0)

    clef = score_data.get('clef', 'treble')
    notes_in = updated_notes if updated_notes is not None else score_data.get('notes', [])
    prev_midi: Optional[int] = None
    rebuilt_notes: List[Dict[str, Any]] = []

    for idx, n in enumerate(notes_in):
        step_num = idx + 1
        is_rest = bool(n.get('isRest')) or n.get('pitch') == 'REST' or n.get('name') == 'Rest'
        duration = float(n.get('duration', 1.0))
        dots = int(n.get('dots', 1 if duration in (1.5, 3.0, 0.75) else 0))

        if is_rest:
            dur_name, audio_type, r_word = get_duration_info(duration, dots=dots, is_rest=True)
            rebuilt_notes.append({
                **n,
                'step': step_num,
                'isRest': True,
                'pitch': 'REST',
                'name': 'Rest',
                'accidental': None,
                'solfa': 'Rest',
                'solfaLetter': '—',
                'duration': duration,
                'durationName': dur_name,
                'audioType': audio_type,
                'frequency': 0.0,
                'intervalFromPrev': 'Rest (breathe & count)',
                'singingTip': f'Hold silence for {duration:g} beat{"s" if duration != 1 else ""} ({r_word}).',
                'confidence': 'high',
                'confidenceReason': None,
            })
            continue

        raw_pitch = str(n.get('pitch', 'C4')).strip()
        step_letter = raw_pitch[0].upper() if raw_pitch else 'C'
        if step_letter not in SEMITONES_FROM_C0:
            step_letter = 'C'
        rest_str = raw_pitch[1:]
        alter_val = 0
        acc_str: Optional[str] = None
        if rest_str.startswith('#'):
            alter_val = 1
            acc_str = 'sharp'
            oct_str = rest_str[1:]
        elif rest_str.startswith('b'):
            alter_val = -1
            acc_str = 'flat'
            oct_str = rest_str[1:]
        else:
            oct_str = rest_str

        try:
            octave_val = int(oct_str) if oct_str else int(n.get('octave', 4))
        except ValueError:
            octave_val = int(n.get('octave', 4))

        acc_sym = '#' if alter_val > 0 else ('b' if alter_val < 0 else '')
        note_name = f'{step_letter}{acc_sym}'
        pitch_str = f'{note_name}{octave_val}'
        freq = pitch_to_frequency(step_letter, alter_val, octave_val)
        curr_midi = pitch_to_midi(step_letter, alter_val, octave_val)
        solfa_syl, solfa_letter = get_solfa_syllable(step_letter, alter_val, octave_val, tonic_semi)
        dur_name, audio_type, r_word = get_duration_info(duration, dots=dots, is_rest=False)
        interval_str = calculate_interval(prev_midi, curr_midi)
        prev_midi = curr_midi

        rebuilt_notes.append({
            **n,
            'step': step_num,
            'isRest': False,
            'pitch': pitch_str,
            'name': note_name,
            'octave': octave_val,
            'accidental': acc_str,
            'solfa': solfa_syl,
            'solfaLetter': solfa_letter,
            'duration': duration,
            'durationName': dur_name,
            'audioType': audio_type,
            'clef': n.get('clef', clef),
            'frequency': freq,
            'intervalFromPrev': interval_str,
            'singingTip': f'Sing {solfa_syl} ({pitch_str}) for {duration:g} beat{"s" if duration != 1 else ""} ({r_word}).',
            'confidence': 'high',
            'confidenceReason': None,
        })

    updated_score = dict(score_data)
    updated_score['keySignature'] = key_sig
    parts = [dict(p) for p in updated_score.get('parts', [])]
    target_pid = part_id or (parts[0]['id'] if parts else 'P1')

    if parts:
        for idx, p in enumerate(parts):
            if p.get('id') == target_pid or p.get('partId') == target_pid:
                p['notes'] = rebuilt_notes
                p['noteCount'] = sum(1 for ev in rebuilt_notes if not ev.get('isRest'))
                p['restCount'] = sum(1 for ev in rebuilt_notes if ev.get('isRest'))
                if idx == 0:
                    updated_score['notes'] = rebuilt_notes
    else:
        updated_score['notes'] = rebuilt_notes

    updated_score['parts'] = parts
    return updated_score
