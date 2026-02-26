/**
 * Timed narration scripts for each recording flow.
 *
 * Each segment has a start time (seconds) and text.
 * The text is spoken by Hume TTS (Vince Douglas voice) and placed
 * at the exact timestamp in the final composite.
 *
 * IMPORTANT — Hume TTS speaks at ~2 words/second (slower than average).
 * Each segment MUST fit within its time window (gap to next segment).
 * Rule of thumb: max (window_seconds × 2) words per segment.
 */

export interface NarrationSegment {
  /** Start time in seconds */
  startAt: number;
  /** Text to speak — keep SHORT to match video timing */
  text: string;
}

export interface FlowNarration {
  flowName: string;
  /** Total video duration in seconds (from ffprobe) */
  videoDuration: number;
  segments: NarrationSegment[];
}

// ── Flow 01: Feed Browsing (8.28s) ───────────────────────────────
// Windows: 0→2.3 (2.3s), 2.3→5.0 (2.7s), 5.0→6.8 (1.8s), 6.8→8.28 (1.5s)

const feedBrowsing: FlowNarration = {
  flowName: '01-feed-browsing',
  videoDuration: 8.28,
  segments: [
    { startAt: 0.0, text: 'The Sotto feed.' },
    { startAt: 2.3, text: 'Filter by topic.' },
    { startAt: 5.0, text: 'Sort by popular.' },
    { startAt: 6.8, text: 'Every card, at a glance.' },
  ],
};

// ── Flow 02: Chat Creation (13.76s) ──────────────────────────────
// Windows: 0.3→3.5 (3.2s), 3.5→7.0 (3.5s), 7.0→10.5 (3.5s), 10.5→13.76 (3.26s)

const chatCreation: FlowNarration = {
  flowName: '02-chat-creation',
  videoDuration: 13.76,
  segments: [
    { startAt: 0.3, text: 'Start with a topic.' },
    { startAt: 3.5, text: 'The AI shapes your podcast.' },
    { startAt: 7.0, text: 'Pick a focus area.' },
    { startAt: 10.5, text: 'One click to generate.' },
  ],
};

// ── Flow 03: Player Interrupt (20.68s) ───────────────────────────
// Windows: 0.3→4.0 (3.7s), 4.0→7.0 (3.0s), 7.0→11.0 (4.0s), 11.0→15.0 (4.0s), 15.0→18.5 (3.5s), 18.5→20.68 (2.18s)

const playerInterrupt: FlowNarration = {
  flowName: '03-player-interrupt',
  videoDuration: 20.68,
  segments: [
    { startAt: 0.3, text: 'Press play on any podcast.' },
    { startAt: 4.0, text: 'Something catches your ear.' },
    { startAt: 7.0, text: 'Ask a question, mid-listen.' },
    { startAt: 11.0, text: 'AI answers from the source material.' },
    { startAt: 15.0, text: 'Grounded in the content.' },
    { startAt: 18.5, text: 'Interactive podcasting.' },
  ],
};

// ── Flow 04: Fork Flow (10.28s) ──────────────────────────────────
// Windows: 0.3→3.5 (3.2s), 3.5→6.5 (3.0s), 6.5→10.28 (3.78s)

const forkFlow: FlowNarration = {
  flowName: '04-fork-flow',
  videoDuration: 10.28,
  segments: [
    { startAt: 0.3, text: 'Fork any podcast.' },
    { startAt: 3.5, text: 'Add your own angle.' },
    { startAt: 6.5, text: 'A new podcast, from the original.' },
  ],
};

// ── Flow 05: Script Review (10.36s) ──────────────────────────────
// Windows: 0.3→3.5 (3.2s), 3.5→6.5 (3.0s), 6.5→10.36 (3.86s)

const scriptReview: FlowNarration = {
  flowName: '05-script-review',
  videoDuration: 10.36,
  segments: [
    { startAt: 0.3, text: 'Review every word first.' },
    { startAt: 3.5, text: 'Two speakers, back and forth.' },
    { startAt: 6.5, text: 'Approve. Audio generates.' },
  ],
};

// ── Flow 06: Landing Page (12.56s) ───────────────────────────────
// Windows: 0.0→2.5 (2.5s), 2.5→5.0 (2.5s), 5.0→7.5 (2.5s), 7.5→10.0 (2.5s), 10.0→12.56 (2.56s)

const landingPage: FlowNarration = {
  flowName: '06-landing-page',
  videoDuration: 12.56,
  segments: [
    { startAt: 0.0, text: 'Sotto. Podcasts, reimagined.' },
    { startAt: 2.5, text: 'Create from any topic.' },
    { startAt: 5.0, text: 'Interrupt to ask questions.' },
    { startAt: 7.5, text: 'Fork and remix.' },
    { startAt: 10.0, text: 'Bring your own keys.' },
  ],
};

// ── Flow 07: Verification GitHub (10.80s) ────────────────────────
// Windows: 0.0→3.0 (3.0s), 3.0→5.5 (2.5s), 5.5→8.5 (3.0s), 8.5→10.8 (2.3s)

const verificationGithub: FlowNarration = {
  flowName: '07-verification-github',
  videoDuration: 10.8,
  segments: [
    { startAt: 0.0, text: 'Open source verification.' },
    { startAt: 3.0, text: 'Every claim gets a trust score.' },
    { startAt: 5.5, text: 'Bayesian scoring. Fully auditable.' },
    { startAt: 8.5, text: 'Trust, built in the open.' },
  ],
};

// ── Export all ────────────────────────────────────────────────────

export const ALL_NARRATIONS: FlowNarration[] = [
  feedBrowsing,
  chatCreation,
  playerInterrupt,
  forkFlow,
  scriptReview,
  landingPage,
  verificationGithub,
];
