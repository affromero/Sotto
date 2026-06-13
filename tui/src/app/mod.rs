mod class;
mod exam;
mod onboard;
mod state;
mod ui;

use std::sync::Arc;

use color_eyre::Result;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{
    Frame,
    layout::{Constraint, Layout, Rect},
};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::action::{Action, ApiResult};
use crate::api::{Api, SottoClient, SpeakingUploadResponse, types};
use crate::audio::{AudioPlayer, Recorder};
use crate::components::Component;
use crate::components::status_bar::StatusBar;
use crate::config::Config;
use crate::event::Event;
use crate::tui::Tui;

use state::{
    AnswerStep, Course, DueCounts, EpisodeDetail, PracticeResult, RetryKind, SectionProgress,
    SkillChoice, SpeakingPhase, View, WritingPhase, answer_current, can_review_vocab, cursor_down,
    cursor_up, list_down, list_up, poll_is_terminal, reduce_speaking_poll, reduce_start,
};

/// The interactive Sotto client. Owns the session [`Config`], the [`Api`] seam
/// it dispatches through, the current [`View`] state machine, and the status
/// bar. Terminal events are mapped to [`Action`]s; async API calls are
/// dispatched onto tokio tasks that send result actions back through
/// `action_tx`, so the render loop never blocks on the network.
pub(crate) struct App {
    config: Config,
    client: Arc<dyn Api>,
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
}

impl App {
    /// Build the production app: a real [`SottoClient`] against the configured
    /// server.
    pub fn new(config: Config) -> Result<Self> {
        let client = Arc::new(SottoClient::new(&config.server_url, &config.api_key)?);
        Ok(Self::with_client(config, client))
    }

    /// Build an app around an injected [`Api`] implementation. Production calls
    /// this through [`App::new`]; tests pass a stub so dispatch and reducers run
    /// with zero network.
    fn with_client(config: Config, client: Arc<dyn Api>) -> Self {
        let (action_tx, action_rx) = mpsc::unbounded_channel();
        let status_bar = StatusBar::new(config.server_url.clone(), "(owner)".to_string());
        Self {
            config,
            client,
            view: View::Loading,
            should_quit: false,
            status_bar,
            action_tx,
            action_rx,
            request_gen: 0,
            player: None,
            recorder: Recorder::new(),
            pending_course: None,
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
            Action::Input(c) => self.on_writing_input(c),
            Action::InputNewline => self.on_writing_newline(),
            Action::InputBackspace => self.on_writing_backspace(),
            Action::SubmitText => self.on_writing_submit(),
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
            Action::GraphLoaded(req_gen, result) => self.on_graph_loaded(req_gen, result),
            Action::ConfigLoaded(req_gen, result) => self.on_config_loaded(req_gen, result),
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

        // Screen-specific keys take priority over the generic mapping below.
        match &self.view {
            // Persistent error screen: `r` retries the failed action.
            View::Error { .. } if matches!(key.code, KeyCode::Char('r')) => {
                return Some(Action::Retry);
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

    fn on_select(&mut self) {
        match &self.view {
            View::Courses { courses, cursor } => {
                if let Some(course) = courses.get(*cursor).cloned() {
                    self.enter_course_home(course);
                }
            }
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

    fn draw(&mut self, frame: &mut Frame) -> Result<()> {
        let chunks =
            Layout::vertical([Constraint::Fill(1), Constraint::Length(1)]).split(frame.area());
        ui::draw_view(frame, chunks[0], &self.view, &self.config);
        self.status_bar.draw(frame, chunks[1])?;
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
    }

    /// Build an `App` around a [`StubApi`]. No terminal is created and no
    /// network is possible: the only [`Api`] impl is the stub.
    fn test_app() -> App {
        let config = Config {
            server_url: "stub://test".into(),
            api_key: "test-key".into(),
        };
        App::with_client(config, Arc::new(StubApi))
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

    fn class_detail(json: serde_json::Value) -> ApiResult<types::ClassDetailResponse> {
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
            "submitted": false, "sections": sections
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
            }
            other => panic!("expected PlacementResult, got {other:?}"),
        }

        // Continue -> land in the created course's home.
        app.placement_result_continue();
        match &app.view {
            View::CourseHome { course, .. } => assert_eq!(course.id, "course-new"),
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
}
