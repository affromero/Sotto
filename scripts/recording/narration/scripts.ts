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
  /** Output name (determines narrated file name) */
  flowName: string;
  /** Source graded MP4 name (may differ from flowName after reordering) */
  sourceFlowName: string;
  /** Total video duration in seconds (from ffprobe) */
  videoDuration: number;
  segments: NarrationSegment[];
}

// ── 01: Landing Page (12.56s) — the hook ─────────────────────────
// Windows: 0.0→2.5 (2.5s), 2.5→5.0 (2.5s), 5.0→7.5 (2.5s), 7.5→10.0 (2.5s), 10.0→12.56 (2.56s)

const landingPage: FlowNarration = {
  flowName: '01-landing-page',
  sourceFlowName: '06-landing-page',
  videoDuration: 12.56,
  segments: [
    { startAt: 0.0, text: 'Sotto. Private podcasts with AI.' },
    { startAt: 2.5, text: 'Create from any topic.' },
    { startAt: 5.0, text: 'Interrupt to ask questions.' },
    { startAt: 7.5, text: 'Keep it private.' },
    { startAt: 10.0, text: 'Bring your own keys.' },
  ],
};

// ── 02: Verification GitHub (10.80s) — trust & credibility ───────
// Windows: 0.0→3.0 (3.0s), 3.0→5.5 (2.5s), 5.5→8.5 (3.0s), 8.5→10.8 (2.3s)

const verificationGithub: FlowNarration = {
  flowName: '02-verification-github',
  sourceFlowName: '07-verification-github',
  videoDuration: 10.8,
  segments: [
    { startAt: 0.0, text: 'Open source verification.' },
    { startAt: 3.0, text: 'Every claim gets a trust score.' },
    { startAt: 5.5, text: 'Bayesian scoring. Fully auditable.' },
    { startAt: 8.5, text: 'Trust, built in the open.' },
  ],
};

// ── 04: Chat Creation (13.76s) ───────────────────────────────────
// Windows: 0.3→3.5 (3.2s), 3.5→7.0 (3.5s), 7.0→10.5 (3.5s), 10.5→13.76 (3.26s)

const chatCreation: FlowNarration = {
  flowName: '04-chat-creation',
  sourceFlowName: '02-chat-creation',
  videoDuration: 13.76,
  segments: [
    { startAt: 0.3, text: 'Start with a topic.' },
    { startAt: 3.5, text: 'The AI shapes your podcast.' },
    { startAt: 7.0, text: 'Pick a focus area.' },
    { startAt: 10.5, text: 'One click to generate.' },
  ],
};

// ── 05: Player Interrupt (20.68s) ────────────────────────────────
// Windows: 0.3→4.0 (3.7s), 4.0→7.0 (3.0s), 7.0→11.0 (4.0s), 11.0→15.0 (4.0s), 15.0→18.5 (3.5s), 18.5→20.68 (2.18s)

const playerInterrupt: FlowNarration = {
  flowName: '05-player-interrupt',
  sourceFlowName: '03-player-interrupt',
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

// ── 07: Script Review (10.36s) ───────────────────────────────────
// Windows: 0.3→3.5 (3.2s), 3.5→6.5 (3.0s), 6.5→10.36 (3.86s)

const scriptReview: FlowNarration = {
  flowName: '07-script-review',
  sourceFlowName: '05-script-review',
  videoDuration: 10.36,
  segments: [
    { startAt: 0.3, text: 'Review every word first.' },
    { startAt: 3.5, text: 'Two speakers, back and forth.' },
    { startAt: 6.5, text: 'Approve. Audio generates.' },
  ],
};

// ── Export all (presentation order) ──────────────────────────────

export const ALL_NARRATIONS: FlowNarration[] = [
  landingPage,
  verificationGithub,
  chatCreation,
  playerInterrupt,
  scriptReview,
];
