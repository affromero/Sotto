//! Rendering for the practice screens. Pure draw functions: they take the
//! current [`View`] and paint it, with no side effects on app state.

use ratatui::{
    Frame,
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
};

use crate::config::Config;
use crate::theme::Palette;

use super::state::{
    AskPhase, AskState, ClassResult, ClassSection, ConfigView, Course, DueCounts, ExamResult,
    LANGUAGES, LangColumn, MemoryItem, NotesPhase, PlacementOutcome, PracticeResult, ReviewKind,
    SectionProgress, SkillChoice, SpeakingPhase, Unavailable, View, WritingPhase, can_review_vocab,
};
use crate::api::types::SkillType;

include!("ui/base.rs");
include!("ui/class.rs");
include!("ui/exam_placement.rs");
include!("ui/settings_ask.rs");
