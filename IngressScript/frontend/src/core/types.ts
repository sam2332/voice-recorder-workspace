// Shapes of the JSON the server sends (see "Transcript JSON contract" in CLAUDE.md).
// Optional fields are ones older transcripts or some routes leave out.

export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
  noise?: boolean;
  edited?: boolean;
  overlap?: string[];          // names of who talked over this line
  overlap_labels?: string[];   // diarization labels behind `overlap`
  score?: number;
  i?: number;                  // position in state.segments (viewer only, set by reindex)
}

export interface Source {
  name: string;
  start?: number;              // offset inside merged.wav (seconds)
  duration?: number;
  recorded_at?: string | null; // "HH:MM:SS"
  bytes?: number;
  file?: string;               // recording a segment was cut from
  file_start?: number;
  url?: string | null;
}

export interface VoiceCandidate {
  name: string;
  score: number;
}

export interface Voice {
  name: string;
  label: string;
  seconds: number;
  match?: number | null;
  candidates?: VoiceCandidate[];
  named?: boolean;
  tv?: boolean;
}

export interface DayPart {
  start: number;
  end: number;
  lines: number;
  speakers: string[];
}

export interface LinePrint {
  start: number;
  text: string;
  person: string;
}

export interface DayData {
  date: string;
  status?: 'ready' | 'pending';
  language?: string | null;
  audio?: string;
  audio_url?: string | null;
  speaker_hint?: Record<string, number> | null;
  sources: Source[];
  recordings?: { name: string; bytes: number }[];
  segments: Segment[];
  trashed?: Segment[];
  voices?: Voice[];
  voices_reviewed?: boolean;
  line_prints?: LinePrint[];
  parts?: DayPart[];
}

export interface Job {
  status: string;              // queued | processing | failed | blocked ...
  progress?: number;
  label?: string;
  error?: string;
  position?: number;
  date?: string;
  clips?: string[];
}

export interface LibraryDay {
  date: string;
  status: string;              // pending | ready
  recordings: number;
  new_recordings: number;
  duration?: number;
  speakers?: string[];
  lines?: number;
  parts?: number;
  edited?: number;
  needs_review?: boolean;
  first_time?: string | null;
  last_time?: string | null;
  job?: Job;
}
