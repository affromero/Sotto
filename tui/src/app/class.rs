//! The gated CEFR class flow (P6b): `Class` orchestration.
//!
//! A class is fetched, then its mixed-skill sections are walked in order. Each
//! section reuses the existing review machinery — MC (grammar/reading) and
//! listening comprehension record `selectedIndex`; speaking records → uploads →
//! polls; writing captures free text and submits for synchronous grading. The
//! MC answers are aggregated and submitted via the class submit; speaking and
//! writing are graded per-prompt through their own endpoints during the section.
//!
//! All P4/P5 patterns are preserved: the `request_gen` stale-result guard, the
//! in-flight guards (`submitting`, speaking phase, writing phase), malformed
//! rejection, and graceful audio-device degradation.

use std::sync::Arc;

use crate::action::{Action, ApiResult};
use crate::api::{NextClassOutcome, SpeakingUploadResponse, WritingGradeResponse, types};
use crate::audio::AudioPlayer;

use super::App;
use super::state::{
    ClassResult, ClassSection, Course, EpisodeDetail, FlowKind, SectionProgress, SpeakingPhase,
    View, WritingInput, WritingPhase, answer_current_choice, class_ready_to_submit, class_sections,
    collect_class_answers, collect_exam_answers, cursor_down, cursor_up, poll_is_terminal,
    reduce_speaking_poll,
};

include!("class/flow.rs");
include!("class/reducers.rs");
