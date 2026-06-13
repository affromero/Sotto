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
    AnswerStep, Course, DueCounts, EpisodeDetail, PracticeResult, RetryKind, SkillChoice,
    SpeakingPhase, View, answer_current, can_review_vocab, cursor_down, cursor_up, list_down,
    list_up, poll_is_terminal, reduce_speaking_poll, reduce_start,
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
            Action::CoursesLoaded(req_gen, result) => self.on_courses_loaded(req_gen, result),
            Action::DueLoaded(req_gen, result) => self.on_due_loaded(req_gen, result),
            Action::PracticeStarted(req_gen, result) => self.on_practice_started(req_gen, result),
            Action::Submitted(req_gen, result) => self.on_submitted(req_gen, result),
            Action::EpisodeLoaded(req_gen, result) => self.on_episode_loaded(req_gen, result),
            Action::AudioDownloaded(req_gen, result) => self.on_audio_downloaded(req_gen, result),
            Action::SpeakingUploaded(req_gen, result) => self.on_speaking_uploaded(req_gen, result),
            Action::SpeakingPolled(req_gen, result) => self.on_speaking_polled(req_gen, result),
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

        // Screen-specific keys take priority over the generic mapping below.
        match &self.view {
            // Persistent error screen: `r` retries the failed action.
            View::Error { .. } if matches!(key.code, KeyCode::Char('r')) => {
                return Some(Action::Retry);
            }
            // Listening: space toggles playback (it would otherwise Select).
            View::ListeningReview { .. } if matches!(key.code, KeyCode::Char(' ')) => {
                return Some(Action::PlayPause);
            }
            // Speaking: `r` toggles recording.
            View::SpeakingReview { .. } if matches!(key.code, KeyCode::Char('r')) => {
                return Some(Action::ToggleRecord);
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

    // --- Input handlers ----------------------------------------------------

    fn on_up(&mut self) {
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
            _ => {}
        }
    }

    fn on_down(&mut self) {
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
            _ => {}
        }
    }

    /// Scroll the current item's prompt (PageUp/PageDown), for long reading
    /// passages. Only `ItemReview` has a scrollable prompt; clamps at 0.
    fn on_scroll(&mut self, down: bool) {
        if let View::ItemReview { prompt_scroll, .. } = &mut self.view {
            *prompt_scroll = if down {
                prompt_scroll.saturating_add(1)
            } else {
                prompt_scroll.saturating_sub(1)
            };
            self.render();
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
            View::Loading | View::Error { .. } => {}
        }
    }

    fn on_choose(&mut self, n: usize) {
        // `n` is 1-based from the number keys.
        let index = n.saturating_sub(1);
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
            | View::Result { course, .. } => {
                let course = course.clone();
                // Stop any audio/recording before leaving a review screen.
                self.stop_audio();
                self.enter_course_home(course);
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
    use crate::api::{Api, types};
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
}
