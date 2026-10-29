export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeySignatureInfo {
  key: string;
  tonality: string;
  sharps: number;
  flats: number;
  fifths?: number;
  homeNote: string;
  homeSolfa: string;
  explanation: string;
}

export interface TimeSignatureInfo {
  numerator: number;
  denominator: number;
  beatsPerMeasure: number;
  beatUnit: string;
  explanation: string;
  countingPattern: string;
}

export interface RhythmPattern {
  name: string;
  durationInBeats: number;
  countWord: string;
  explanation: string;
  symbol: string;
}

export interface RhythmBreakdown {
  patterns: RhythmPattern[];
  countingGuide: string;
  advice: string;
}

export interface SimpleExplanation {
  essence: string;
  range: string;
  melodicShape: string;
  choralTip: string;
}

export interface PracticeStep {
  step: number;
  title: string;
  description: string;
  focus: string;
}

export interface MusicNote {
  id?: string;
  step?: number;
  pitch: string; // e.g., "C4", "F#4", "Bb3", or "REST"
  name?: string; // e.g., "C", "F#", "Rest"
  octave?: number;
  solfa: string; // "Do", "Re", "Mi", "Fa", "Sol", "La", "Ti", "Fi", "Te", or "Rest"
  solfaLetter?: string;
  duration: number | string; // beats (e.g. 1, 2, 0.5, 1.5) or string type
  durationName?: string;
  audioType?: string; // "whole" | "dotted-half" | "half" | "dotted-quarter" | "quarter" | "dotted-eighth" | "eighth" | "sixteenth"
  measure: number;
  beat?: number;
  lyric?: string;
  singingTip?: string;
  frequency: number;
  intervalFromPrev?: string;
  isRest?: boolean;
  dots?: number;
  accidental?: string | null; // "sharp" | "flat" | "natural" | "#" | "b" | null
  chordPitches?: string[];
  chordFrequencies?: number[];
  staff?: number;
  staffIndex?: number;
  system?: number;
  systemIndex?: number;
  page?: number;
  pageNumber?: number;
  partId?: string;
  partName?: string;
  clef?: 'treble' | 'bass';
  tie?: 'start' | 'stop' | 'continue' | null;
  slur?: 'start' | 'stop' | null;
  tuplet?: string | null;
  dynamic?: string | null;
  confidence?: 'high' | 'medium' | 'low';
  confidenceReason?: string | null;
  uncertaintyReason?: string | null;
}

export type NoteEvent = MusicNote;

export interface MeasureSummary {
  measureNumber: number;
  system?: number;
  systemIndex?: number;
  page?: number;
  pageNumber?: number;
  expectedBeats: number;
  actualBeats: number;
  beatDifference?: number;
  confidence: 'high' | 'medium' | 'low';
  warning?: string | null;
  uncertaintyReason?: string | null;
  noteCount: number;
  restCount: number;
}

export interface VocalPart {
  id: string;
  partId?: string;
  name: string;
  shortName?: string;
  clef: 'treble' | 'bass';
  staffIndex: number;
  noteCount?: number;
  restCount?: number;
  notes: MusicNote[];
  measures: MeasureSummary[];
  lowestNote?: string;
  highestNote?: string;
}

export interface StaffMetadata {
  staffIndex: number;
  localStaffIndex?: number;
  page?: number;
  pageNumber?: number;
  bbox: BoundingBox;
  measureCount?: number;
  segmentedNoteheads?: number;
  recognizedNotes?: number;
  confidence?: 'high' | 'medium' | 'low';
  warnings?: string[];
}

export interface SystemMetadata {
  systemIndex: number;
  systemNumber?: number;
  pageSystemNumber?: number;
  page?: number;
  pageNumber?: number;
  staffCount: number;
  measureCount?: number;
  bbox: BoundingBox;
  staves: StaffMetadata[];
  confidence?: 'high' | 'medium' | 'low';
  warnings?: string[];
}

export interface SectionDiagnostic {
  page?: number;
  pageNumber?: number;
  system?: number;
  systemIndex?: number;
  staff?: number;
  staffIndex?: number;
  measureNumber?: number;
  severity?: 'info' | 'warning' | 'error';
  status?: 'ok' | 'warning' | 'failed';
  message: string;
  bbox?: BoundingBox;
}

export interface RecognitionSummary {
  overallConfidence: 'high' | 'medium' | 'low';
  totalPages?: number;
  pageCount?: number;
  recognizedPages?: number[];
  failedPages?: number[];
  totalSystems?: number;
  systemCount?: number;
  totalParts?: number;
  partCount?: number;
  totalMeasures?: number;
  measureCount?: number;
  totalEvents: number;
  sungNotesCount: number;
  restsCount: number;
  totalNotes?: number;
  totalRests?: number;
  uncertainMeasuresCount: number;
  uncertainMeasures?: number[];
  needsReview?: boolean;
  segmentedNoteheads?: number;
  recognizedNotes?: number;
}

export interface ScoreAnalysis {
  id: string;
  title: string;
  composer?: string;
  source?: string;
  isDemonstration?: boolean;
  demonstrationNotice?: string;
  clef: 'treble' | 'bass';
  tempo: number;
  keySignature: KeySignatureInfo;
  timeSignature: TimeSignatureInfo;
  notes: MusicNote[];
  parts?: VocalPart[];
  selectedPartId?: string;
  measures?: MeasureSummary[];
  totalMeasures?: number;
  totalSystems?: number;
  totalParts?: number;
  systemsMetadata?: SystemMetadata[];
  sectionDiagnostics?: SectionDiagnostic[];
  recognitionSummary?: RecognitionSummary;
  rhythmBreakdown: RhythmBreakdown;
  simpleExplanation: SimpleExplanation;
  practiceSteps: PracticeStep[];
  imageUrl?: string;
  pageImages?: string[];
  rawMusicXml?: string;
  aiTeacher?: {
    model: string;
    license: string;
    openWeight: boolean;
    isLocalAi: boolean;
  };
}
