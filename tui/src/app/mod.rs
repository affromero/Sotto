mod ask;
mod class;
mod exam;
mod onboard;
mod overlay;
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

use overlay::{AccountsOverlay, ThemePicker};

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
}

/// Builds an [`Api`] client for a profile (server + key). Boxed so production
/// (real client) and tests (stub) share one runtime-swappable path.
type ClientFactory = Arc<dyn Fn(&Profile) -> Result<Arc<dyn Api>> + Send + Sync>;

impl App {
    /// Build the production app: a real [`SottoClient`] for the active profile,
    /// with a factory that rebuilds one when the learner switches accounts.
    pub fn new(config: Config) -> Result<Self> {
        let factory: ClientFactory = Arc::new(|profile: &Profile| {
            let client: Arc<dyn Api> =
                Arc::new(SottoClient::new(&profile.server_url, &profile.api_key)?);
            Ok(client)
        });
        Self::with_factory(config, factory)
    }

    /// Build an app around a [`ClientFactory`], persisting to the real platform
    /// config path. Used by [`App::new`]; tests use [`App::with_factory_at`].
    fn with_factory(config: Config, client_factory: ClientFactory) -> Result<Self> {
        Self::with_factory_at(config, client_factory, Some(crate::config::config_path()?))
    }

    /// Build an app around a [`ClientFactory`] that persists `config` to
    /// `config_path` (`None` = do not persist). Tests inject a stub factory and
    /// `None`/a temp path so dispatch and reducers run with zero network and the
    /// suite never writes the developer's real config file.
    fn with_factory_at(
        config: Config,
        client_factory: ClientFactory,
        config_path: Option<PathBuf>,
    ) -> Result<Self> {
        // Build the initial client for the active profile (or an empty stand-in
        // profile when there is none, so the app can still render the switcher).
        let profile = config.active_profile().cloned().unwrap_or_default();
        let client = client_factory(&profile)?;
        Ok(Self::assemble(config, config_path, client_factory, client))
    }

    /// Assemble the App from its already-built pieces. Shared by the factory
    /// path and the test stub-injection path.
    fn assemble(
        config: Config,
        config_path: Option<PathBuf>,
        client_factory: ClientFactory,
        client: Arc<dyn Api>,
    ) -> Self {
        let (action_tx, action_rx) = mpsc::unbounded_channel();
        let server = config
            .active_profile()
            .map(|p| p.server_url.clone())
            .unwrap_or_default();
        let user = config
            .active_profile()
            .and_then(|p| p.name.clone())
            .unwrap_or_else(|| "(owner)".to_string());
        let status_bar = StatusBar::new(server, user);
        let theme = Theme::from_choice(&config.theme);
        Self {
            config,
            config_path,
            client,
            client_factory,
            view: View::Loading,
            should_quit: false,
            status_bar,
            action_tx,
            action_rx,
            request_gen: 0,
            player: None,
            recorder: Recorder::new(),
            pending_course: None,
            theme,
            theme_picker: ThemePicker::closed(),
            help_open: false,
            accounts: AccountsOverlay::closed(),
        }
    }

    /// Invalidate any in-flight request and return the new current generation.
    fn bump_gen(&mut self) -> u64 {
        self.request_gen += 1;
        self.request_gen
    }

    pub async fn run(&mut self) -> Result<()> {
        let mut tui = Tui::new()?;
        tui.enter()?;

        // Kick off the initial course fetch; it sets View::Loading and renders.
        self.fetch_courses();

        while !self.should_quit {
            if let Some(event) = tui.event_rx.recv().await {
                self.handle_event(event)?;
            }

            while let Ok(action) = self.action_rx.try_recv() {
                self.handle_action(action, &mut tui)?;
            }
        }

        tui.exit()?;
        Ok(())
    }

    fn handle_action(&mut self, action: Action, tui: &mut Tui) -> Result<()> {
        match action {
            Action::Quit => self.should_quit = true,
            Action::Render => {
                tui.terminal.draw(|frame| {
                    let _ = self.draw(frame);
                })?;
            }
            Action::Resize(w, h) => {
                tui.terminal.resize(Rect::new(0, 0, w, h))?;
            }
            Action::Tick => {
                if self.status_bar.clear_expired() {
                    self.action_tx.send(Action::Render)?;
                }
            }
            Action::Error(message) => {
                self.status_bar.set_error(message);
                self.action_tx.send(Action::Render)?;
            }
            Action::Up => self.on_up(),
            Action::Down => self.on_down(),
            Action::Select => self.on_select(),
            Action::Choose(n) => self.on_choose(n),
            Action::Back => self.on_back(),
            Action::Retry => self.on_retry(),
            Action::PlayPause => self.on_play_pause(),
            Action::ToggleRecord => self.on_toggle_record(),
            Action::ScrollUp => self.on_scroll(false),
            Action::ScrollDown => self.on_scroll(true),
            // Text input + submit route to the ask overlay when it is open on a
            // listening screen, otherwise to the writing section editor.
            Action::Input(c) => {
                if self.ask_overlay_open() {
                    self.ask_input_char(c)
                } else {
                    self.on_writing_input(c)
                }
            }
            Action::InputNewline => {
                if self.ask_overlay_open() {
                    self.ask_input_newline()
                } else {
                    self.on_writing_newline()
                }
            }
            Action::InputBackspace => {
                if self.ask_overlay_open() {
                    self.ask_input_backspace()
                } else {
                    self.on_writing_backspace()
                }
            }
            Action::SubmitText => {
                if self.ask_overlay_open() {
                    self.on_ask_submit()
                } else {
                    self.on_writing_submit()
                }
            }
            Action::NextClass => self.on_next_class(),
            Action::CoursesLoaded(req_gen, result) => self.on_courses_loaded(req_gen, result),
            Action::DueLoaded(req_gen, result) => self.on_due_loaded(req_gen, result),
            Action::PracticeStarted(req_gen, result) => self.on_practice_started(req_gen, result),
            Action::Submitted(req_gen, result) => self.on_submitted(req_gen, result),
            Action::EpisodeLoaded(req_gen, result) => self.on_episode_loaded(req_gen, result),
            Action::AudioDownloaded(req_gen, result) => self.on_audio_downloaded(req_gen, result),
            Action::SpeakingUploaded(req_gen, result) => self.on_speaking_uploaded(req_gen, result),
            Action::SpeakingPolled(req_gen, result) => self.on_speaking_polled(req_gen, result),
            Action::NextClassResolved(req_gen, result) => {
                self.on_next_class_resolved(req_gen, result)
            }
            Action::ClassLoaded(req_gen, result) => self.on_class_loaded(req_gen, result),
            Action::ClassSubmitted(req_gen, result) => self.on_class_submitted(req_gen, result),
            Action::ClassEpisodeLoaded(req_gen, result) => {
                self.on_class_episode_loaded(req_gen, result)
            }
            Action::ClassAudioDownloaded(req_gen, result) => {
                self.on_class_audio_downloaded(req_gen, result)
            }
            Action::ClassSpeakingUploaded(req_gen, result) => {
                self.on_class_speaking_uploaded(req_gen, result)
            }
            Action::ClassSpeakingPolled(req_gen, result) => {
                self.on_class_speaking_polled(req_gen, result)
            }
            Action::ClassWritingGraded(req_gen, result) => {
                self.on_class_writing_graded(req_gen, result)
            }
            Action::StartExam => self.on_start_exam(),
            Action::ExamStarted(req_gen, result) => self.on_exam_started(req_gen, result),
            Action::ExamLoaded(req_gen, result) => self.on_exam_loaded(req_gen, result),
            Action::ExamSubmitted(req_gen, result) => self.on_exam_submitted(req_gen, result),
            Action::StartPlacement => self.on_start_placement(),
            Action::OpenMemory => self.on_open_memory(),
            Action::OpenSettings => self.on_open_settings(),
            Action::ToggleLangColumn => self.on_toggle_lang_column(),
            Action::PlacementLoaded(req_gen, result) => self.on_placement_loaded(req_gen, result),
            Action::PlacementSubmitted(req_gen, result) => {
                self.on_placement_submitted(req_gen, result)
            }
            Action::NotesDeduced(req_gen, result) => self.on_notes_deduced(req_gen, result),
            Action::NotesConfirmed(req_gen, result) => self.on_notes_confirmed(req_gen, result),
            Action::NotesStart => self.start_notes_placement(),
            Action::NotesInput(c) => self.notes_input_char(c),
            Action::NotesInputNewline => self.notes_input_newline(),
            Action::NotesInputBackspace => self.notes_input_backspace(),
            Action::NotesSubmit => self.notes_submit(),
            Action::NotesConfirm => self.notes_confirm(),
            Action::NotesTakeTest => self.notes_take_test(),
            Action::NotesCancel => self.notes_cancel(),
            Action::GraphLoaded(req_gen, result) => self.on_graph_loaded(req_gen, result),
            Action::ConfigLoaded(req_gen, result) => self.on_config_loaded(req_gen, result),
            Action::ToggleAsk => self.on_toggle_ask(),
            Action::InteractionAsked(req_gen, result) => self.on_interaction_asked(req_gen, result),
            Action::InteractionPolled(req_gen, result) => {
                self.on_interaction_polled(req_gen, result)
            }
            Action::AnswerAudioDownloaded(req_gen, result) => {
                self.on_answer_audio_downloaded(req_gen, result)
            }
            Action::ToggleThemePicker => self.on_toggle_theme_picker(),
            Action::ToggleHelp => self.on_toggle_help(),
            Action::CycleThemeValue => self.on_cycle_theme_value(),
            Action::ToggleAccounts => self.on_toggle_accounts(),
            Action::SwitchAccount => self.on_switch_account(),
        }
        Ok(())
    }

    fn handle_event(&mut self, event: Event) -> Result<()> {
        match event {
            Event::Init => self.action_tx.send(Action::Render)?,
            Event::Render => self.action_tx.send(Action::Render)?,
            Event::Tick => self.action_tx.send(Action::Tick)?,
            Event::Resize(w, h) => self.action_tx.send(Action::Resize(w, h))?,
            Event::Key(key) => {
                if let Some(action) = self.map_key(key) {
                    self.action_tx.send(action)?;
                }
            }
            Event::Mouse(_) | Event::FocusGained | Event::FocusLost => {}
        }
        Ok(())
    }

    /// Translate a key press into an action given the current screen. Ctrl-C
    /// always quits; `q`/Esc backs out a level (and quits from the root).
    fn map_key(&self, key: KeyEvent) -> Option<Action> {
        if key.modifiers.contains(KeyModifiers::CONTROL) && matches!(key.code, KeyCode::Char('c')) {
            return Some(Action::Quit);
        }

        // Theme picker (`t`) is a top-level MODAL: while open it owns input and
        // swallows everything else, so no key leaks to the screen behind it.
        if self.theme_picker.open {
            return match key.code {
                KeyCode::Up | KeyCode::Char('k') => Some(Action::Up),
                KeyCode::Down | KeyCode::Char('j') => Some(Action::Down),
                KeyCode::Enter | KeyCode::Right | KeyCode::Char(' ') => {
                    Some(Action::CycleThemeValue)
                }
                KeyCode::Char('t') | KeyCode::Esc | KeyCode::Char('q') => {
                    Some(Action::ToggleThemePicker)
                }
                _ => None,
            };
        }
        // Key-help (`?`) is a top-level MODAL: dismiss on `?`/Esc, swallow else.
        if self.help_open {
            return match key.code {
                KeyCode::Char('?') | KeyCode::Esc | KeyCode::Char('q') => Some(Action::ToggleHelp),
                _ => None,
            };
        }
        // Account switcher (`A`) is a top-level MODAL: ↑/↓ move, Enter switches,
        // `A`/Esc close; everything else is swallowed.
        if self.accounts.open {
            return match key.code {
                KeyCode::Up | KeyCode::Char('k') => Some(Action::Up),
                KeyCode::Down | KeyCode::Char('j') => Some(Action::Down),
                KeyCode::Enter => Some(Action::SwitchAccount),
                KeyCode::Char('A') | KeyCode::Esc | KeyCode::Char('q') => {
                    Some(Action::ToggleAccounts)
                }
                _ => None,
            };
        }

        // Ask-a-question overlay (listening Q&A) is fully MODAL: while it is open
        // in ANY phase, only its own keys act and EVERY other key is swallowed
        // (return Some/None here, never fall through) so nothing reaches the
        // listening/class/exam keymap behind the overlay — the UI hides the
        // comprehension items and section body, so a leaked Enter/number could
        // otherwise answer a hidden item or advance the section.
        let ctrl_d =
            matches!(key.code, KeyCode::Char('d')) && key.modifiers.contains(KeyModifiers::CONTROL);
        if self.ask_editing() {
            // Editing: WritingInput keys + Ctrl-D submit + Esc cancel.
            return match key.code {
                _ if ctrl_d => Some(Action::SubmitText),
                KeyCode::Esc => Some(Action::ToggleAsk),
                KeyCode::Enter => Some(Action::InputNewline),
                KeyCode::Backspace => Some(Action::InputBackspace),
                KeyCode::Char(c) => Some(Action::Input(c)),
                _ => None,
            };
        }
        if self.ask_failed() {
            // Failed/timeout: `r` or Ctrl-D retries; Esc closes. Else swallow.
            return match key.code {
                KeyCode::Char('r') => Some(Action::SubmitText),
                _ if ctrl_d => Some(Action::SubmitText),
                KeyCode::Esc => Some(Action::ToggleAsk),
                _ => None,
            };
        }
        if self.ask_answered() {
            // Answered: Esc/Enter (or `a`) close the overlay. Else swallow.
            return match key.code {
                KeyCode::Esc | KeyCode::Enter | KeyCode::Char('a') => Some(Action::ToggleAsk),
                _ => None,
            };
        }
        if self.ask_overlay_open() {
            // In flight (asking/polling): only Esc cancels. Else swallow.
            return match key.code {
                KeyCode::Esc => Some(Action::ToggleAsk),
                _ => None,
            };
        }
        // Listening (standalone or class/exam section): `a` opens the Q&A overlay.
        if self.audio_screen() && matches!(key.code, KeyCode::Char('a')) {
            return Some(Action::ToggleAsk);
        }

        // Writing editor: capture text input. Ctrl-D submits; Esc backs out.
        if self.in_writing_editing() {
            return match key.code {
                KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    Some(Action::SubmitText)
                }
                KeyCode::Esc => Some(Action::Back),
                KeyCode::Enter => Some(Action::InputNewline),
                KeyCode::Backspace => Some(Action::InputBackspace),
                KeyCode::Char(c) => Some(Action::Input(c)),
                _ => None,
            };
        }

        // Writing submission failed: `r` or Ctrl-D resubmits the preserved text.
        if self.in_writing_failed()
            && (matches!(key.code, KeyCode::Char('r'))
                || (matches!(key.code, KeyCode::Char('d'))
                    && key.modifiers.contains(KeyModifiers::CONTROL)))
        {
            return Some(Action::SubmitText);
        }

        // Notes-based placement owns input in its own phases: a text editor while
        // typing materials, then a two-choice result. Returns above the global
        // polish keys so `t`/`?` are typed into the materials, not intercepted.
        if let View::NotesPlacement { phase, .. } = &self.view {
            let ctrl_d = matches!(key.code, KeyCode::Char('d'))
                && key.modifiers.contains(KeyModifiers::CONTROL);
            return match phase {
                NotesPhase::Entry => match key.code {
                    _ if ctrl_d => Some(Action::NotesSubmit),
                    KeyCode::Esc => Some(Action::NotesCancel),
                    KeyCode::Enter => Some(Action::NotesInputNewline),
                    KeyCode::Backspace => Some(Action::NotesInputBackspace),
                    KeyCode::Char(c) => Some(Action::NotesInput(c)),
                    _ => None,
                },
                NotesPhase::Result { .. } => match key.code {
                    KeyCode::Enter => Some(Action::NotesConfirm),
                    KeyCode::Char('t') => Some(Action::NotesTakeTest),
                    KeyCode::Esc => Some(Action::NotesCancel),
                    _ => None,
                },
                // Deducing / Confirming: a request is in flight; swallow keys.
                NotesPhase::Deducing | NotesPhase::Confirming => None,
            };
        }

        // Global polish keys (reached only when no text-entry/ask overlay is
        // active — those modes return above, so these never disturb typing):
        // `t` theme picker, `?` key-help, `A` (shift+a) account switcher.
        match key.code {
            KeyCode::Char('t') => return Some(Action::ToggleThemePicker),
            KeyCode::Char('?') => return Some(Action::ToggleHelp),
            KeyCode::Char('A') => return Some(Action::ToggleAccounts),
            _ => {}
        }

