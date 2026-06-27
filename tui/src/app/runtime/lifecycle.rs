use super::*;

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
    pub(super) fn with_factory(config: Config, client_factory: ClientFactory) -> Result<Self> {
        Self::with_factory_at(config, client_factory, Some(crate::config::config_path()?))
    }

    /// Build an app around a [`ClientFactory`] that persists `config` to
    /// `config_path` (`None` = do not persist). Tests inject a stub factory and
    /// `None`/a temp path so dispatch and reducers run with zero network and the
    /// suite never writes the developer's real config file.
    pub(super) fn with_factory_at(
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
    pub(super) fn assemble(
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
            manual: ManualOverlay::closed(),
            delete: DeleteOverlay::closed(),
        }
    }

    /// Invalidate any in-flight request and return the new current generation.
    pub(super) fn bump_gen(&mut self) -> u64 {
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

    pub(super) fn handle_action(&mut self, action: Action, tui: &mut Tui) -> Result<()> {
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
            Action::ManualPlacementOpen => self.on_manual_open(),
            Action::ManualPlacementSubmit => self.on_manual_submit(),
            Action::ManualPlacementClose => self.on_manual_close(),
            Action::ManualPlaced(req_gen, result) => self.on_manual_placed(req_gen, result),
            Action::DeleteCourseOpen => self.on_delete_open(),
            Action::DeleteCourseInput(c) => self.on_delete_input(c),
            Action::DeleteCourseBackspace => self.on_delete_backspace(),
            Action::DeleteCourseConfirm => self.on_delete_confirm(),
            Action::DeleteCourseClose => self.on_delete_close(),
            Action::CourseDeleted(req_gen, result) => self.on_course_deleted(req_gen, result),
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
}
