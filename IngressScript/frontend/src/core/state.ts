// All page state. Every module reads and writes this one object.
import type { DayData, LibraryDay, Segment, Source } from './types';

export interface State {
  server: boolean;                       // true once /api/library has answered
  view?: string;                         // 'home' | 'people' | 'overview' | 'meetings' | 'day'
  library: LibraryDay[];
  date: string | null;
  data: DayData | null;
  segments: Segment[];
  sources: Source[];
  renames: Record<string, string>;
  hidden: Set<string>;
  colors: Record<string, string>;
  activeIdx: number;
  activeSrc: number;
  rawIdx: number;
  matches: HTMLElement[];        // search hits, in transcript order
  matchIdx: number;
  duration: number;
  userScrolledAt: number;
  openToken: number;
  pollTimer: ReturnType<typeof setTimeout> | null;
  pendingSeek?: number | null;
  showNoise?: boolean;
  editing?: any;
  status?: any;

  // Server data kept between renders
  jobs?: any;
  settings?: any;
  checks?: any;
  syncMode?: string;
  recordDir?: string;
  sync?: any;
  syncTimer?: ReturnType<typeof setTimeout>;
  allSpeakers?: string[];
  tvNames?: string[];
  people?: any[];
  profiles?: any[];
  overview?: any;
  meetings?: any[];
  summary?: any;
  summaryTimer?: ReturnType<typeof setTimeout>;
  blockedFor?: string;

  // Home page
  homeSig?: string;
  forms?: Record<string, { key: string; node: HTMLElement }>;
  settingsOpen?: boolean;

  // Voice review
  reviewNamed?: Set<string>;
  reviewDraft?: Map<string, any>;
  reviewOk?: Set<string>;
  reviewSeen?: Set<string>;
}

export const state: State = {
  server: false,
  library: [],
  date: null, data: null,
  segments: [], sources: [],
  renames: {}, hidden: new Set(), colors: {},
  activeIdx: -1, activeSrc: -1, rawIdx: -1,
  matches: [], matchIdx: -1,
  duration: 0, userScrolledAt: 0,
  openToken: 0, pollTimer: null,
};