        // Screen-specific keys take priority over the generic mapping below.
        match &self.view {
            // Persistent error screen: `r` retries the failed action.
            View::Error { .. } if matches!(key.code, KeyCode::Char('r')) => {
                return Some(Action::Retry);
            }
            // PlacementLang: `m` opens the "paste materials" placement path.
            View::PlacementLang { .. } if matches!(key.code, KeyCode::Char('m')) => {
                return Some(Action::NotesStart);
            }
            // Listening (standalone or class section): space toggles playback.
            _ if self.audio_screen() && matches!(key.code, KeyCode::Char(' ')) => {
                return Some(Action::PlayPause);
            }
            // Speaking (standalone or class section): `r` toggles recording.
            _ if self.speaking_screen() && matches!(key.code, KeyCode::Char('r')) => {
                return Some(Action::ToggleRecord);
            }
            // Class result: `n` continues to the next class.
            View::ClassOutcome { .. } | View::ClassDone { .. }
                if matches!(key.code, KeyCode::Char('n')) =>
            {
                return Some(Action::NextClass);
            }
            // CourseHome: `c` continues the course (start/resume the next class).
            View::CourseHome {
                starting: false, ..
            } if matches!(key.code, KeyCode::Char('c')) => {
                return Some(Action::NextClass);
            }
            // CourseHome: `e` starts a mock exam.
            View::CourseHome {
                starting: false, ..
            } if matches!(key.code, KeyCode::Char('e')) => {
                return Some(Action::StartExam);
            }
            // CourseHome: `m` opens the memory graph, `s` opens settings.
            View::CourseHome {
                starting: false, ..
            } if matches!(key.code, KeyCode::Char('m')) => {
                return Some(Action::OpenMemory);
            }
            View::CourseHome {
                starting: false, ..
            } if matches!(key.code, KeyCode::Char('s')) => {
                return Some(Action::OpenSettings);
            }
            // Courses: `n` and `s` start placement / open settings (the empty
            // courses state must be actionable for a fresh self-hoster).
            View::Courses { .. } if matches!(key.code, KeyCode::Char('n')) => {
                return Some(Action::StartPlacement);
            }
            View::Courses { .. } if matches!(key.code, KeyCode::Char('s')) => {
                return Some(Action::OpenSettings);
            }
            // Placement picker: Tab switches the focused language column.
            View::PlacementLang { .. } if matches!(key.code, KeyCode::Tab) => {
                return Some(Action::ToggleLangColumn);
            }
            _ => {}
        }

