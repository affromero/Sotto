mod ask;
mod class;
mod exam;
#[path = "runtime/input.rs"]
mod input;
#[path = "runtime/lifecycle.rs"]
mod lifecycle;
mod onboard;
mod overlay;
#[path = "runtime/practice.rs"]
mod practice;
#[path = "runtime/render.rs"]
mod render;
mod state;
mod ui;

use std::path::PathBuf;
use std::sync::Arc;

use color_eyre::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
    style::Style,
    text::{Line, Span, Text},
    widgets::{Paragraph, Wrap},
};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::action::{Action, ApiResult};
use crate::api::{Api, SottoClient, SpeakingUploadResponse, types};
use crate::audio::{AudioPlayer, Recorder};
use crate::components::Component;
use crate::components::status_bar::StatusBar;
use crate::config::{Config, Profile};
use crate::event::Event;
use crate::theme::Theme;
use crate::tui::Tui;

use overlay::{AccountsOverlay, DeleteOverlay, ManualOverlay, ThemePicker};

use state::{
    AnswerStep, Course, DueCounts, EpisodeDetail, NotesPhase, PracticeResult, RetryKind,
    SectionProgress, SkillChoice, SpeakingPhase, View, WritingPhase, answer_current,
    can_review_vocab, cursor_down, cursor_up, list_down, list_up, poll_is_terminal,
    reduce_speaking_poll, reduce_start,
};

/// The interactive Sotto client. Owns the session [`Config`], the [`Api`] seam
/// it dispatches through, the current [`View`] state machine, and the status
/// bar. Terminal events are mapped to [`Action`]s; async API calls are
/// dispatched onto tokio tasks that send result actions back through
/// `action_tx`, so the render loop never blocks on the network.
pub(crate) struct App {
    config: Config,
    /// Where `config` is persisted. `Some(path)` in production (the real
    /// platform config file); `None` in tests so saving is a no-op and the
    /// suite never clobbers the developer's real `~/.config` config.
    config_path: Option<PathBuf>,
    client: Arc<dyn Api>,
    /// Builds an [`Api`] client for a given profile. Production uses a real
    /// [`SottoClient`]; tests inject a stub. Stored so the account switcher can
    /// rebuild the client against a different profile at runtime. Returns
    /// `Result` because a real client build can fail (e.g. a bad key header).
    client_factory: ClientFactory,
    view: View,
    should_quit: bool,
    status_bar: StatusBar,
    action_tx: UnboundedSender<Action>,
    action_rx: UnboundedReceiver<Action>,
    /// Monotonic counter bumped on every navigation that changes the in-flight
    /// target. Each dispatched request captures the current value and stamps it
    /// onto its result action; stale results (gen mismatch) are dropped, so a
    /// fetch for course A never applies once the learner moved to course B.
    request_gen: u64,
    /// Lazily-initialized audio output. `None` until first listening playback;
    /// holds `Err`-derived absence so a headless host degrades gracefully.
    player: Option<AudioPlayer>,
    /// Microphone capture for speaking. Always present (idle until `start`);
    /// device failures surface from `start`/`stop`, not construction.
    recorder: Recorder,
    /// The course carried across the `next-class` round trip, so the resolved
    /// class (or the done screen) can keep offering "next class".
    pending_course: Option<Course>,
    /// The active theme, resolved from `config.theme` at startup and mutated
    /// live by the theme picker. Its [`Palette`] is threaded into rendering.
    theme: Theme,
    /// The theme picker overlay (`t`) — a modal sub-mode like the ask overlay.
    theme_picker: ThemePicker,
    /// The key-help overlay (`?`) — modal; shows the current screen's keys.
    help_open: bool,
    /// The account switcher overlay (`A`) — modal; lists profiles to switch to.
    accounts: AccountsOverlay,
    /// The manual-placement overlay (`l` on the language picker) — modal.
    manual: ManualOverlay,
    /// The course-delete confirm overlay (`x` on the course home) — modal.
    delete: DeleteOverlay,
}

/// Builds an [`Api`] client for a profile (server + key). Boxed so production
/// (real client) and tests (stub) share one runtime-swappable path.
type ClientFactory = Arc<dyn Fn(&Profile) -> Result<Arc<dyn Api>> + Send + Sync>;

#[cfg(test)]
mod tests {
    include!("tests/support.rs");
    include!("tests/practice.rs");
    include!("tests/class_flow.rs");
    include!("tests/exam_placement.rs");
    include!("tests/ask_settings.rs");
    include!("tests/keymap.rs");
    include!("tests/render_accounts.rs");
}