        match key.code {
            KeyCode::Char('q') | KeyCode::Esc => Some(self.back_action()),
            KeyCode::PageUp => Some(Action::ScrollUp),
            KeyCode::PageDown => Some(Action::ScrollDown),
            KeyCode::Up | KeyCode::Char('k') => Some(Action::Up),
            KeyCode::Down | KeyCode::Char('j') => Some(Action::Down),
            KeyCode::Enter | KeyCode::Char(' ') => Some(Action::Select),
            KeyCode::Char(c @ '1'..='9') => {
                let n = c as usize - '0' as usize;
                Some(Action::Choose(n))
            }
            _ => None,
        }
    }

    /// `q`/Esc quits at the root (`Loading`/`Courses`/`Error`), otherwise backs
    /// out a level.
    fn back_action(&self) -> Action {
        match self.view {
            View::Loading | View::Courses { .. } | View::Error { .. } => Action::Quit,
            _ => Action::Back,
        }
    }

    /// True when the current screen plays audio (standalone listening or a class
    /// listening section), so space maps to play/pause.
    fn audio_screen(&self) -> bool {
        matches!(self.view, View::ListeningReview { .. })
            || matches!(
                self.current_section().map(|s| &s.progress),
                Some(SectionProgress::Listening { .. })
            )
    }

    /// True when the current screen records speech (standalone speaking or a
    /// class speaking section), so `r` maps to record toggle.
    fn speaking_screen(&self) -> bool {
        matches!(self.view, View::SpeakingReview { .. })
            || matches!(
                self.current_section().map(|s| &s.progress),
                Some(SectionProgress::Speaking { .. })
            )
    }

    /// True when the current class section is a writing prompt being edited.
    fn in_writing_editing(&self) -> bool {
        matches!(
            self.current_section().map(|s| &s.progress),
            Some(SectionProgress::Writing {
                phase: WritingPhase::Editing,
                ..
            })
        )
    }

    /// True when the current writing section's submission failed (retryable).
    fn in_writing_failed(&self) -> bool {
        matches!(
            self.current_section().map(|s| &s.progress),
            Some(SectionProgress::Writing {
                phase: WritingPhase::Failed { .. },
                ..
            })
        )
    }

    /// The section the learner is currently on, in a `Class` OR an `Exam`. Both
    /// reuse the same `SectionProgress` walk, so the input handlers in
    /// `app::class` operate on either via this accessor.
    fn current_section(&self) -> Option<&state::ClassSection> {
        match &self.view {
            View::Class {
                sections: Some(sections),
                cursor,
                ..
            }
            | View::Exam {
                sections: Some(sections),
                cursor,
                ..
            } => sections.get(*cursor),
            _ => None,
        }
    }

    /// True in a section-walk flow (a class OR an exam), so input is routed to
    /// the shared `app::class` section handlers.
    fn in_section_walk(&self) -> bool {
        matches!(self.view, View::Class { .. } | View::Exam { .. })
    }

    // --- Input handlers ----------------------------------------------------

    fn on_up(&mut self) {
        // The theme picker owns ↑/↓ when open (row focus).
        if self.theme_picker.open {
            self.theme_picker.move_row(false);
            self.render();
            return;
        }
        // The account switcher owns ↑/↓ when open (profile selection).
        if self.accounts.open {
            self.accounts.move_cursor(false, self.config.profiles.len());
            self.render();
            return;
        }
        if self.in_section_walk() {
            self.class_cursor_move(true);
            return;
        }
        match &mut self.view {
            View::Courses { cursor, .. } => {
                *cursor = list_up(*cursor);
                self.render();
            }
            View::CourseHome { menu_cursor, .. } => {
                *menu_cursor = list_up(*menu_cursor);
                self.render();
            }
            View::ItemReview { cursor, .. } => {
                *cursor = cursor_up(*cursor);
                self.render();
            }
            View::ListeningReview { cursor, .. } => {
                *cursor = cursor_up(*cursor);
                self.render();
            }
            View::PlacementLang { .. } => self.placement_lang_move(true),
            View::PlacementReview { .. } => self.placement_cursor_move(true),
            View::Memory { .. } => self.memory_scroll(false),
            _ => {}
        }
    }

    fn on_down(&mut self) {
        if self.theme_picker.open {
            self.theme_picker.move_row(true);
            self.render();
            return;
        }
        if self.accounts.open {
            self.accounts.move_cursor(true, self.config.profiles.len());
            self.render();
            return;
        }
        if self.in_section_walk() {
            self.class_cursor_move(false);
            return;
        }
        match &mut self.view {
            View::Courses { courses, cursor } => {
                *cursor = list_down(*cursor, courses.len());
                self.render();
            }
            View::CourseHome { menu_cursor, .. } => {
                *menu_cursor = list_down(*menu_cursor, SkillChoice::MENU.len());
                self.render();
            }
            View::ItemReview {
                items,
                index,
                cursor,
                ..
            } => {
                let option_count = items.get(*index).map_or(0, |i| i.options.len());
                *cursor = cursor_down(*cursor, option_count);
                self.render();
            }
            View::ListeningReview {
                items,
                index,
                cursor,
                ..
            } => {
                let option_count = items.get(*index).map_or(0, |i| i.options.len());
                *cursor = cursor_down(*cursor, option_count);
                self.render();
            }
            View::PlacementLang { .. } => self.placement_lang_move(false),
            View::PlacementReview { .. } => self.placement_cursor_move(false),
            View::Memory { .. } => self.memory_scroll(true),
            _ => {}
        }
    }

    /// Scroll the current item's prompt (PageUp/PageDown), for long reading
    /// passages. `ItemReview`, class MC sections, and placement have scrollable
    /// prompts; the memory list scrolls by page.
    fn on_scroll(&mut self, down: bool) {
        if self.in_section_walk() {
            self.class_scroll(down);
            return;
        }
        match &mut self.view {
            View::ItemReview { prompt_scroll, .. } => {
                *prompt_scroll = if down {
                    prompt_scroll.saturating_add(1)
                } else {
                    prompt_scroll.saturating_sub(1)
                };
                self.render();
            }
            View::PlacementReview { .. } => self.placement_scroll(down),
            View::Memory { .. } => self.memory_scroll(down),
            _ => {}
        }
    }

    // --- Theme & polish (P7) -----------------------------------------------

    /// Toggle the theme picker overlay (`t`). Closing it persists the choice.
    fn on_toggle_theme_picker(&mut self) {
        if self.theme_picker.open {
            self.theme_picker = ThemePicker::closed();
            self.persist_theme();
        } else {
            // Opening the picker dismisses the other modals (one at a time).
            self.help_open = false;
            self.accounts = AccountsOverlay::closed();
            self.theme_picker = ThemePicker::opened();
        }
        self.render();
    }

    /// Toggle the key-help overlay (`?`).
    fn on_toggle_help(&mut self) {
        self.help_open = !self.help_open;
        if self.help_open {
            self.theme_picker = ThemePicker::closed();
            self.accounts = AccountsOverlay::closed();
        }
        self.render();
    }

    /// Cycle the value of the picker's focused row and apply it live. The choice
    /// is persisted when the picker closes (not on every keystroke).
    fn on_cycle_theme_value(&mut self) {
        if self.theme_picker.open {
            overlay::cycle_focused(&mut self.theme, self.theme_picker.row);
            self.render();
        }
    }

    /// Persist `config` to its configured path. A no-op when `config_path` is
    /// `None` (tests), so the suite never writes the developer's real config.
    fn persist_config(&self) -> Result<()> {
        match &self.config_path {
            Some(path) => self.config.save_to(path),
            None => Ok(()),
        }
    }

    /// Write the active theme into `config` and persist it. A save failure is
    /// surfaced in the status bar rather than crashing the UI loop.
    fn persist_theme(&mut self) {
        self.config.theme = self.theme.to_choice();
        if let Err(e) = self.persist_config() {
            self.status_bar
                .set_error(format!("could not save theme: {e}"));
        }
    }

    // --- Account management (P9) -------------------------------------------

    /// Toggle the account switcher overlay (`A`). Opens with the cursor on the
    /// active profile so Enter on it is a no-op switch.
    fn on_toggle_accounts(&mut self) {
        if self.accounts.open {
            self.accounts = AccountsOverlay::closed();
        } else {
            self.theme_picker = ThemePicker::closed();
            self.help_open = false;
            let active_idx = self
                .config
                .profile_names()
                .iter()
                .position(|n| n == &self.config.active)
                .unwrap_or(0);
            self.accounts = AccountsOverlay::opened(active_idx);
        }
        self.render();
    }

    /// Switch to the profile under the switcher cursor.
    ///
    /// A successful client build is the GATE for the rest of the switch: we build
    /// the new profile's client FIRST, and only then swap it in, set the profile
    /// active, persist, and reload. If the build fails we change nothing — the
    /// previously-active profile and its client stay in place — so a fetch is
    /// never dispatched through a client that does not belong to the now-active
    /// profile (which would otherwise load the old account's data under the new
    /// one). The error surfaces in the status bar.
    fn on_switch_account(&mut self) {
        let names = self.config.profile_names();
        let Some(name) = names.get(self.accounts.cursor).cloned() else {
            self.accounts = AccountsOverlay::closed();
            return;
        };
        self.accounts = AccountsOverlay::closed();

        // No-op when already active (still close the overlay).
        if name == self.config.active {
            self.render();
            return;
        }

        // Build the target profile's client BEFORE mutating any state.
        let Some(profile) = self.config.profiles.get(&name).cloned() else {
            self.status_bar
                .set_error(format!("no profile named '{name}'"));
            self.render();
            return;
        };
        let client = match (self.client_factory)(&profile) {
            Ok(client) => client,
            Err(e) => {
                // Build failed: keep the previously-active profile + client. Do
                // NOT set active, persist, or fetch through the stale client.
                self.status_bar
                    .set_error(format!("could not connect with '{name}': {e}"));
                self.render();
                return;
            }
        };

        // The client is good — commit the switch.
        self.client = client;
        let user = profile
            .name
            .clone()
            .unwrap_or_else(|| "(owner)".to_string());
        self.status_bar.set_session(profile.server_url, user);
        // `set_active` cannot fail here: `name` came from `profile_names()`.
        let _ = self.config.set_active(&name);
        if let Err(e) = self.persist_config() {
            self.status_bar.set_error(format!("could not save: {e}"));
        }
        // Reload courses against the NEW client (bumps gen, sets Loading).
        self.fetch_courses();
    }

    fn on_select(&mut self) {
        match &self.view {
            View::Courses { courses, cursor } => {
                if let Some(course) = courses.get(*cursor).cloned() {
                    self.enter_course_home(course);
                }
            }
            // Enter is handled in map_key for notes placement (submit / confirm).
            View::NotesPlacement { .. } => {}
            View::CourseHome {
                course,
                due,
                menu_cursor,
                starting,
                ..
            } => {
                // Ignore a repeat Select while a start is already in flight so
                // key-mashing cannot spawn duplicate server work.
                if !*starting {
                    let skill = SkillChoice::MENU
                        .get(*menu_cursor)
                        .copied()
                        .unwrap_or(SkillChoice::Vocab);
                    // Vocab is gated on having vocab to review; listening/speaking
                    // always attempt (the server answers `unavailable` if not).
                    if skill != SkillChoice::Vocab || can_review_vocab(due) {
                        let course = course.clone();
                        self.start_skill(course, skill);
                    }
                }
            }
            View::ItemReview {
                cursor, submitting, ..
            } => {
                if !*submitting {
                    let choice = *cursor;
                    self.answer_choice(choice);
                }
            }
            View::ListeningReview {
                cursor,
                submitting,
                items,
                ..
            } => {
                if !*submitting && !items.is_empty() {
                    let choice = *cursor;
                    self.answer_choice(choice);
                }
            }
            View::SpeakingReview { phase, .. } => {
                // Enter advances to the next prompt once this one is graded/failed.
                if matches!(
                    phase,
                    SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. }
                ) {
                    self.next_speaking_prompt();
                }
            }
            View::Result { .. } => self.dismiss_result(),
            // Class and exam share the section-walk Select handler.
            View::Class { .. } | View::Exam { .. } => self.class_on_select(),
            View::ClassOutcome { .. } | View::ClassDone { .. } => self.on_next_class(),
            // Exams end with a band/score; Enter returns to the course home.
            View::ExamOutcome { course, .. } => {
                let course = course.clone();
                self.enter_course_home(course);
            }
            // Placement: confirm the picked languages, answer a question, or
            // continue from the result into the created course.
            View::PlacementLang { .. } => self.placement_lang_confirm(),
            View::PlacementReview {
                cursor, submitting, ..
            } => {
                if !*submitting {
                    let choice = *cursor;
                    self.placement_answer(choice);
                }
            }
            View::PlacementResult { .. } => self.placement_result_continue(),
            // Memory and settings are read-only; Enter does nothing.
            View::Memory { .. } | View::Settings { .. } => {}
            View::Loading | View::Error { .. } => {}
        }
    }

    fn on_choose(&mut self, n: usize) {
        // `n` is 1-based from the number keys.
        let index = n.saturating_sub(1);
        if self.in_section_walk() {
            self.class_on_choose(index);
            return;
        }
        match &self.view {
            View::Courses { courses, .. } => {
                if let Some(course) = courses.get(index).cloned() {
                    self.enter_course_home(course);
                }
            }
            View::ItemReview {
                items,
                index: item_index,
                submitting,
                ..
            } => {
                let option_count = items.get(*item_index).map_or(0, |i| i.options.len());
                if !*submitting && index < option_count {
                    self.answer_choice(index);
                }
            }
            View::ListeningReview {
                items,
                index: item_index,
                submitting,
                ..
            } => {
                let option_count = items.get(*item_index).map_or(0, |i| i.options.len());
                if !*submitting && index < option_count {
                    self.answer_choice(index);
                }
            }
            View::PlacementReview {
                questions,
                index: q_index,
                submitting,
                ..
            } => {
                let option_count = questions.get(*q_index).map_or(0, |q| q.options.len());
                if !*submitting && index < option_count {
                    self.placement_answer(index);
                }
            }
            _ => {}
        }
    }

    fn on_back(&mut self) {
        match &self.view {
            View::CourseHome { .. } => {
                // Back to the course list; refetch so counts are current.
                self.fetch_courses();
                self.render();
            }
            // Esc is handled in map_key for notes placement (NotesCancel).
            View::NotesPlacement { .. } => {}
            View::ItemReview { course, .. }
            | View::ListeningReview { course, .. }
            | View::SpeakingReview { course, .. }
            | View::Result { course, .. }
            | View::Class { course, .. }
            | View::ClassOutcome { course, .. }
            | View::ClassDone { course, .. }
            | View::Exam { course, .. }
            | View::ExamOutcome { course, .. }
            // Memory belongs to a course -> back to its home.
            | View::Memory { course, .. } => {
                let course = course.clone();
                // Stop any audio/recording before leaving a review screen.
                self.stop_audio();
                self.enter_course_home(course);
            }
            // Placement and settings have no owning course -> back to the list.
            View::PlacementLang { .. }
            | View::PlacementReview { .. }
            | View::PlacementResult { .. }
            | View::Settings { .. } => {
                self.fetch_courses();
                self.render();
            }
            View::Loading | View::Courses { .. } | View::Error { .. } => {}
        }
    }

    /// Stop playback and discard any in-progress recording (best-effort).
    fn stop_audio(&mut self) {
        if let Some(player) = &self.player {
            player.stop();
        }
        if self.recorder.is_recording() {
            let _ = self.recorder.stop();
        }
    }

    fn on_retry(&mut self) {
        if let View::Error { retry, .. } = &self.view {
            match retry {
                RetryKind::Courses => self.fetch_courses(),
            }
            self.render();
        }
    }

    // --- Screen transitions ------------------------------------------------

    fn enter_course_home(&mut self, course: Course) {
        // New target: invalidate any in-flight request for the previous one.
        let req_gen = self.bump_gen();
        self.fetch_due(&course.id, req_gen);
        self.view = View::course_home(course);
        self.render();
    }

    fn dismiss_result(&mut self) {
        if let View::Result { course, .. } = &self.view {
            let course = course.clone();
            // Refetch due counts; they should have dropped after the review.
            self.enter_course_home(course);
        }
    }

    /// Record `choice` for the current item of an ItemReview or ListeningReview,
    /// advancing or submitting. Shared by both choice-based review screens.
    fn answer_choice(&mut self, choice: usize) {
        let submit = match &mut self.view {
            View::ItemReview {
                items,
                selected,
                index,
                cursor,
                prompt_scroll,
                ..
            } => match answer_current(items, selected, *index, choice) {
                AnswerStep::Advanced => {
                    *index += 1;
                    *cursor = 0;
                    // New item: reset the prompt scroll for long reading text.
                    *prompt_scroll = 0;
                    None
                }
                AnswerStep::Submit(answers) => Some(answers),
            },
            View::ListeningReview {
                items,
                selected,
                index,
                cursor,
                ..
            } => match answer_current(items, selected, *index, choice) {
                AnswerStep::Advanced => {
                    *index += 1;
                    *cursor = 0;
                    None
                }
                AnswerStep::Submit(answers) => Some(answers),
            },
            _ => None,
        };

        if let Some(answers) = submit {
            match answers {
                Ok(answers) => self.submit_answers(answers),
                // A malformed answer id would corrupt the session; surface it
                // and leave the review in place rather than sending a partial
                // payload.
                Err(message) => self.status_bar.set_error(message),
            }
        }
        self.render();
    }

    // --- Async dispatch ----------------------------------------------------

    /// Spawn `task` and send `to_action(gen, result)` back through the channel
    /// when it resolves. `gen` lets the handler drop the result if the learner
    /// navigated away meanwhile. Keeps the render loop non-blocking.
    fn dispatch<F, T, A>(&self, req_gen: u64, task: F, to_action: A)
    where
        F: std::future::Future<Output = Result<T>> + Send + 'static,
        T: Send + 'static,
        A: FnOnce(u64, ApiResult<T>) -> Action + Send + 'static,
    {
        let tx = self.action_tx.clone();
        tokio::spawn(async move {
            let result = task.await.map_err(|e| e.to_string());
            let _ = tx.send(to_action(req_gen, Arc::new(result)));
        });
    }

    fn fetch_courses(&mut self) {
        let req_gen = self.bump_gen();
        self.view = View::Loading;
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.courses().await },
            Action::CoursesLoaded,
        );
        self.render();
    }

    fn fetch_due(&self, course_id: &str, req_gen: u64) {
        let client = Arc::clone(&self.client);
        let course_id = course_id.to_string();
        self.dispatch(
            req_gen,
            async move { client.practice_overview(&course_id).await },
            Action::DueLoaded,
        );
    }

    fn start_skill(&mut self, course: Course, skill: SkillChoice) {
        // New target: invalidate prior in-flight requests, clear any stale
        // notice, and mark the start in flight so a repeat Select is ignored.
        let req_gen = self.bump_gen();
        if let View::CourseHome {
            notice, starting, ..
        } = &mut self.view
        {
            *notice = None;
            *starting = true;
        }
        let client = Arc::clone(&self.client);
        let course_id = course.id.clone();
        let kind = skill.kind();
        self.dispatch(
            req_gen,
            async move { client.start_practice(&course_id, kind).await },
            Action::PracticeStarted,
        );
        self.render();
    }

    fn submit_answers(&mut self, answers: Vec<types::SubmitPracticeRequestAnswersItem>) {
        let req_gen = self.bump_gen();
        let session_id = match &mut self.view {
            View::ItemReview {
                session_id,
                submitting,
                ..
            }
            | View::ListeningReview {
                session_id,
                submitting,
                ..
            } => {
                *submitting = true;
                session_id.clone()
            }
            _ => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.submit_practice(&session_id, answers).await },
            Action::Submitted,
        );
    }

    // --- Listening ---------------------------------------------------------

    /// Fetch the episode for the current ListeningReview (called on entry).
    fn fetch_episode(&self, episode_id: &str, req_gen: u64) {
        let client = Arc::clone(&self.client);
        let episode_id = episode_id.to_string();
        self.dispatch(
            req_gen,
            async move { client.episode(&episode_id).await },
            Action::EpisodeLoaded,
        );
    }

    /// Toggle play/pause on the listening screen. The first press downloads and
    /// plays the episode audio; subsequent presses pause/resume.
    fn on_play_pause(&mut self) {
        if self.in_section_walk() {
            self.class_play_pause();
            return;
        }
        let url = match &self.view {
            View::ListeningReview { episode, .. } => {
                episode.as_ref().and_then(|e| e.audio_url.clone())
            }
            _ => return,
        };

        // If audio is already loaded, just toggle; otherwise download + play.
        if let Some(player) = &self.player
            && !player.is_finished()
        {
            let playing = player.toggle();
            self.set_audio_note(if playing { "Playing" } else { "Paused" });
            self.render();
            return;
        }

        match url {
            Some(url) => {
                self.set_audio_note("Loading audio…");
                let req_gen = self.request_gen;
                let client = Arc::clone(&self.client);
                self.dispatch(
                    req_gen,
                    async move { client.download(&url).await },
                    Action::AudioDownloaded,
                );
            }
            None => self.set_audio_note("No audio available for this episode yet."),
        }
        self.render();
    }

    fn set_audio_note(&mut self, note: &str) {
        if let View::ListeningReview { audio_note, .. } = &mut self.view {
            *audio_note = Some(note.to_string());
        }
    }

    // --- Speaking ----------------------------------------------------------

    /// Start or stop a recording on the speaking screen. Start → `Recording`;
    /// stop → encode WAV, upload, then poll grading. Guards re-entry by phase.
    fn on_toggle_record(&mut self) {
        if self.in_section_walk() {
            self.class_toggle_record();
            return;
        }
        let phase = match &self.view {
            View::SpeakingReview { phase, .. } => phase.clone(),
            _ => return,
        };

        match phase {
            SpeakingPhase::Idle | SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. } => {
                match self.recorder.start() {
                    Ok(()) => {
                        if let View::SpeakingReview { phase, .. } = &mut self.view {
                            *phase = SpeakingPhase::Recording;
                        }
                    }
                    Err(e) => self.status_bar.set_error(e.to_string()),
                }
                self.render();
            }
            SpeakingPhase::Recording => self.stop_and_upload(),
            // Upload/poll already in flight: ignore further toggles.
            SpeakingPhase::Uploading | SpeakingPhase::Polling { .. } => {}
        }
    }

    /// Stop the recorder, encode the WAV, and dispatch the multipart upload.
    fn stop_and_upload(&mut self) {
        let wav = match self.recorder.stop() {
            Ok(wav) => wav,
            Err(e) => {
                self.status_bar.set_error(e.to_string());
                if let View::SpeakingReview { phase, .. } = &mut self.view {
                    *phase = SpeakingPhase::Idle;
                }
                self.render();
                return;
            }
        };

        let req_gen = self.bump_gen();
        let (session_id, prompt_id) = match &mut self.view {
            View::SpeakingReview {
                session_id,
                prompts,
                index,
                phase,
                ..
            } => {
                let Some(prompt) = prompts.get(*index) else {
                    return;
                };
                *phase = SpeakingPhase::Uploading;
                (session_id.clone(), prompt.id.clone())
            }
            _ => return,
        };

        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.upload_speaking(&session_id, &prompt_id, wav).await },
            Action::SpeakingUploaded,
        );
        self.render();
    }

    /// Dispatch a single grading poll for `recording_id`. The result handler
    /// re-schedules another poll while grading is still pending.
    fn poll_grade(&self, recording_id: String, req_gen: u64) {
        let (session_id, prompt_id) = match &self.view {
            View::SpeakingReview {
                session_id,
                prompts,
                index,
                ..
            } => match prompts.get(*index) {
                Some(prompt) => (session_id.clone(), prompt.id.clone()),
                None => return,
            },
            _ => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move {
                client
                    .poll_speaking(&session_id, &prompt_id, &recording_id)
                    .await
            },
            Action::SpeakingPolled,
        );
    }

    /// Advance to the next speaking prompt, or finish the session by returning
    /// to the course home when the last prompt is done.
    fn next_speaking_prompt(&mut self) {
        let course = match &mut self.view {
            View::SpeakingReview {
                course,
                prompts,
                index,
                phase,
                ..
            } => {
                if *index + 1 < prompts.len() {
                    *index += 1;
                    *phase = SpeakingPhase::Idle;
                    self.render();
                    return;
                }
                course.clone()
            }
            _ => return,
        };
        // Last prompt done — back to the course home (refetches due counts).
        self.enter_course_home(course);
    }

    // --- Result reducers ---------------------------------------------------

    /// True when `gen` matches the current request generation, i.e. the result
    /// is for the target the learner is still on. Stale results are dropped.
    fn is_current(&self, req_gen: u64) -> bool {
        req_gen == self.request_gen
    }

    fn on_courses_loaded(&mut self, req_gen: u64, result: ApiResult<types::CoursesListResponse>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => self.view = View::courses(&resp.courses),
            // The initial/back course fetch is the one screen a failure would
            // strand, so promote it to a persistent, retryable error view.
            Err(message) => {
                self.view = View::Error {
                    message: message.clone(),
                    retry: RetryKind::Courses,
                };
            }
        }
        self.render();
    }

    fn on_due_loaded(&mut self, req_gen: u64, result: ApiResult<types::PracticeOverviewResponse>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let View::CourseHome { due, .. } = &mut self.view {
                    *due = DueCounts::from(resp);
                }
            }
            // CourseHome stays usable (zeroed counts) on a due-load failure, so
            // a transient status-bar error suffices rather than stranding it.
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }

    fn on_practice_started(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::StartPracticeResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                // Reduce against the current view (pure, unit-tested in
                // state.rs). reduce_start clears the `starting` flag and routes
                // by kind into the right review screen.
                let next = reduce_start(std::mem::replace(&mut self.view, View::Loading), resp);
                self.view = next;
                // Listening needs its episode fetched as a follow-up.
                if let View::ListeningReview { episode_id, .. } = &self.view {
                    let episode_id = episode_id.clone();
                    let req_gen = self.request_gen;
                    self.fetch_episode(&episode_id, req_gen);
                }
            }
            Err(message) => {
                // Clear the in-flight flag so the learner can retry.
                if let View::CourseHome { starting, .. } = &mut self.view {
                    *starting = false;
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    fn on_submitted(&mut self, req_gen: u64, result: ApiResult<types::SubmitPracticeResponse>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                // Both vocab and listening reviews submit answers and end on the
                // Result screen.
                let course = match &self.view {
                    View::ItemReview { course, .. } | View::ListeningReview { course, .. } => {
                        Some(course.clone())
                    }
                    _ => None,
                };
                if let Some(course) = course {
                    self.stop_audio();
                    self.view = View::Result {
                        course,
                        result: PracticeResult::from(resp),
                    };
                }
            }
            Err(message) => {
                // Clear the in-flight flag so the learner can resubmit.
                match &mut self.view {
                    View::ItemReview { submitting, .. }
                    | View::ListeningReview { submitting, .. } => *submitting = false,
                    _ => {}
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    fn on_episode_loaded(&mut self, req_gen: u64, result: ApiResult<types::EpisodeDetailResponse>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let View::ListeningReview { episode, .. } = &mut self.view {
                    *episode = Some(EpisodeDetail::from(resp));
                }
            }
            // Listening stays usable (transcript may be unavailable); surface a
            // transient error rather than stranding the screen.
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }

    fn on_audio_downloaded(&mut self, req_gen: u64, result: ApiResult<Vec<u8>>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(bytes) => self.play_bytes(bytes.clone()),
            Err(message) => self.set_audio_note(&format!("Audio unavailable: {message}")),
        }
        self.render();
    }

    /// Lazily open the audio output (guarded) and play the downloaded bytes.
    fn play_bytes(&mut self, bytes: Vec<u8>) {
        if self.player.is_none() {
            match AudioPlayer::new() {
                Ok(p) => self.player = Some(p),
                Err(e) => {
                    self.set_audio_note(&format!("Playback unavailable: {e}"));
                    return;
                }
            }
        }
        let Some(player) = &self.player else {
            return;
        };
        match player.play(bytes) {
            Ok(()) => self.set_audio_note("Playing"),
            Err(e) => self.set_audio_note(&format!("Could not play audio: {e}")),
        }
    }

    fn on_speaking_uploaded(&mut self, req_gen: u64, result: ApiResult<SpeakingUploadResponse>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let recording_id = resp.recording_id.clone();
                if let View::SpeakingReview { phase, .. } = &mut self.view {
                    *phase = SpeakingPhase::Polling {
                        recording_id: recording_id.clone(),
                    };
                }
                // Begin the grading poll loop under the same generation.
                self.poll_grade(recording_id, req_gen);
            }
            Err(message) => {
                if let View::SpeakingReview { phase, .. } = &mut self.view {
                    *phase = SpeakingPhase::Failed {
                        message: message.clone(),
                    };
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    fn on_speaking_polled(&mut self, req_gen: u64, result: ApiResult<types::SpeakingPollResponse>) {
        if !self.is_current(req_gen) {
            return;
        }
        // Capture the recording id we are polling (drops a result for a
        // superseded attempt).
        let recording_id = match &self.view {
            View::SpeakingReview {
                phase: SpeakingPhase::Polling { recording_id },
                ..
            } => recording_id.clone(),
            _ => return,
        };

        match result.as_ref() {
            Ok(resp) => {
                let next = reduce_speaking_poll(&recording_id, resp);
                let terminal = poll_is_terminal(&next);
                if let View::SpeakingReview { phase, .. } = &mut self.view {
                    *phase = next;
                }
                // Still pending: schedule another poll after a short delay.
                if !terminal {
                    self.schedule_poll(recording_id, req_gen);
                }
            }
            Err(message) => {
                if let View::SpeakingReview { phase, .. } = &mut self.view {
                    *phase = SpeakingPhase::Failed {
                        message: message.clone(),
                    };
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    /// Re-poll grading after a short delay, still tagged with `req_gen` so a
    /// navigation away invalidates the loop.
    fn schedule_poll(&self, recording_id: String, req_gen: u64) {
        let (session_id, prompt_id) = match &self.view {
            View::SpeakingReview {
                session_id,
                prompts,
                index,
                ..
            } => match prompts.get(*index) {
                Some(prompt) => (session_id.clone(), prompt.id.clone()),
                None => return,
            },
            _ => return,
        };
        let client = Arc::clone(&self.client);
        let tx = self.action_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            let result = client
                .poll_speaking(&session_id, &prompt_id, &recording_id)
                .await
                .map_err(|e| e.to_string());
            let _ = tx.send(Action::SpeakingPolled(req_gen, Arc::new(result)));
        });
    }

    // --- Rendering ---------------------------------------------------------

    fn render(&self) {
        let _ = self.action_tx.send(Action::Render);
    }

    /// Hard floor below which no screen can render legibly; show a minimal
    /// notice instead of clipping content. Chosen so every screen's fixed-height
    /// header/footer splits still leave a usable body.
    const MIN_COLS: u16 = 40;
    const MIN_ROWS: u16 = 10;

    fn draw(&mut self, frame: &mut Frame) -> Result<()> {
        let palette = self.theme.palette();
        let area = frame.area();

        // Paint the themed background across the whole frame first.
        frame.render_widget(
            ratatui::widgets::Block::default().style(Style::default().bg(palette.bg)),
            area,
        );

        // Below the hard floor, render only a centered "too small" message — the
        // fixed header/footer splits would otherwise clip the body to nothing.
        if area.width < Self::MIN_COLS || area.height < Self::MIN_ROWS {
            let msg = Paragraph::new(Text::from(vec![
                Line::from(Span::styled(
                    "Terminal too small",
                    Style::default()
                        .fg(palette.primary)
                        .add_modifier(ratatui::style::Modifier::BOLD),
                )),
                Line::from(Span::styled(
                    format!(
                        "need ≥ {}×{} (now {}×{})",
                        Self::MIN_COLS,
                        Self::MIN_ROWS,
                        area.width,
                        area.height
                    ),
                    Style::default().fg(palette.ink_soft),
                )),
            ]))
            .alignment(ratatui::layout::Alignment::Center)
            .wrap(Wrap { trim: true });
            frame.render_widget(msg, area);
            return Ok(());
        }

        let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(area);
        ui::draw_view(frame, chunks[0], &self.view, &self.config, &palette);
        self.status_bar.set_palette(palette);
        self.status_bar.draw(frame, chunks[1])?;

        // Modal overlays float on top of the screen behind them.
        if self.theme_picker.open {
            overlay::draw_theme_picker(
                frame,
                chunks[0],
                &self.theme,
                self.theme_picker.row,
                &palette,
            );
        } else if self.help_open {
            overlay::draw_help(frame, chunks[0], &self.view, &palette);
        } else if self.accounts.open {
            let profiles: Vec<(String, Profile)> = self
                .config
                .profiles
                .iter()
                .map(|(name, p)| (name.clone(), p.clone()))
                .collect();
            overlay::draw_accounts(
                frame,
                chunks[0],
                &profiles,
                &self.config.active,
                self.accounts.cursor,
                &palette,
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{Api, NextClassOutcome, types};
    use async_trait::async_trait;
    use std::sync::Arc;

    /// A pure canned-response [`Api`] stub for App tests: returns benign results
    /// and never touches the network, so dispatch + reducer behavior is
    /// exercised hermetically. The audio paths are never reached in tests.
    struct StubApi;

    #[async_trait]
    impl Api for StubApi {
        async fn courses(&self) -> Result<types::CoursesListResponse> {
            Ok(types::CoursesListResponse { courses: vec![] })
        }

        async fn practice_overview(
            &self,
            _course_id: &str,
        ) -> Result<types::PracticeOverviewResponse> {
            Ok(overview(0.0, 0.0))
        }

        async fn start_practice(
            &self,
            _course_id: &str,
            _kind: types::PracticeKind,
        ) -> Result<types::StartPracticeResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "unavailable",
                "reason": "nothing_due"
            }))
            .expect("valid start JSON"))
        }

        async fn submit_practice(
            &self,
            _session_id: &str,
            _answers: Vec<types::SubmitPracticeRequestAnswersItem>,
        ) -> Result<types::SubmitPracticeResponse> {
            Ok(types::SubmitPracticeResponse {
                score: 0.0,
                correct: 0.0,
                total: 0.0,
            })
        }

        async fn episode(&self, _episode_id: &str) -> Result<types::EpisodeDetailResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "ep-stub",
                "title": "Stub episode",
                "status": "READY",
                "audioUrl": null,
                "duration": null,
                "language": "es",
                "segments": []
            }))
            .expect("valid episode JSON"))
        }

        async fn poll_speaking(
            &self,
            _session_id: &str,
            _prompt_id: &str,
            _recording_id: &str,
        ) -> Result<types::SpeakingPollResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "PENDING",
                "overallScore": null,
                "transcript": null,
                "feedback": null
            }))
            .expect("valid poll JSON"))
        }

        async fn upload_speaking(
            &self,
            _session_id: &str,
            _prompt_id: &str,
            _wav: Vec<u8>,
        ) -> Result<SpeakingUploadResponse> {
            Ok(SpeakingUploadResponse {
                recording_id: "rec-stub".into(),
                status: "PENDING".into(),
            })
        }

        async fn download(&self, _url: &str) -> Result<Vec<u8>> {
            Ok(Vec::new())
        }

        async fn next_class(&self, _course_id: &str) -> Result<NextClassOutcome> {
            Ok(NextClassOutcome::Done)
        }

        async fn class(&self, _class_id: &str) -> Result<types::ClassDetailResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "cls-stub",
                "courseId": "course-stub",
                "status": "IN_PROGRESS",
                "order": 1,
                "passThreshold": 0.7,
                "submitted": false,
                "sections": []
            }))
            .expect("valid class JSON"))
        }

        async fn submit_class(
            &self,
            _class_id: &str,
            _answers: Vec<types::SubmitClassRequestAnswersItem>,
        ) -> Result<types::SubmitClassResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "passed": true,
                "overallScore": 1.0,
                "passedSections": 1,
                "totalSections": 1,
                "sections": []
            }))
            .expect("valid submit-class JSON"))
        }

        async fn upload_class_speaking(
            &self,
            _class_id: &str,
            _prompt_id: &str,
            _wav: Vec<u8>,
        ) -> Result<SpeakingUploadResponse> {
            Ok(SpeakingUploadResponse {
                recording_id: "rec-stub".into(),
                status: "PENDING".into(),
            })
        }

        async fn poll_class_speaking(
            &self,
            _class_id: &str,
            _prompt_id: &str,
            _recording_id: &str,
        ) -> Result<types::SpeakingPollResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "PENDING",
                "overallScore": null,
                "transcript": null,
                "feedback": null
            }))
            .expect("valid poll JSON"))
        }

        async fn submit_class_writing(
            &self,
            _class_id: &str,
            _prompt_id: &str,
            _text: String,
        ) -> Result<crate::api::WritingGradeResponse> {
            Ok(crate::api::WritingGradeResponse {
                overall_score: 0.9,
                feedback: "Good.".into(),
            })
        }

        async fn start_exam(
            &self,
            _course_id: &str,
            _level: Option<types::CefrLevel>,
        ) -> Result<types::StartExamResponse> {
            Ok(
                serde_json::from_value(serde_json::json!({ "examId": "exam-stub" }))
                    .expect("valid start-exam JSON"),
            )
        }

        async fn exam(&self, _exam_id: &str) -> Result<types::ExamDetailResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "exam-stub", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
                "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "sections": [],
                "result": null
            }))
            .expect("valid exam JSON"))
        }

        async fn submit_exam(
            &self,
            _exam_id: &str,
            _answers: Vec<types::SubmitExamRequestAnswersItem>,
        ) -> Result<types::SubmitExamResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "overallScore": 1.0, "band": "C1", "feedback": "Strong.", "sections": []
            }))
            .expect("valid submit-exam JSON"))
        }

        async fn upload_exam_speaking(
            &self,
            _exam_id: &str,
            _prompt_id: &str,
            _wav: Vec<u8>,
        ) -> Result<SpeakingUploadResponse> {
            Ok(SpeakingUploadResponse {
                recording_id: "rec-stub".into(),
                status: "PENDING".into(),
            })
        }

        async fn poll_exam_speaking(
            &self,
            _exam_id: &str,
            _prompt_id: &str,
            _recording_id: &str,
        ) -> Result<types::SpeakingPollResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "PENDING", "overallScore": null, "transcript": null, "feedback": null
            }))
            .expect("valid poll JSON"))
        }

        async fn submit_exam_writing(
            &self,
            _exam_id: &str,
            _prompt_id: &str,
            _text: String,
        ) -> Result<crate::api::WritingGradeResponse> {
            Ok(crate::api::WritingGradeResponse {
                overall_score: 0.8,
                feedback: "Good.".into(),
            })
        }

        async fn generate_placement(
            &self,
            _native: &str,
            _target: &str,
        ) -> Result<types::GeneratePlacementResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "native": "en", "target": "es",
                "questions": [
                    { "id": "pq_0", "cefr": "A1", "skill": "grammar", "prompt": "?", "options": ["a","b"] }
                ]
            }))
            .expect("valid placement JSON"))
        }

        async fn submit_placement(
            &self,
            _native: &str,
            _target: &str,
            _answers: Vec<types::SubmitPlacementRequestAnswersItem>,
        ) -> Result<types::SubmitPlacementResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-stub", "level": "A2", "scoreBySkill": { "grammar": 0.5 }
            }))
            .expect("valid submit-placement JSON"))
        }

        async fn deduce_from_notes(
            &self,
            _native: &str,
            _target: &str,
            _content: &str,
        ) -> Result<types::DeduceFromNotesResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "native": "en", "target": "es",
                "deducedLevel": "B1", "rationale": "Uses past tense.", "confidence": 0.8
            }))
            .expect("valid deduce-from-notes JSON"))
        }

        async fn confirm_from_notes(
            &self,
            _native: &str,
            _target: &str,
        ) -> Result<types::ConfirmFromNotesResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-stub", "level": "B1", "addedVocabulary": 5
            }))
            .expect("valid confirm-from-notes JSON"))
        }

        async fn graph(&self, _course_id: &str) -> Result<types::MemoryGraphResponse> {
            Ok(
                serde_json::from_value(serde_json::json!({ "nodes": [], "edges": [] }))
                    .expect("valid graph JSON"),
            )
        }

        async fn onboarding_config(&self) -> Result<types::OnboardingConfigResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "selfHosted": true, "isOwner": false, "infra": null
            }))
            .expect("valid config JSON"))
        }

        async fn me(&self) -> Result<types::MeResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "u_stub", "name": "Stub Learner", "email": null,
                "image": null
            }))
            .expect("valid me JSON"))
        }

        async fn ask_interaction(
            &self,
            _episode_id: &str,
            _question: String,
            _timestamp: f64,
        ) -> Result<types::InteractionResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "int-stub", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            }))
            .expect("valid interaction JSON"))
        }

        async fn poll_interaction(
            &self,
            _episode_id: &str,
            _interaction_id: &str,
        ) -> Result<types::InteractionResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "int-stub", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            }))
            .expect("valid interaction JSON"))
        }
    }

    /// A config with a single active `default` profile pointing at the stub.
    fn stub_config() -> Config {
        let mut config = Config::default();
        config.upsert_profile(
            "default",
            crate::config::Profile {
                server_url: "stub://test".into(),
                api_key: "test-key".into(),
                name: None,
            },
        );
        config.active = "default".into();
        config
    }

    /// A [`ClientFactory`] that hands out a fresh [`StubApi`] for any profile and
    /// records the server_url it was last asked to build, so a switch test can
    /// assert the client was rebuilt for the new profile.
    fn recording_factory() -> (ClientFactory, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let built = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&built);
        let factory: ClientFactory = Arc::new(move |profile: &crate::config::Profile| {
            sink.lock().unwrap().push(profile.server_url.clone());
            Ok(Arc::new(StubApi) as Arc<dyn Api>)
        });
        (factory, built)
    }

    /// Build an `App` around a [`StubApi`]. No terminal is created and no
    /// network is possible: the only [`Api`] impl is the stub.
    fn test_app() -> App {
        let (factory, _) = recording_factory();
        // `None` config path: tests must never persist to the real config file.
        App::with_factory_at(stub_config(), factory, None).expect("stub app builds")
    }

    #[test]
    fn config_persists_to_the_injected_path_only() {
        // Regression: the App must write to its injected config_path, never the
        // real platform path, or running `cargo test` clobbers the developer's
        // own ~/.config/sotto/config.toml.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        let (factory, _) = recording_factory();
        let mut app =
            App::with_factory_at(stub_config(), factory, Some(path.clone())).expect("app builds");

        assert!(!path.exists(), "nothing is written before a save");
        app.persist_theme();
        assert!(path.exists(), "persist_theme writes to the injected path");

        // A None-path app persists nowhere and must not panic.
        let (factory2, _) = recording_factory();
        let mut noop = App::with_factory_at(stub_config(), factory2, None).expect("app builds");
        noop.persist_theme();
    }

    fn course(id: &str) -> Course {
        Course {
            id: id.into(),
            title: format!("Course {id}"),
            native_lang: "en".into(),
            target_lang: "es".into(),
            current_level: "A2".into(),
        }
    }

    fn ok<T>(value: T) -> ApiResult<T> {
        Arc::new(Ok(value))
    }

    fn overview(vocab: f64, total: f64) -> types::PracticeOverviewResponse {
        serde_json::from_value(serde_json::json!({
            "due": { "vocab": vocab, "grammar": 0 },
            "totalVocab": total,
            "recent": []
        }))
        .expect("valid overview JSON")
    }

    #[tokio::test]
    async fn stale_due_result_for_a_previous_course_is_ignored() {
        let mut app = test_app();

        // Learner opens course A (gen bumps), then navigates to course B
        // (gen bumps again) before A's overview lands.
        app.enter_course_home(course("A"));
        let stale_gen = app.request_gen;
        app.enter_course_home(course("B"));

        // A's overview arrives late, tagged with the stale generation. Fed
        // directly into the reducer — no client involved.
        app.on_due_loaded(stale_gen, ok(overview(99.0, 99.0)));

        // It must NOT have written A's counts onto B's CourseHome.
        match &app.view {
            View::CourseHome { course, due, .. } => {
                assert_eq!(course.id, "B");
                assert_eq!(due.vocab, 0, "stale counts must not apply to course B");
            }
            other => panic!("expected CourseHome for B, got {other:?}"),
        }

        // The current generation's result still applies normally.
        let current = app.request_gen;
        app.on_due_loaded(current, ok(overview(5.0, 20.0)));
        match &app.view {
            View::CourseHome { due, .. } => assert_eq!(due.vocab, 5),
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn grammar_start_result_routes_to_the_shared_item_review() {
        let mut app = test_app();
        // On a CourseHome (bumps gen, dispatches due fetch).
        app.enter_course_home(course("A"));
        let req_gen = app.request_gen;

        let resp: ApiResult<types::StartPracticeResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "status": "ready",
                "sessionId": "sess-gram",
                "kind": "GRAMMAR",
                "items": [
                    { "id": "q0", "prompt": "Pick the verb", "options": ["ser", "casa"] }
                ]
            }))
            .expect("valid grammar ready")));

        app.on_practice_started(req_gen, resp);

        match &app.view {
            View::ItemReview {
                kind,
                session_id,
                items,
                ..
            } => {
                assert_eq!(*kind, state::ReviewKind::Grammar);
                assert_eq!(session_id, "sess-gram");
                assert_eq!(items.len(), 1);
            }
            other => panic!("expected ItemReview after grammar start, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn second_select_while_starting_does_not_dispatch_twice() {
        let mut app = test_app();
        // Sit on a CourseHome that can start a review.
        app.view = View::CourseHome {
            course: course("A"),
            due: DueCounts {
                vocab: 3,
                grammar: 0,
                total_vocab: 9,
            },
            menu_cursor: 0,
            notice: None,
            starting: false,
        };

        let before = app.request_gen;
        app.on_select(); // first start: dispatches, sets starting, bumps gen
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1, "first start should dispatch once");
        assert!(
            matches!(app.view, View::CourseHome { starting: true, .. }),
            "start should be marked in flight"
        );

        app.on_select(); // key-mash: must be ignored while starting
        assert_eq!(
            app.request_gen, after_first,
            "a second Select while starting must not dispatch again"
        );
    }

    // --- Notes-based placement (P5) ----------------------------------------

    fn deduce_resp(level: &str, confidence: f64) -> ApiResult<types::DeduceFromNotesResponse> {
        Arc::new(Ok(serde_json::from_value(serde_json::json!({
            "native": "en", "target": "es",
            "deducedLevel": level, "rationale": "Uses past tense.", "confidence": confidence
        }))
        .expect("valid deduce JSON")))
    }

    #[test]
    fn materials_path_opens_the_editor_from_the_language_picker() {
        let mut app = test_app();
        app.view = View::placement_lang();
        app.start_notes_placement();
        assert!(matches!(
            app.view,
            View::NotesPlacement {
                phase: NotesPhase::Entry,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn typing_then_submitting_materials_deduces_a_level() {
        let mut app = test_app();
        app.view = View::placement_lang();
        app.start_notes_placement();
        for c in "hola mundo".chars() {
            app.notes_input_char(c);
        }
        match &app.view {
            View::NotesPlacement { input, .. } => assert_eq!(input, "hola mundo"),
            other => panic!("expected NotesPlacement, got {other:?}"),
        }

        // Submit dispatches deduction; deliver the result with the current gen.
        app.notes_submit();
        let req_gen = app.request_gen;
        app.on_notes_deduced(req_gen, deduce_resp("B1", 0.8));

        match &app.view {
            View::NotesPlacement {
                phase:
                    NotesPhase::Result {
                        level, confidence, ..
                    },
                ..
            } => {
                assert_eq!(level, "B1");
                assert_eq!(*confidence, 80);
            }
            other => panic!("expected Result phase, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn starting_here_creates_the_course_and_lands_in_it() {
        let mut app = test_app();
        app.view = View::NotesPlacement {
            native: "en".into(),
            target: "es".into(),
            input: String::new(),
            phase: NotesPhase::Result {
                level: "B1".into(),
                rationale: "r".into(),
                confidence: 80,
            },
        };
        app.notes_confirm();
        let req_gen = app.request_gen;
        let resp: ApiResult<types::ConfirmFromNotesResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-9", "level": "B1", "addedVocabulary": 4
            }))
            .expect("valid confirm JSON")));
        app.on_notes_confirmed(req_gen, resp);

        match &app.view {
            View::CourseHome { course, .. } => {
                assert_eq!(course.id, "course-9");
                assert_eq!(course.current_level, "B1");
                assert_eq!(course.native_lang, "en");
                assert_eq!(course.target_lang, "es");
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn esc_steps_back_from_result_to_editing_then_to_the_picker() {
        let mut app = test_app();
        app.view = View::NotesPlacement {
            native: "en".into(),
            target: "es".into(),
            input: "notes".into(),
            phase: NotesPhase::Result {
                level: "B1".into(),
                rationale: "r".into(),
                confidence: 80,
            },
        };
        app.notes_cancel();
        assert!(matches!(
            app.view,
            View::NotesPlacement {
                phase: NotesPhase::Entry,
                ..
            }
        ));
        app.notes_cancel();
        assert!(matches!(app.view, View::PlacementLang { .. }));
    }

    #[tokio::test]
    async fn second_select_while_submitting_does_not_dispatch_twice() {
        let mut app = test_app();
        // A single-item review, sitting on its last (only) item so Select submits.
        app.view = View::start_items(
            course("A"),
            super::state::ReviewKind::Vocab,
            "sess-1".into(),
            vec![super::state::VocabItem {
                id: "v1".into(),
                prompt: "casa".into(),
                options: vec!["house".into(), "dog".into()],
            }],
        );

        let before = app.request_gen;
        app.on_select(); // records the answer and submits
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1, "submit should dispatch once");
        assert!(
            matches!(
                app.view,
                View::ItemReview {
                    submitting: true,
                    ..
                }
            ),
            "submit should be marked in flight"
        );

        app.on_select(); // key-mash: must be ignored while submitting
        assert_eq!(
            app.request_gen, after_first,
            "a second Select while submitting must not dispatch again"
        );
    }

    #[tokio::test]
    async fn courses_load_failure_becomes_a_retryable_error_view() {
        let mut app = test_app();
        let req_gen = app.request_gen; // matches the in-flight initial fetch

        let err: ApiResult<types::CoursesListResponse> = Arc::new(Err("network down".into()));
        app.on_courses_loaded(req_gen, err);

        match &app.view {
            View::Error { message, retry } => {
                assert_eq!(message, "network down");
                assert_eq!(*retry, RetryKind::Courses);
            }
            other => panic!("expected Error view, got {other:?}"),
        }

        // Retrying re-dispatches the fetch and returns to Loading.
        app.on_retry();
        assert!(matches!(app.view, View::Loading));
    }

    // --- P6b: classes (hermetic, no device/network) -----------------------

    fn next_outcome(outcome: NextClassOutcome) -> ApiResult<NextClassOutcome> {
        Arc::new(Ok(outcome))
    }

    fn class_detail(mut json: serde_json::Value) -> ApiResult<types::ClassDetailResponse> {
        if let Some(obj) = json.as_object_mut() {
            obj.entry("courseId")
                .or_insert_with(|| serde_json::json!("course1"));
        }
        Arc::new(Ok(serde_json::from_value(json).expect("valid class JSON")))
    }

    #[tokio::test]
    async fn next_class_done_shows_the_course_complete_screen() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        // Start the class flow; the next-class resolver needs pending_course set.
        app.on_next_class();
        let req_gen = app.request_gen;

        app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Done));

        match &app.view {
            View::ClassDone { course } => assert_eq!(course.id, "A"),
            other => panic!("expected ClassDone, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn next_class_created_enters_the_class_and_loads_sections() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_next_class();
        let req_gen = app.request_gen;

        // next-class returns a class id -> enter Class (sections load next).
        app.on_next_class_resolved(
            req_gen,
            next_outcome(NextClassOutcome::Created {
                class_id: "cls1".into(),
            }),
        );
        match &app.view {
            View::Class {
                class_id, sections, ..
            } => {
                assert_eq!(class_id, "cls1");
                assert!(sections.is_none(), "sections load separately");
            }
            other => panic!("expected Class, got {other:?}"),
        }

        // The class detail lands and the sections populate, in order.
        let load_gen = app.request_gen;
        app.on_class_loaded(
            load_gen,
            class_detail(serde_json::json!({
                "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
                "submitted": false,
                "sections": [
                    { "id": "sec-g", "skill": "GRAMMAR", "status": "READY", "episode": null,
                      "prompts": [], "writingPrompts": [],
                      "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
                ]
            })),
        );
        match &app.view {
            View::Class {
                sections: Some(sections),
                ..
            } => assert_eq!(sections.len(), 1),
            other => panic!("expected loaded Class, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn malformed_class_backs_out_to_course_home() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.view = View::class_view(course("A"), "cls1".into());
        let req_gen = app.request_gen;

        // Empty sections -> malformed -> back to CourseHome.
        app.on_class_loaded(
            req_gen,
            class_detail(serde_json::json!({
                "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
                "submitted": false, "sections": []
            })),
        );
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    #[tokio::test]
    async fn class_submit_result_shows_pass_and_offers_next_class() {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        let req_gen = app.request_gen;

        let resp: ApiResult<types::SubmitClassResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "passed": true, "overallScore": 0.85, "passedSections": 5, "totalSections": 5,
                "sections": []
            }))
            .expect("valid submit")));
        app.on_class_submitted(req_gen, resp);

        match &app.view {
            View::ClassOutcome { result, .. } => {
                assert!(result.passed);
                assert_eq!(result.overall_score, 85);
            }
            other => panic!("expected ClassOutcome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stale_class_result_for_a_previous_class_is_ignored() {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "cls1".into());
        let stale_gen = app.request_gen;
        // Navigate away (bumps gen) before the submit result lands.
        app.enter_course_home(course("A"));

        let resp: ApiResult<types::SubmitClassResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "passed": true, "overallScore": 1.0, "passedSections": 1, "totalSections": 1,
                "sections": []
            }))
            .expect("valid")));
        app.on_class_submitted(stale_gen, resp);

        // The stale result must NOT replace the CourseHome with a class outcome.
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    /// Build a `Class` view whose sections are loaded from `sections` JSON.
    fn class_with_sections(sections: serde_json::Value) -> View {
        let cls: types::ClassDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "cls1", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "courseId": "course1", "submitted": false, "sections": sections
        }))
        .expect("valid class");
        let built = state::class_sections(&cls).expect("well-formed sections");
        View::Class {
            course: course("A"),
            class_id: "cls1".into(),
            sections: Some(built),
            cursor: 0,
            submitting: false,
        }
    }

    #[tokio::test]
    async fn second_submit_enter_while_submitting_does_not_dispatch_twice() {
        // A single one-question grammar section: answering it submits the class.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-g", "skill": "GRAMMAR", "status": "READY", "episode": null,
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        let before = app.request_gen;
        app.on_select(); // answers the only question -> submits the class
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1, "first submit dispatches once");
        assert!(
            matches!(
                app.view,
                View::Class {
                    submitting: true,
                    ..
                }
            ),
            "submit marked in flight"
        );

        app.on_select(); // key-mash while submitting: must be ignored
        assert_eq!(
            app.request_gen, after_first,
            "a second Enter while submitting must not dispatch again"
        );
    }

    #[tokio::test]
    async fn writing_failure_can_be_retried() {
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-w", "skill": "WRITING", "status": "READY", "episode": null,
              "questions": [], "prompts": [],
              "writingPrompts": [{ "id": "w0", "order": 0, "task": "Write", "guidance": null, "response": null }] }
        ]));

        // Type something and submit.
        for c in "hola".chars() {
            app.on_writing_input(c);
        }
        app.on_writing_submit();
        assert!(
            matches!(
                app.current_section().map(|s| &s.progress),
                Some(SectionProgress::Writing {
                    phase: WritingPhase::Submitting,
                    ..
                })
            ),
            "submit marks the writing in flight"
        );

        // Grading fails.
        let req_gen = app.request_gen;
        let err: ApiResult<crate::api::WritingGradeResponse> = Arc::new(Err("grader down".into()));
        app.on_class_writing_graded(req_gen, err);
        assert!(app.in_writing_failed(), "failure -> Failed phase");

        // The preserved text can be resubmitted from Failed (the retry path).
        let before = app.request_gen;
        app.on_writing_submit();
        assert_eq!(
            app.request_gen,
            before + 1,
            "retry re-dispatches the submit"
        );
        assert!(
            matches!(
                app.current_section().map(|s| &s.progress),
                Some(SectionProgress::Writing {
                    phase: WritingPhase::Submitting,
                    ..
                })
            ),
            "retry returns to Submitting"
        );
    }

    #[tokio::test]
    async fn multi_prompt_writing_keeps_each_grade_visible_until_explicit_advance() {
        // A WRITING section with two prompts. After grading the first, its score +
        // feedback must stay visible (phase Graded, index still 0) until the
        // learner presses enter to advance — it must NOT auto-advance to a fresh
        // editor for the second prompt and silently discard the first feedback.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-w", "skill": "WRITING", "status": "READY", "episode": null,
              "questions": [], "prompts": [],
              "writingPrompts": [
                { "id": "w0", "order": 0, "task": "Write one", "guidance": null, "response": null },
                { "id": "w1", "order": 1, "task": "Write two", "guidance": null, "response": null }
              ] }
        ]));

        // Compose + submit the first prompt.
        for c in "first answer".chars() {
            app.on_writing_input(c);
        }
        app.on_writing_submit();
        let req_gen = app.request_gen;

        // The first prompt grades.
        let graded: ApiResult<crate::api::WritingGradeResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "overallScore": 0.8, "feedback": "Good use of past tense."
            }))
            .expect("valid grade")));
        app.on_class_writing_graded(req_gen, graded);

        // The grade is visible and we are STILL on the first prompt (index 0).
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Writing { phase, index, .. }) => {
                assert_eq!(*index, 0, "must not auto-advance past the first prompt");
                match phase {
                    WritingPhase::Graded { score, feedback } => {
                        assert_eq!(*score, 80);
                        assert_eq!(feedback, "Good use of past tense.");
                    }
                    other => panic!("expected the first prompt's Graded feedback, got {other:?}"),
                }
            }
            other => panic!("expected a Writing section, got {other:?}"),
        }

        // Explicit advance (enter) -> fresh editor for the SECOND prompt.
        app.on_select();
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Writing {
                phase,
                index,
                input,
                ..
            }) => {
                assert_eq!(*index, 1, "enter advances to the second prompt");
                assert_eq!(
                    *phase,
                    WritingPhase::Editing,
                    "second prompt opens a fresh editor"
                );
                assert!(input.is_empty(), "the second prompt's editor starts empty");
            }
            other => panic!("expected the second Writing prompt, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stale_episode_for_a_previous_section_is_ignored() {
        // Section 0 listening, section 1 listening: advancing bumps the gen, so a
        // late episode load for section 0 must not attach to section 1.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l0", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep0", "audioUrl": null, "title": "First", "references": [] },
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] },
            { "id": "sec-l1", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep1", "audioUrl": null, "title": "Second", "references": [] },
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q1", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));
        // Capture section 0's in-flight generation, then answer to advance to
        // section 1 (which bumps the generation).
        let stale_gen = app.request_gen;
        app.on_select(); // answers q0 (last in section 0) -> advance to section 1

        // A late episode load for section 0, tagged with the stale generation.
        let ep0: ApiResult<types::EpisodeDetailResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "id": "ep0", "title": "First", "status": "READY", "audioUrl": null,
                "duration": null, "language": "es", "segments": []
            }))
            .expect("valid episode")));
        app.on_class_episode_loaded(stale_gen, ep0);

        // Section 1 is current; its episode must remain unloaded (the stale ep0
        // result was dropped, not attached to section 1).
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening { episode, .. }) => {
                assert!(
                    episode.is_none(),
                    "stale episode for section 0 must not attach to section 1"
                );
            }
            other => panic!("expected listening section 1, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn no_mc_transcript_only_class_advances_instead_of_stalling() {
        // A class with a single transcript-only listening section (no MC
        // questions). Completing it must advance via next-class, not stall on
        // View::Class. The submit route rejects empty answers (.min(1)), so this
        // class cannot be submitted; the no-MC path re-resolves via next-class.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep0", "audioUrl": null, "title": "Listen", "references": [] },
              "prompts": [], "writingPrompts": [], "questions": [] }
        ]));

        let before = app.request_gen;
        // Enter on the transcript-only section -> it is the last section -> the
        // no-MC completion path dispatches next-class.
        app.on_select();

        // It must NOT stall on View::Class; the next-class dispatch shows Loading
        // and bumps the generation.
        assert!(
            matches!(app.view, View::Loading),
            "no-MC class must advance (Loading after next-class dispatch), not stall on Class"
        );
        assert_eq!(
            app.request_gen,
            before + 1,
            "next-class dispatch bumps the gen"
        );

        // The next-class result drives the outcome (here the stub reports done).
        let req_gen = app.request_gen;
        app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Done));
        assert!(
            matches!(app.view, View::ClassDone { .. }),
            "no-MC completion resolves to an advance/outcome screen"
        );
    }

    #[tokio::test]
    async fn no_mc_speaking_only_class_advances_after_last_prompt() {
        // A speaking-only class: after the last prompt is graded, Enter advances
        // past the final section into the no-MC completion path (next-class).
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-s", "skill": "SPEAKING", "status": "READY", "episode": null,
              "questions": [], "writingPrompts": [],
              "prompts": [{ "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "ipa": null, "referenceTtsUrl": null }] }
        ]));
        // Mark the single prompt graded so Enter advances the section.
        if let Some(section) = app.current_section_mut()
            && let state::SectionProgress::Speaking { phase, .. } = &mut section.progress
        {
            *phase = state::SpeakingPhase::Graded {
                score: Some(90),
                transcript: None,
                feedback: None,
            };
        }

        let before = app.request_gen;
        app.on_select(); // last graded prompt -> advance past last section -> next-class

        assert!(
            matches!(app.view, View::Loading),
            "speaking-only class must advance, not stall"
        );
        assert_eq!(
            app.request_gen,
            before + 1,
            "advance dispatches next-class once"
        );
    }

    // --- P6c: exams (hermetic, StubApi) -----------------------------------

    fn exam_detail(json: serde_json::Value) -> ApiResult<types::ExamDetailResponse> {
        Arc::new(Ok(serde_json::from_value(json).expect("valid exam JSON")))
    }

    /// Build an `Exam` view whose sections are loaded from `sections` JSON.
    fn exam_with_sections(sections: serde_json::Value) -> View {
        let exam: types::ExamDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "result": null,
            "sections": sections
        }))
        .expect("valid exam");
        let built = state::exam_sections(&exam).expect("well-formed sections");
        View::Exam {
            course: course("A"),
            exam_id: Some("exam1".into()),
            sections: Some(built),
            cursor: 0,
            submitting: false,
        }
    }

    #[tokio::test]
    async fn exam_start_enters_the_exam_and_loads_sections() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_start_exam();

        // Entered the Exam view (id/sections load next).
        assert!(
            matches!(
                app.view,
                View::Exam {
                    exam_id: None,
                    sections: None,
                    ..
                }
            ),
            "on_start_exam enters the Exam view"
        );

        // The start response mints an id and triggers the exam load.
        let started_gen = app.request_gen;
        let resp: ApiResult<types::StartExamResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({ "examId": "exam1" }),
        )
        .expect("valid")));
        app.on_exam_started(started_gen, resp);
        match &app.view {
            View::Exam {
                exam_id, sections, ..
            } => {
                assert_eq!(exam_id.as_deref(), Some("exam1"));
                assert!(sections.is_none(), "sections load separately");
            }
            other => panic!("expected Exam, got {other:?}"),
        }

        // The exam detail lands; sections populate, in order.
        let load_gen = app.request_gen;
        app.on_exam_loaded(
            load_gen,
            exam_detail(serde_json::json!({
                "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
                "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "result": null,
                "sections": [
                    { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
                      "episode": null, "speakingPrompts": [], "writingPrompts": [],
                      "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
                ]
            })),
        );
        match &app.view {
            View::Exam {
                sections: Some(sections),
                ..
            } => assert_eq!(sections.len(), 1),
            other => panic!("expected loaded Exam, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn answering_the_last_exam_question_submits_and_shows_the_band() {
        let mut app = test_app();
        app.view = exam_with_sections(serde_json::json!([
            { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
              "episode": null, "speakingPrompts": [], "writingPrompts": [],
              "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        let before = app.request_gen;
        app.on_select(); // answers the only question -> submits the exam
        let after = app.request_gen;
        assert_eq!(after, before + 1, "submit dispatches once");
        assert!(matches!(
            app.view,
            View::Exam {
                submitting: true,
                ..
            }
        ));

        // The score result lands -> band/score outcome.
        let resp: ApiResult<types::SubmitExamResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({
                "overallScore": 0.9, "band": "C1", "feedback": "Strong.",
                "sections": [{ "sectionId": "ex-g", "skill": "GRAMMAR", "weight": 1.0, "score": 0.9 }]
            }),
        )
        .expect("valid")));
        app.on_exam_submitted(after, resp);
        match &app.view {
            View::ExamOutcome { result, .. } => {
                assert_eq!(result.band, "C1");
                assert_eq!(result.overall_score, 90);
                assert_eq!(result.sections.len(), 1);
            }
            other => panic!("expected ExamOutcome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn second_exam_submit_enter_while_submitting_does_not_dispatch_twice() {
        let mut app = test_app();
        app.view = exam_with_sections(serde_json::json!([
            { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
              "episode": null, "speakingPrompts": [], "writingPrompts": [],
              "questions": [{ "id": "g0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        let before = app.request_gen;
        app.on_select(); // answers -> submits
        let after_first = app.request_gen;
        assert_eq!(after_first, before + 1);
        assert!(matches!(
            app.view,
            View::Exam {
                submitting: true,
                ..
            }
        ));

        app.on_select(); // key-mash while submitting: ignored
        assert_eq!(
            app.request_gen, after_first,
            "a second Enter while submitting must not dispatch again"
        );
    }

    #[tokio::test]
    async fn stale_exam_result_for_a_previous_exam_is_ignored() {
        let mut app = test_app();
        app.view = View::exam_view(course("A"));
        if let View::Exam { exam_id, .. } = &mut app.view {
            *exam_id = Some("exam1".into());
        }
        let stale_gen = app.request_gen;
        // Navigate away (bumps gen) before the submit result lands.
        app.enter_course_home(course("A"));

        let resp: ApiResult<types::SubmitExamResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "overallScore": 1.0, "band": "C2", "feedback": "x", "sections": []
            }))
            .expect("valid")));
        app.on_exam_submitted(stale_gen, resp);

        // The stale result must NOT replace the CourseHome with an exam outcome.
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    #[tokio::test]
    async fn malformed_exam_backs_out_to_course_home() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.view = View::exam_view(course("A"));
        let req_gen = app.request_gen;

        // Empty sections -> malformed -> back to CourseHome.
        app.on_exam_loaded(
            req_gen,
            exam_detail(serde_json::json!({
                "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
                "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "result": null,
                "sections": []
            })),
        );
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    // --- P6d: placement / memory / settings (hermetic, StubApi) -----------

    fn placement_loaded(json: serde_json::Value) -> ApiResult<types::GeneratePlacementResponse> {
        Arc::new(Ok(
            serde_json::from_value(json).expect("valid placement JSON")
        ))
    }

    #[tokio::test]
    async fn empty_courses_n_opens_the_placement_picker() {
        let mut app = test_app();
        app.view = View::courses(&[]); // no courses
        app.on_start_placement();
        assert!(
            matches!(app.view, View::PlacementLang { .. }),
            "the empty-courses state must lead into placement"
        );
    }

    #[tokio::test]
    async fn placement_run_creates_a_course_and_lands_in_it() {
        let mut app = test_app();
        app.on_start_placement();
        // Native English (cursor 0), target Spanish (cursor 1) by default.
        app.placement_lang_confirm();
        assert!(
            matches!(app.view, View::PlacementLang { loading: true, .. }),
            "confirm marks the question fetch in flight"
        );

        // Questions arrive -> placement review.
        let load_gen = app.request_gen;
        app.on_placement_loaded(
            load_gen,
            placement_loaded(serde_json::json!({
                "native": "en", "target": "es",
                "questions": [
                    { "id": "pq_0", "cefr": "A1", "skill": "grammar", "prompt": "?", "options": ["a","b"] }
                ]
            })),
        );
        assert!(matches!(app.view, View::PlacementReview { .. }));

        // Answer the only question -> submits placement.
        let before = app.request_gen;
        app.on_select();
        let after = app.request_gen;
        assert_eq!(
            after,
            before + 1,
            "answering the last question submits once"
        );
        assert!(matches!(
            app.view,
            View::PlacementReview {
                submitting: true,
                ..
            }
        ));

        // The assessed result lands.
        let resp: ApiResult<types::SubmitPlacementResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-new", "level": "B1", "scoreBySkill": { "grammar": 0.7 }
            }))
            .expect("valid")));
        app.on_placement_submitted(after, resp);
        match &app.view {
            View::PlacementResult { outcome } => {
                assert_eq!(outcome.course_id, "course-new");
                assert_eq!(outcome.level, "B1");
                // The submitted languages are carried onto the outcome.
                assert_eq!(outcome.native, "en");
                assert_eq!(outcome.target, "es");
            }
            other => panic!("expected PlacementResult, got {other:?}"),
        }

        // Continue -> land in the created course's home, with REAL language
        // metadata + a readable title (not blank "Your course").
        app.placement_result_continue();
        match &app.view {
            View::CourseHome { course, .. } => {
                assert_eq!(course.id, "course-new");
                assert_eq!(course.native_lang, "en");
                assert_eq!(course.target_lang, "es");
                assert_eq!(course.current_level, "B1");
                assert_eq!(course.title, "English → Spanish");
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn placement_picker_rejects_identical_languages() {
        let mut app = test_app();
        app.on_start_placement();
        // Make both columns point at the same language.
        if let View::PlacementLang {
            native_cursor,
            target_cursor,
            ..
        } = &mut app.view
        {
            *native_cursor = 0;
            *target_cursor = 0;
        }
        let before = app.request_gen;
        app.placement_lang_confirm();
        assert_eq!(
            app.request_gen, before,
            "identical languages must not dispatch a placement fetch"
        );
        assert!(matches!(
            app.view,
            View::PlacementLang { loading: false, .. }
        ));
    }

    #[tokio::test]
    async fn stale_placement_result_for_a_previous_run_is_ignored() {
        let mut app = test_app();
        app.view = View::placement_review(
            "en".into(),
            "es".into(),
            vec![state::PlacementQuestion {
                id: "pq_0".into(),
                prompt: "?".into(),
                options: vec!["a".into(), "b".into()],
            }],
        );
        let stale_gen = app.request_gen;
        // Navigate away (bumps gen) before the submit result lands.
        app.enter_course_home(course("A"));

        let resp: ApiResult<types::SubmitPlacementResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({ "courseId": "c", "level": "C2", "scoreBySkill": {} }),
        )
        .expect("valid")));
        app.on_placement_submitted(stale_gen, resp);

        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    #[tokio::test]
    async fn memory_opens_and_renders_the_graph() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_open_memory();
        assert!(matches!(app.view, View::Memory { items: None, .. }));

        let req_gen = app.request_gen;
        let graph: ApiResult<types::MemoryGraphResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({
                "nodes": [
                    { "id": "v0", "kind": "vocab", "label": "casa", "translation": "house", "strength": 0.6, "due": true }
                ],
                "edges": []
            }),
        )
        .expect("valid")));
        app.on_graph_loaded(req_gen, graph);
        match &app.view {
            View::Memory {
                items: Some(items), ..
            } => {
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].label, "casa");
                assert_eq!(items[0].mastery, 60);
                assert!(items[0].due);
            }
            other => panic!("expected loaded Memory, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn settings_opens_and_renders_config() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_open_settings();
        assert!(matches!(app.view, View::Settings { config: None }));

        let req_gen = app.request_gen;
        let config: ApiResult<types::OnboardingConfigResponse> =
            Arc::new(Ok(serde_json::from_value(serde_json::json!({
                "selfHosted": true, "isOwner": false, "infra": null
            }))
            .expect("valid")));
        app.on_config_loaded(req_gen, config);
        match &app.view {
            View::Settings { config: Some(c) } => {
                assert!(c.self_hosted);
                assert!(!c.is_owner);
                assert!(c.infra.is_none());
            }
            other => panic!("expected loaded Settings, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn stale_graph_result_for_a_previous_course_is_ignored() {
        let mut app = test_app();
        app.enter_course_home(course("A"));
        app.on_open_memory();
        let stale_gen = app.request_gen;
        app.enter_course_home(course("B")); // navigate away (bumps gen)

        let graph: ApiResult<types::MemoryGraphResponse> = Arc::new(Ok(serde_json::from_value(
            serde_json::json!({ "nodes": [{ "id": "x", "kind": "vocab", "label": "stale", "strength": 1.0, "due": false }], "edges": [] }),
        )
        .expect("valid")));
        app.on_graph_loaded(stale_gen, graph);

        // The stale graph must not render onto course B's home.
        assert!(matches!(app.view, View::CourseHome { .. }));
    }

    // --- P6e: adaptive-listening Q&A ---------------------------------------

    /// A standalone listening session with one comprehension item, ready to ask.
    fn listening_app() -> App {
        let mut app = test_app();
        app.view = View::start_listening(
            course("L"),
            "sess-listen".into(),
            "ep-42".into(),
            vec![state::VocabItem {
                id: "v1".into(),
                prompt: "casa".into(),
                options: vec!["house".into(), "dog".into()],
            }],
        );
        app
    }

    fn interaction(json: serde_json::Value) -> ApiResult<types::InteractionResponse> {
        Arc::new(Ok(
            serde_json::from_value(json).expect("valid InteractionResponse JSON")
        ))
    }

    /// Open the overlay and type a question, character by character (the same
    /// path real key events take).
    fn type_question(app: &mut App, q: &str) {
        app.on_toggle_ask();
        for c in q.chars() {
            if c == '\n' {
                app.ask_input_newline();
            } else {
                app.ask_input_char(c);
            }
        }
    }

    fn current_ask_phase(app: &App) -> state::AskPhase {
        match &app.view {
            View::ListeningReview { ask, .. } => ask.phase.clone(),
            other => panic!("expected ListeningReview, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ask_overlay_captures_the_typed_question() {
        let mut app = listening_app();
        assert!(!app.ask_overlay_open(), "overlay starts closed");

        type_question(&mut app, "what does casa mean?");
        assert!(app.ask_overlay_open(), "`a` opens the overlay");
        match &app.view {
            View::ListeningReview { ask, .. } => {
                assert!(ask.open);
                assert_eq!(ask.input.text(), "what does casa mean?");
                assert_eq!(ask.phase, state::AskPhase::Editing);
            }
            other => panic!("expected ListeningReview, got {other:?}"),
        }

        // Toggling again closes it and discards the draft.
        app.on_toggle_ask();
        assert!(!app.ask_overlay_open());
    }

    #[tokio::test]
    async fn ask_pending_then_answered_shows_the_answer_text() {
        let mut app = listening_app();
        type_question(&mut app, "what does casa mean?");

        // Submit -> dispatch (gen bumps), phase goes Asking.
        let ask_gen = {
            let before = app.request_gen;
            app.on_ask_submit();
            assert_eq!(app.request_gen, before + 1, "asking dispatches once");
            app.request_gen
        };
        assert_eq!(current_ask_phase(&app), state::AskPhase::Asking);

        // The POST returns a PENDING interaction -> we start polling it.
        app.on_interaction_asked(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-7", "question": "what does casa mean?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        assert_eq!(
            current_ask_phase(&app),
            state::AskPhase::Polling {
                interaction_id: "int-7".into()
            }
        );

        // A poll still PENDING keeps polling and burns a budget tick.
        let polls_before = match &app.view {
            View::ListeningReview { ask, .. } => ask.polls_left,
            _ => unreachable!(),
        };
        app.on_interaction_polled(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-7", "question": "?", "timestamp": 0,
                "status": "ANSWERING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        match &app.view {
            View::ListeningReview { ask, .. } => {
                assert!(matches!(ask.phase, state::AskPhase::Polling { .. }));
                assert_eq!(
                    ask.polls_left,
                    polls_before - 1,
                    "a non-terminal poll ticks"
                );
            }
            _ => unreachable!(),
        }

        // The answer lands -> Answered with the text (route is text-only).
        app.on_interaction_polled(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-7", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "It means house.", "helpful": true, "segmentOrder": 1
            })),
        );
        match current_ask_phase(&app) {
            state::AskPhase::Answered {
                answer,
                answer_audio,
            } => {
                assert_eq!(answer, "It means house.");
                assert!(
                    answer_audio.is_none(),
                    "the interact route returns no audio"
                );
            }
            other => panic!("expected Answered, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ask_failure_is_retryable() {
        let mut app = listening_app();
        type_question(&mut app, "?");
        app.on_ask_submit();
        let ask_gen = app.request_gen;

        // The POST itself fails.
        app.on_interaction_asked(ask_gen, Arc::new(Err("network down".into())));
        match current_ask_phase(&app) {
            state::AskPhase::Failed { message } => assert!(message.contains("network down")),
            other => panic!("expected Failed, got {other:?}"),
        }
        assert!(app.ask_failed(), "a failed ask is flagged for retry");

        // Re-submitting from Failed preserves the question and dispatches again.
        let before = app.request_gen;
        app.on_ask_submit();
        assert_eq!(app.request_gen, before + 1, "retry re-asks");
        assert_eq!(current_ask_phase(&app), state::AskPhase::Asking);
    }

    #[tokio::test]
    async fn second_ask_while_in_flight_does_not_dispatch_twice() {
        let mut app = listening_app();
        type_question(&mut app, "?");
        app.on_ask_submit();
        let gen_after_first = app.request_gen;
        assert_eq!(current_ask_phase(&app), state::AskPhase::Asking);

        // A second submit while still Asking/Polling is ignored.
        app.on_ask_submit();
        assert_eq!(
            app.request_gen, gen_after_first,
            "an in-flight ask must not dispatch a second request"
        );
    }

    #[tokio::test]
    async fn stale_answer_for_a_superseded_ask_is_dropped() {
        let mut app = listening_app();
        type_question(&mut app, "first question?");
        app.on_ask_submit();
        let stale_gen = app.request_gen;
        app.on_interaction_asked(
            stale_gen,
            interaction(serde_json::json!({
                "id": "int-A", "question": "first question?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );

        // The learner navigates away (bumps the generation) before the answer
        // for the first question lands.
        app.enter_course_home(course("Z"));

        // The late answer, tagged with the stale generation, must be dropped.
        app.on_interaction_polled(
            stale_gen,
            interaction(serde_json::json!({
                "id": "int-A", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "stale answer", "helpful": true, "segmentOrder": 1
            })),
        );
        assert!(
            matches!(app.view, View::CourseHome { .. }),
            "a stale answer must not resurrect the ask overlay"
        );
    }

    #[tokio::test]
    async fn cancelling_the_ask_overlay_drops_in_flight_results_and_stops_polling() {
        let mut app = listening_app();
        type_question(&mut app, "what does casa mean?");
        app.on_ask_submit(); // -> Asking, dispatched under `asked_gen`
        let asked_gen = app.request_gen;

        // The learner presses Esc / `a` to close the overlay while the ask is in
        // flight. Cancel must invalidate the in-flight generation.
        app.on_toggle_ask();
        assert!(!app.ask_overlay_open(), "overlay is closed by cancel");
        assert!(
            app.request_gen > asked_gen,
            "cancel bumps the generation to invalidate in-flight work"
        );
        let gen_after_cancel = app.request_gen;

        // A late InteractionAsked for the cancelled ask (old gen) must be dropped:
        // no phase change, no reschedule (no further gen bump).
        app.on_interaction_asked(
            asked_gen,
            interaction(serde_json::json!({
                "id": "int-X", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        // And a late InteractionPolled (old gen) is likewise dropped.
        app.on_interaction_polled(
            asked_gen,
            interaction(serde_json::json!({
                "id": "int-X", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "late answer", "helpful": true, "segmentOrder": 1
            })),
        );

        // The overlay stayed closed (Editing/closed), never showed an answer or
        // error, and nothing re-bumped the generation (no poll was scheduled).
        match &app.view {
            View::ListeningReview { ask, .. } => {
                assert!(!ask.open, "the cancelled overlay must stay closed");
                assert_eq!(
                    ask.phase,
                    state::AskPhase::Editing,
                    "a dropped result must not move the phase to Answered/Failed",
                );
            }
            other => panic!("expected ListeningReview, got {other:?}"),
        }
        assert_eq!(
            app.request_gen, gen_after_cancel,
            "a dropped result must not reschedule a poll (no further gen bump)",
        );
    }

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    /// Apply whatever `map_key` produced, restricted to the actions that could
    /// possibly mutate the underlying listening/class flow. The overlay is modal,
    /// so this must collapse to a no-op (ToggleAsk/None) for non-overlay keys.
    fn apply_mapped(app: &mut App, action: Option<Action>) {
        match action {
            Some(Action::Select) => app.on_select(),
            Some(Action::Choose(n)) => app.on_choose(n),
            Some(Action::Up) => app.on_up(),
            Some(Action::Down) => app.on_down(),
            // ToggleAsk / Input* / None and friends do not touch the underlying
            // listening state; nothing to apply for this assertion.
            _ => {}
        }
    }

    #[tokio::test]
    async fn modal_ask_overlay_swallows_keys_in_standalone_listening() {
        let mut app = listening_app();
        type_question(&mut app, "what does casa mean?");
        app.on_ask_submit();
        // Drive to the ANSWERED (terminal, non-editing) phase.
        let ask_gen = app.request_gen;
        app.on_interaction_asked(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-9", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        app.on_interaction_polled(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-9", "question": "?", "timestamp": 0,
                "status": "ANSWERED", "answer": "It means house.", "helpful": true, "segmentOrder": 1
            })),
        );
        assert!(matches!(
            current_ask_phase(&app),
            state::AskPhase::Answered { .. }
        ));

        let gen_before = app.request_gen;
        // Enter and number keys would normally answer the hidden comprehension
        // item; while the overlay is open they must not reach the keymap.
        for code in [KeyCode::Enter, KeyCode::Char('1'), KeyCode::Char('2')] {
            let mapped = app.map_key(key(code));
            assert!(
                !matches!(mapped, Some(Action::Select) | Some(Action::Choose(_))),
                "{code:?} must not answer a hidden item while the overlay is open",
            );
            apply_mapped(&mut app, mapped);
        }

        match &app.view {
            View::ListeningReview { selected, .. } => assert!(
                selected.iter().all(Option::is_none),
                "no comprehension item may be answered behind the overlay",
            ),
            other => panic!("expected ListeningReview, got {other:?}"),
        }
        assert_eq!(
            app.request_gen, gen_before,
            "swallowed keys must not dispatch any underlying flow",
        );
    }

    #[tokio::test]
    async fn modal_ask_overlay_swallows_keys_in_class_listening() {
        // A single-question listening section: answering it would advance/submit.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "epL", "audioUrl": null, "title": "L", "references": [] },
              "prompts": [], "writingPrompts": [],
              "questions": [{ "id": "q0", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
        ]));

        // Open the overlay over the listening section and put it in flight (Polling).
        app.on_toggle_ask();
        for c in "explain?".chars() {
            app.ask_input_char(c);
        }
        app.on_ask_submit();
        let ask_gen = app.request_gen;
        app.on_interaction_asked(
            ask_gen,
            interaction(serde_json::json!({
                "id": "int-c", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            })),
        );
        assert!(matches!(
            current_ask_phase_section(&app),
            state::AskPhase::Polling { .. }
        ));

        let gen_before = app.request_gen;
        let cursor_before = match &app.view {
            View::Class { cursor, .. } => *cursor,
            other => panic!("expected Class, got {other:?}"),
        };

        // Enter / number would answer q0 and advance + submit the class. Modal.
        for code in [KeyCode::Enter, KeyCode::Char('1')] {
            let mapped = app.map_key(key(code));
            assert!(
                !matches!(mapped, Some(Action::Select) | Some(Action::Choose(_))),
                "{code:?} must not advance the class behind the overlay",
            );
            apply_mapped(&mut app, mapped);
        }

        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening { selected, .. }) => assert!(
                selected.iter().all(Option::is_none),
                "no listening question may be answered behind the overlay",
            ),
            other => panic!("expected a current Listening section, got {other:?}"),
        }
        match &app.view {
            View::Class { cursor, .. } => assert_eq!(
                *cursor, cursor_before,
                "the section must not advance behind the overlay",
            ),
            other => panic!("expected Class, got {other:?}"),
        }
        assert_eq!(
            app.request_gen, gen_before,
            "swallowed keys must not dispatch the class flow",
        );
    }

    /// The ask phase of the current in-class/in-exam listening section.
    fn current_ask_phase_section(app: &App) -> state::AskPhase {
        match app.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening { ask, .. }) => ask.phase.clone(),
            _ => panic!("expected a current Listening section with an ask state"),
        }
    }

    // --- P7: theme picker, help overlay, responsive ------------------------

    use crate::theme::{LightPalette, Mode};

    #[test]
    fn t_opens_the_theme_picker_and_t_closes_it() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        assert!(!app.theme_picker.open);

        assert!(matches!(
            app.map_key(key(KeyCode::Char('t'))),
            Some(Action::ToggleThemePicker)
        ));
        app.on_toggle_theme_picker();
        assert!(app.theme_picker.open);

        app.on_toggle_theme_picker();
        assert!(!app.theme_picker.open);
    }

    #[test]
    fn picker_cycles_each_row_and_applies_live() {
        let mut app = test_app();
        app.on_toggle_theme_picker();
        // Row 0 = Mode. Cycling flips light -> dark on the live theme.
        assert_eq!(app.theme.mode, Mode::Light);
        app.on_cycle_theme_value();
        assert_eq!(app.theme.mode, Mode::Dark, "mode applies live");

        // Move to the light-palette row and cycle.
        app.on_down();
        assert_eq!(app.theme.light_palette, LightPalette::AulaCool);
        app.on_cycle_theme_value();
        assert_eq!(app.theme.light_palette, LightPalette::PaperWarm);

        // Move to the accent row and cycle to the next swatch.
        app.on_down();
        let before = app.theme.accent;
        app.on_cycle_theme_value();
        assert_ne!(app.theme.accent, before, "accent cycles to a new swatch");
    }

    #[test]
    fn closing_the_picker_persists_the_choice_to_config() {
        let mut app = test_app();
        app.on_toggle_theme_picker();
        app.on_cycle_theme_value(); // mode -> dark
        // The persisted config still reflects the default until the picker closes.
        assert_eq!(app.config.theme, crate::config::ThemeChoice::default());

        app.on_toggle_theme_picker(); // close -> persist
        assert_eq!(app.config.theme.mode, "dark");
        // The in-memory theme and the persisted choice now agree.
        assert_eq!(app.config.theme, app.theme.to_choice());
    }

    #[test]
    fn picker_is_modal_and_swallows_screen_keys() {
        // Open the picker over Courses; a number/enter must NOT select a course.
        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0"), course_summary("c1")]);
        app.on_toggle_theme_picker();

        // Enter is the picker's "cycle value", never a course selection.
        assert!(matches!(
            app.map_key(key(KeyCode::Enter)),
            Some(Action::CycleThemeValue)
        ));
        // A number key is swallowed entirely (no Choose leaks to the list).
        assert!(app.map_key(key(KeyCode::Char('2'))).is_none());
        // `a` (would open ask on a listening screen) is also swallowed.
        assert!(app.map_key(key(KeyCode::Char('a'))).is_none());

        // We are still on Courses; nothing navigated.
        assert!(matches!(app.view, View::Courses { .. }));
    }

    #[test]
    fn help_overlay_opens_modal_and_dismisses() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        assert!(matches!(
            app.map_key(key(KeyCode::Char('?'))),
            Some(Action::ToggleHelp)
        ));
        app.on_toggle_help();
        assert!(app.help_open);

        // While open it is modal: arbitrary keys are swallowed, only `?`/Esc act.
        assert!(app.map_key(key(KeyCode::Char('x'))).is_none());
        assert!(app.map_key(key(KeyCode::Enter)).is_none());
        assert!(matches!(
            app.map_key(key(KeyCode::Esc)),
            Some(Action::ToggleHelp)
        ));
        app.on_toggle_help();
        assert!(!app.help_open);
    }

    #[test]
    fn opening_one_overlay_closes_the_other() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        app.on_toggle_help();
        assert!(app.help_open);
        // Opening the picker dismisses help (one modal at a time).
        app.on_toggle_theme_picker();
        assert!(app.theme_picker.open && !app.help_open);
        // Opening help again dismisses the picker.
        app.on_toggle_help();
        assert!(app.help_open && !app.theme_picker.open);
    }

    #[test]
    fn help_does_not_open_while_typing_a_question() {
        // In ask-editing mode, `?` and `t` are literal characters, not openers.
        let mut app = listening_app();
        app.on_toggle_ask(); // -> Editing
        assert!(matches!(
            app.map_key(key(KeyCode::Char('?'))),
            Some(Action::Input('?'))
        ));
        assert!(matches!(
            app.map_key(key(KeyCode::Char('t'))),
            Some(Action::Input('t'))
        ));
    }

    /// Parse the leading concrete key out of a help-display token into the
    /// `KeyEvent` the keymap would receive. Multi-key tokens ("↑/↓ j/k",
    /// "1-9 / enter") probe their first concrete key — enough to catch a listed
    /// key that the keymap no longer produces an action for. Returns `None` for
    /// global tokens (`?`, `t`, `q / esc`, `Ctrl-C`), which are tested separately.
    fn probe_key_for(token: &str) -> Option<KeyEvent> {
        // Globals are validated on their own; skip here.
        if matches!(token, "?" | "t" | "q / esc" | "Ctrl-C") {
            return None;
        }
        if token.starts_with("↑/↓") {
            return Some(key(KeyCode::Up));
        }
        if token.starts_with("1-9") {
            return Some(key(KeyCode::Char('1')));
        }
        if token.starts_with("PgUp") {
            return Some(key(KeyCode::PageUp));
        }
        Some(match token {
            "enter" => key(KeyCode::Enter),
            "space" => key(KeyCode::Char(' ')),
            "tab" => key(KeyCode::Tab),
            "Ctrl-D" => KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL),
            // Single-letter shortcuts: a, c, e, m, n, r, s.
            s if s.chars().count() == 1 => key(KeyCode::Char(s.chars().next().unwrap())),
            other => panic!("unhandled help token {other:?} — add it to probe_key_for"),
        })
    }

    /// True when `action` is a real keyboard SHORTCUT, not raw text capture. A
    /// writing/ask editor turns every `Char(c)` into `Input(c)`, so text-capture
    /// must NOT count as a help key being "live" — otherwise any single letter
    /// would falsely look like a valid shortcut on an editing screen.
    fn is_shortcut_action(action: &Action) -> bool {
        !matches!(
            action,
            Action::Input(_) | Action::InputNewline | Action::InputBackspace
        )
    }

    /// Probe `key` against `app` and return true iff it yields a real shortcut
    /// action (not text capture, not a dead key).
    fn maps_to_shortcut(app: &App, k: KeyEvent) -> bool {
        app.map_key(k).as_ref().is_some_and(is_shortcut_action)
    }

    /// Assert every key listed in `help_rows(app.view)` actually produces a
    /// shortcut action via `map_key` for that view (so the help can't list a
    /// dead key). Used for single-mode screens, where every listed key is live
    /// on the view itself.
    fn assert_help_keys_live(app: &App) {
        for (token, _desc) in overlay::help_rows(&app.view) {
            if let Some(k) = probe_key_for(token) {
                assert!(
                    maps_to_shortcut(app, k),
                    "help lists {token:?} on {:?}, but the keymap produces no shortcut for it",
                    std::mem::discriminant(&app.view),
                );
            }
        }
    }

    /// The five section-type flows a Class/Exam help line can apply to. Each
    /// representative parks the flow on a single section of that skill, so the
    /// section's keys are live there.
    const SECTION_SKILLS: [&str; 4] = ["LISTENING", "SPEAKING", "GRAMMAR", "WRITING"];

    /// Assert every key listed in a Class/Exam's `help_rows` is live on AT LEAST
    /// ONE section type — so no listed key (space/r/↑↓/1-9/a/Ctrl-D) is dead.
    /// `make` builds the flow (class or exam) parked on the given section skill.
    fn assert_section_walk_help_keys_live(make: impl Fn(&str) -> App, label: &str) {
        // Help rows are identical across section skills (keyed on the View
        // discriminant), so read them from any representative.
        let sample = make("LISTENING");
        for (token, _desc) in overlay::help_rows(&sample.view) {
            let Some(k) = probe_key_for(token) else {
                continue; // globals are validated separately
            };
            // A key counts only if SOME section type makes it a real shortcut —
            // text capture on a writing/ask editor does not qualify.
            let live_on_some = SECTION_SKILLS
                .iter()
                .any(|skill| maps_to_shortcut(&make(skill), k));
            assert!(
                live_on_some,
                "{label} help lists {token:?}, but no section type makes it a shortcut",
            );
        }
    }

    /// The help overlay lists the REAL screen keys: every key it shows for a
    /// screen must map to a live action. This keeps the hand-maintained help
    /// source from drifting from `map_key`. Covers EVERY view (single-mode views
    /// directly; Class/Exam via their section-type representatives).
    #[test]
    fn help_rows_match_the_real_keymap_for_each_screen() {
        for view in representative_views() {
            // Help stays concise on every screen.
            let rows = overlay::help_rows(&view);
            assert!(rows.len() <= 8, "help stays concise: {} rows", rows.len());

            // Class/Exam span section types: every listed key must be live on at
            // least one section type (not necessarily the parked one). Single-mode
            // views must have every listed key live on the view itself.
            match &view {
                View::Class { .. } => {
                    assert_section_walk_help_keys_live(class_app_with_section, "Class");
                }
                View::Exam { .. } => {
                    assert_section_walk_help_keys_live(exam_app_with_section, "Exam");
                }
                _ => {
                    let mut app = test_app();
                    app.view = view;
                    assert_help_keys_live(&app);
                }
            }
        }
    }

    /// Spot-check the canonical section-type keys are live on BOTH class and exam
    /// (a direct, readable assertion alongside the exhaustive coverage above).
    #[test]
    fn class_and_exam_section_keys_are_live_on_their_section_type() {
        for make in [
            class_app_with_section as fn(&str) -> App,
            exam_app_with_section as fn(&str) -> App,
        ] {
            // Listening: space (play) + `a` (ask).
            assert!(make("LISTENING").map_key(key(KeyCode::Char(' '))).is_some());
            assert!(make("LISTENING").map_key(key(KeyCode::Char('a'))).is_some());
            // Speaking: `r` (record).
            assert!(make("SPEAKING").map_key(key(KeyCode::Char('r'))).is_some());
            // MC/grammar: ↑/↓ + 1-9.
            assert!(make("GRAMMAR").map_key(key(KeyCode::Up)).is_some());
            assert!(make("GRAMMAR").map_key(key(KeyCode::Char('1'))).is_some());
            // Writing (editing phase): Ctrl-D submits.
            assert!(
                make("WRITING")
                    .map_key(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL))
                    .is_some(),
                "Ctrl-D must submit on a writing section",
            );
        }
    }

    /// Every key listed in `global_rows` maps to a real action on a normal
    /// screen — no global help entry is dead.
    #[test]
    fn every_global_help_key_is_live() {
        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0")]);
        for (token, _desc) in overlay::global_rows() {
            for k in global_probe_keys(token) {
                assert!(
                    app.map_key(k).is_some(),
                    "global help lists {token:?} ({k:?}), but the keymap is silent for it",
                );
            }
        }
    }

    /// Parse a GLOBAL help token into the concrete key events it advertises. The
    /// per-screen [`probe_key_for`] returns `None` for these (they are validated
    /// here): `?`, `t`, `q / esc` (two keys), `Ctrl-C`.
    fn global_probe_keys(token: &str) -> Vec<KeyEvent> {
        match token {
            "?" => vec![key(KeyCode::Char('?'))],
            "t" => vec![key(KeyCode::Char('t'))],
            "A" => vec![key(KeyCode::Char('A'))],
            "q / esc" => vec![key(KeyCode::Char('q')), key(KeyCode::Esc)],
            "Ctrl-C" => vec![KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)],
            other => panic!("unhandled global token {other:?} — add it to global_probe_keys"),
        }
    }

    /// A `Class` parked on a single section of the given skill, with that section
    /// the current one — so the section's keys are live.
    fn class_app_with_section(skill: &str) -> App {
        let mut app = test_app();
        app.view = class_with_sections(section_json(skill));
        app
    }

    /// An `Exam` parked on a single section of the given skill.
    fn exam_app_with_section(skill: &str) -> App {
        let mut app = test_app();
        let exam: types::ExamDetailResponse = serde_json::from_value(serde_json::json!({
            "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "Mock B1", "result": null,
            "sections": exam_section_json(skill)
        }))
        .expect("valid exam");
        let sections = state::exam_sections(&exam).expect("well-formed exam sections");
        app.view = View::Exam {
            course: course("A"),
            exam_id: Some("exam1".into()),
            sections: Some(sections),
            cursor: 0,
            submitting: false,
        };
        app
    }

    /// One CLASS section of the given skill, as the class-route JSON the section
    /// builder parses (speaking uses `prompts`).
    fn section_json(skill: &str) -> serde_json::Value {
        let episode = if skill == "LISTENING" {
            serde_json::json!({ "id": "ep", "audioUrl": null, "title": "L", "references": [] })
        } else {
            serde_json::Value::Null
        };
        let questions = if skill == "GRAMMAR" {
            serde_json::json!([{ "id": "q", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }])
        } else {
            serde_json::json!([])
        };
        let prompts = if skill == "SPEAKING" {
            serde_json::json!([{ "id": "p", "order": 0, "targetPhrase": "hola", "translation": "hi", "ipa": null, "referenceTtsUrl": null }])
        } else {
            serde_json::json!([])
        };
        let writing = if skill == "WRITING" {
            serde_json::json!([{ "id": "w", "order": 0, "task": "Write", "guidance": null, "response": null }])
        } else {
            serde_json::json!([])
        };
        serde_json::json!([
            { "id": "sec", "skill": skill, "status": "READY", "episode": episode,
              "prompts": prompts, "writingPrompts": writing, "questions": questions }
        ])
    }

    /// One EXAM section of the given skill, as the exam-route JSON the exam
    /// section builder parses (speaking uses `speakingPrompts`; extra metadata).
    fn exam_section_json(skill: &str) -> serde_json::Value {
        let episode = if skill == "LISTENING" {
            serde_json::json!({ "id": "ep", "audioUrl": null, "status": "READY" })
        } else {
            serde_json::Value::Null
        };
        let questions = if skill == "GRAMMAR" {
            serde_json::json!([{ "id": "q", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }])
        } else {
            serde_json::json!([])
        };
        let speaking = if skill == "SPEAKING" {
            serde_json::json!([{ "id": "p", "order": 0, "targetPhrase": "hola", "translation": "hi", "referenceTtsUrl": null }])
        } else {
            serde_json::json!([])
        };
        let writing = if skill == "WRITING" {
            serde_json::json!([{ "id": "w", "order": 0, "task": "Write", "guidance": null }])
        } else {
            serde_json::json!([])
        };
        serde_json::json!([
            { "id": "sec", "skill": skill, "part": "P1", "order": 0, "format": "mc",
              "weight": 1.0, "status": "READY", "score": null, "episode": episode,
              "speakingPrompts": speaking, "writingPrompts": writing, "questions": questions }
        ])
    }

    // --- Responsive: tiny-size render smoke --------------------------------

    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    /// Render `app` into a `w`×`h` test backend; returns Ok if no panic.
    fn render_at(app: &mut App, w: u16, h: u16) {
        let backend = TestBackend::new(w, h);
        let mut terminal = Terminal::new(backend).expect("test terminal");
        terminal
            .draw(|frame| {
                let _ = app.draw(frame);
            })
            .expect("draw must not fail");
    }

    #[test]
    fn every_main_screen_renders_at_tiny_sizes_without_panicking() {
        // 40x15 (just above the floor), 40x10 (the floor), and 20x6 (below the
        // floor -> the "too small" notice). None may panic.
        for view in representative_views() {
            let mut app = test_app();
            app.view = view;
            render_at(&mut app, 40, 15);
            render_at(&mut app, 40, 10);
            render_at(&mut app, 20, 6);
            // And with each overlay open, at a tiny size.
            app.theme_picker = overlay::ThemePicker::opened();
            render_at(&mut app, 40, 12);
            app.theme_picker = overlay::ThemePicker::closed();
            app.help_open = true;
            render_at(&mut app, 40, 12);
        }
    }

    #[test]
    fn below_floor_shows_the_too_small_notice_only() {
        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0")]);
        let backend = TestBackend::new(20, 6);
        let mut terminal = Terminal::new(backend).expect("test terminal");
        terminal
            .draw(|frame| {
                let _ = app.draw(frame);
            })
            .expect("draw");
        let buf = terminal.backend().buffer().clone();
        let rendered: String = buf.content().iter().map(|c| c.symbol()).collect();
        assert!(
            rendered.contains("too small") || rendered.contains("small"),
            "below the floor the notice must be shown",
        );
    }

    #[test]
    fn the_active_theme_actually_reaches_the_rendered_buffer() {
        use ratatui::style::Color;

        let bg_of = |app: &mut App| -> Color {
            let backend = TestBackend::new(60, 20);
            let mut terminal = Terminal::new(backend).expect("test terminal");
            terminal
                .draw(|frame| {
                    let _ = app.draw(frame);
                })
                .expect("draw");
            // The top-left cell's background is the themed window background.
            terminal.backend().buffer()[(0, 0)].bg
        };

        let mut app = test_app();
        app.view = View::courses(&[course_summary("c0")]);
        // Light (default) paints the aula paper background...
        assert_eq!(bg_of(&mut app), Color::Rgb(0xF5, 0xF4, 0xF0));

        // ...switching to dark repaints with the terminal background, proving the
        // theme is applied end-to-end (not merely stored).
        app.theme.mode = crate::theme::Mode::Dark;
        assert_eq!(bg_of(&mut app), Color::Rgb(0x12, 0x13, 0x10));
    }

    // --- P9: account management --------------------------------------------

    /// An app with two profiles (active = "home") around a recording factory, so
    /// a switch test can assert which profile the client was rebuilt for.
    fn two_profile_app() -> (App, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let mut config = stub_config();
        // stub_config sets a single "default" profile; replace with home+work.
        config.profiles.clear();
        config.upsert_profile(
            "home",
            crate::config::Profile {
                server_url: "stub://home".into(),
                api_key: "sk_home".into(),
                name: Some("Home Learner".into()),
            },
        );
        config.upsert_profile(
            "work",
            crate::config::Profile {
                server_url: "stub://work".into(),
                api_key: "sk_work".into(),
                name: Some("Work Learner".into()),
            },
        );
        config.active = "home".into();
        let (factory, built) = recording_factory();
        let app = App::with_factory_at(config, factory, None).expect("two-profile app builds");
        (app, built)
    }

    #[test]
    fn a_opens_the_account_switcher_and_a_closes_it() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        assert!(!app.accounts.open);

        // `A` (shift+a) opens it; lowercase `a` does NOT (no audio screen here).
        assert!(matches!(
            app.map_key(key(KeyCode::Char('A'))),
            Some(Action::ToggleAccounts)
        ));
        app.on_toggle_accounts();
        assert!(app.accounts.open);

        app.on_toggle_accounts();
        assert!(!app.accounts.open);
    }

    #[test]
    fn switcher_is_modal_and_swallows_screen_keys() {
        let (mut app, _) = two_profile_app();
        app.view = View::courses(&[course_summary("c0")]);
        app.on_toggle_accounts();

        // Enter switches; arrows move; a number key is swallowed (no Choose leaks).
        assert!(matches!(
            app.map_key(key(KeyCode::Enter)),
            Some(Action::SwitchAccount)
        ));
        assert!(matches!(app.map_key(key(KeyCode::Up)), Some(Action::Up)));
        assert!(app.map_key(key(KeyCode::Char('2'))).is_none());
        // Still on Courses; nothing navigated behind the overlay.
        assert!(matches!(app.view, View::Courses { .. }));
    }

    #[tokio::test]
    async fn switching_account_rebuilds_the_client_for_the_new_profile_and_reloads() {
        let (mut app, built) = two_profile_app();
        // The factory built the initial client for the active "home" profile.
        assert_eq!(*built.lock().unwrap(), vec!["stub://home".to_string()]);

        // Open the switcher; cursor starts on the active profile ("home", index 0
        // since BTreeMap orders home<work). Move to "work" and switch.
        app.on_toggle_accounts();
        app.on_down(); // -> work (index 1)
        let gen_before = app.request_gen;
        app.on_switch_account();

        // Active profile changed, overlay closed, gen bumped (reload dispatched).
        assert_eq!(app.config.active, "work");
        assert!(!app.accounts.open);
        assert!(app.request_gen > gen_before, "switch reloads (bumps gen)");
        // The client was rebuilt for the new profile's server.
        assert_eq!(
            *built.lock().unwrap(),
            vec!["stub://home".to_string(), "stub://work".to_string()],
            "the client is rebuilt for the switched-to profile",
        );
    }

    #[test]
    fn switching_to_the_already_active_profile_is_a_noop_switch() {
        let (mut app, built) = two_profile_app();
        app.on_toggle_accounts();
        // Cursor is on the active "home"; Enter should not rebuild or reload.
        let gen_before = app.request_gen;
        app.on_switch_account();
        assert_eq!(app.config.active, "home");
        assert_eq!(app.request_gen, gen_before, "no reload for a no-op switch");
        assert_eq!(
            built.lock().unwrap().len(),
            1,
            "no client rebuild for the active profile",
        );
    }

    /// A two-profile app whose factory FAILS to build a client for the profile
    /// at `fail_server`. The "home" profile (active, built at startup) succeeds.
    fn app_with_failing_factory_for(
        fail_server: &'static str,
    ) -> (App, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let mut config = stub_config();
        config.profiles.clear();
        config.upsert_profile(
            "home",
            crate::config::Profile {
                server_url: "stub://home".into(),
                api_key: "sk_home".into(),
                name: Some("Home Learner".into()),
            },
        );
        config.upsert_profile(
            "work",
            crate::config::Profile {
                server_url: "stub://work".into(),
                api_key: "sk_work".into(),
                name: Some("Work Learner".into()),
            },
        );
        config.active = "home".into();

        let built = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&built);
        let factory: ClientFactory = Arc::new(move |profile: &crate::config::Profile| {
            sink.lock().unwrap().push(profile.server_url.clone());
            if profile.server_url == fail_server {
                Err(color_eyre::eyre::eyre!(
                    "bad key for {}",
                    profile.server_url
                ))
            } else {
                Ok(Arc::new(StubApi) as Arc<dyn Api>)
            }
        });
        let app = App::with_factory_at(config, factory, None).expect("home profile builds");
        (app, built)
    }

    #[tokio::test]
    async fn switching_to_a_profile_with_an_unbuildable_client_changes_nothing() {
        // "work" cannot build a client. Switching to it must NOT set active, must
        // NOT dispatch a fetch (which would load home's data under work), and must
        // surface the error while leaving "home" active and its view intact.
        let (mut app, built) = app_with_failing_factory_for("stub://work");
        // Put the app in a recognizable home state (not Loading).
        app.view = View::courses(&[course_summary("home-course")]);
        let gen_before = app.request_gen;

        app.on_toggle_accounts();
        app.on_down(); // cursor -> "work" (the bad profile)
        app.on_switch_account();

        // The switch was rejected: active stays "home".
        assert_eq!(
            app.config.active, "home",
            "a failed client build must not change the active profile",
        );
        // No fetch was dispatched: the generation did not advance and the view is
        // NOT reset to Loading (so no old-account data loads under a new profile).
        assert_eq!(
            app.request_gen, gen_before,
            "no courses fetch is dispatched when the new client cannot be built",
        );
        match &app.view {
            View::Courses { courses, .. } => {
                assert_eq!(courses.len(), 1, "the home view is left intact");
            }
            other => panic!("expected the home Courses view to remain, got {other:?}"),
        }
        // The factory was asked to build "work" (and it failed); the live client
        // is still home's (built once at startup). Builds: home (startup), work (failed).
        assert_eq!(
            *built.lock().unwrap(),
            vec!["stub://home".to_string(), "stub://work".to_string()],
        );
        // The overlay is closed and an error is shown.
        assert!(!app.accounts.open);
    }

    #[tokio::test]
    async fn whoami_reads_the_live_identity_through_the_api_seam() {
        // `sotto whoami` prefers a live `me()` call; the StubApi returns a known
        // identity, proving the contract + Api method are wired end-to-end.
        let api: Arc<dyn Api> = Arc::new(StubApi);
        let me = api.me().await.expect("stub me");
        assert_eq!(me.id, "u_stub");
        assert_eq!(me.name.as_deref(), Some("Stub Learner"));
    }

    #[test]
    fn opening_accounts_dismisses_the_other_modals() {
        let mut app = test_app();
        app.view = View::courses(&[]);
        app.on_toggle_help();
        assert!(app.help_open);
        app.on_toggle_accounts();
        assert!(app.accounts.open && !app.help_open);
        // Opening the theme picker dismisses accounts.
        app.on_toggle_theme_picker();
        assert!(app.theme_picker.open && !app.accounts.open);
    }

    fn course_summary(id: &str) -> types::CourseSummary {
        serde_json::from_value(serde_json::json!({
            "id": id, "nativeLang": "en", "targetLang": "es",
            "currentLevel": "A1", "startLevel": "A1", "activeClassId": null,
            "curriculum": { "title": format!("Course {id}") },
            "placement": null
        }))
        .expect("valid course summary")
    }

    /// One representative instance of each main screen for the render + keymap
    /// smoke tests.
    fn representative_views() -> Vec<View> {
        vec![
            View::Loading,
            View::Error {
                message: "boom".into(),
                retry: state::RetryKind::Courses,
            },
            View::courses(&[course_summary("c0")]),
            View::CourseHome {
                course: course("A"),
                due: DueCounts {
                    vocab: 3,
                    grammar: 1,
                    total_vocab: 20,
                },
                menu_cursor: 0,
                notice: None,
                starting: false,
            },
            View::start_items(
                course("A"),
                state::ReviewKind::Vocab,
                "s".into(),
                vec![state::VocabItem {
                    id: "v".into(),
                    prompt: "casa".into(),
                    options: vec!["house".into(), "dog".into()],
                }],
            ),
            View::start_listening(
                course("A"),
                "s".into(),
                "ep".into(),
                vec![state::VocabItem {
                    id: "v".into(),
                    prompt: "q".into(),
                    options: vec!["a".into(), "b".into()],
                }],
            ),
            View::start_speaking(
                course("A"),
                "s".into(),
                vec![state::SpeakingPrompt {
                    id: "p".into(),
                    target_phrase: "hola".into(),
                    translation: "hi".into(),
                }],
            ),
            class_with_sections(serde_json::json!([
                { "id": "sec", "skill": "GRAMMAR", "status": "READY", "episode": null,
                  "prompts": [], "writingPrompts": [],
                  "questions": [{ "id": "q", "order": 0, "question": "?", "options": ["a","b"], "passageRef": null, "passageText": null }] }
            ])),
            exam_app_with_section("LISTENING").view,
            View::placement_lang(),
            View::placement_review(
                "en".into(),
                "es".into(),
                vec![state::PlacementQuestion {
                    id: "pq".into(),
                    prompt: "?".into(),
                    options: vec!["a".into(), "b".into()],
                }],
            ),
            View::Memory {
                course: course("A"),
                items: Some(vec![]),
                scroll: 0,
            },
            View::Settings { config: None },
        ]
    }
}
