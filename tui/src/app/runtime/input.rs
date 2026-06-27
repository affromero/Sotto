use super::*;

impl App {
    pub(super) fn handle_event(&mut self, event: Event) -> Result<()> {
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
    pub(super) fn map_key(&self, key: KeyEvent) -> Option<Action> {
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

        // Manual placement (`l` from the language picker) is MODAL: ↑/↓ pick a
        // level, Enter confirms, Esc/`l`/`q` close; everything else is swallowed.
        if self.manual.open {
            return match key.code {
                KeyCode::Up | KeyCode::Char('k') => Some(Action::Up),
                KeyCode::Down | KeyCode::Char('j') => Some(Action::Down),
                KeyCode::Enter => Some(Action::ManualPlacementSubmit),
                KeyCode::Esc | KeyCode::Char('l') | KeyCode::Char('q') => {
                    Some(Action::ManualPlacementClose)
                }
                _ => None,
            };
        }

        // Delete-confirm (`x` from the course home) is MODAL and owns text input:
        // type the language code, Enter confirms, Backspace edits, Esc cancels.
        // Returns above the global polish keys so `t`/`?`/`q` are typed, not
        // intercepted as theme/help/back.
        if self.delete.open {
            return match key.code {
                KeyCode::Enter => Some(Action::DeleteCourseConfirm),
                KeyCode::Esc => Some(Action::DeleteCourseClose),
                KeyCode::Backspace => Some(Action::DeleteCourseBackspace),
                KeyCode::Char(c) => Some(Action::DeleteCourseInput(c)),
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
            // PlacementLang: `l` opens the "I know my level" manual picker.
            View::PlacementLang { .. } if matches!(key.code, KeyCode::Char('l')) => {
                return Some(Action::ManualPlacementOpen);
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
            // CourseHome: `x` opens the delete-course confirm overlay.
            View::CourseHome {
                starting: false, ..
            } if matches!(key.code, KeyCode::Char('x')) => {
                return Some(Action::DeleteCourseOpen);
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
    pub(super) fn back_action(&self) -> Action {
        match self.view {
            View::Loading | View::Courses { .. } | View::Error { .. } => Action::Quit,
            _ => Action::Back,
        }
    }

    /// True when the current screen plays audio (standalone listening or a class
    /// listening section), so space maps to play/pause.
    pub(super) fn audio_screen(&self) -> bool {
        matches!(self.view, View::ListeningReview { .. })
            || matches!(
                self.current_section().map(|s| &s.progress),
                Some(SectionProgress::Listening { .. })
            )
    }

    /// True when the current screen records speech (standalone speaking or a
    /// class speaking section), so `r` maps to record toggle.
    pub(super) fn speaking_screen(&self) -> bool {
        matches!(self.view, View::SpeakingReview { .. })
            || matches!(
                self.current_section().map(|s| &s.progress),
                Some(SectionProgress::Speaking { .. })
            )
    }

    /// True when the current class section is a writing prompt being edited.
    pub(super) fn in_writing_editing(&self) -> bool {
        matches!(
            self.current_section().map(|s| &s.progress),
            Some(SectionProgress::Writing {
                phase: WritingPhase::Editing,
                ..
            })
        )
    }

    /// True when the current writing section's submission failed (retryable).
    pub(super) fn in_writing_failed(&self) -> bool {
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
    pub(super) fn current_section(&self) -> Option<&state::ClassSection> {
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
    pub(super) fn in_section_walk(&self) -> bool {
        matches!(self.view, View::Class { .. } | View::Exam { .. })
    }

    // --- Input handlers ----------------------------------------------------

    pub(super) fn on_up(&mut self) {
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
        // The manual placement overlay owns ↑/↓ when open (level selection).
        if self.manual.open {
            self.manual.move_cursor(false);
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

    pub(super) fn on_down(&mut self) {
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
        if self.manual.open {
            self.manual.move_cursor(true);
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
    pub(super) fn on_scroll(&mut self, down: bool) {
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
    pub(super) fn on_toggle_theme_picker(&mut self) {
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
    pub(super) fn on_toggle_help(&mut self) {
        self.help_open = !self.help_open;
        if self.help_open {
            self.theme_picker = ThemePicker::closed();
            self.accounts = AccountsOverlay::closed();
        }
        self.render();
    }

    /// Cycle the value of the picker's focused row and apply it live. The choice
    /// is persisted when the picker closes (not on every keystroke).
    pub(super) fn on_cycle_theme_value(&mut self) {
        if self.theme_picker.open {
            overlay::cycle_focused(&mut self.theme, self.theme_picker.row);
            self.render();
        }
    }

    /// Persist `config` to its configured path. A no-op when `config_path` is
    /// `None` (tests), so the suite never writes the developer's real config.
    pub(super) fn persist_config(&self) -> Result<()> {
        match &self.config_path {
            Some(path) => self.config.save_to(path),
            None => Ok(()),
        }
    }

    /// Write the active theme into `config` and persist it. A save failure is
    /// surfaced in the status bar rather than crashing the UI loop.
    pub(super) fn persist_theme(&mut self) {
        self.config.theme = self.theme.to_choice();
        if let Err(e) = self.persist_config() {
            self.status_bar
                .set_error(format!("could not save theme: {e}"));
        }
    }

    // --- Account management (P9) -------------------------------------------

    /// Toggle the account switcher overlay (`A`). Opens with the cursor on the
    /// active profile so Enter on it is a no-op switch.
    pub(super) fn on_toggle_accounts(&mut self) {
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
    pub(super) fn on_switch_account(&mut self) {
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

    pub(super) fn on_select(&mut self) {
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

    pub(super) fn on_choose(&mut self, n: usize) {
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

    pub(super) fn on_back(&mut self) {
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
    pub(super) fn stop_audio(&mut self) {
        if let Some(player) = &self.player {
            player.stop();
        }
        if self.recorder.is_recording() {
            let _ = self.recorder.stop();
        }
    }

    pub(super) fn on_retry(&mut self) {
        if let View::Error { retry, .. } = &self.view {
            match retry {
                RetryKind::Courses => self.fetch_courses(),
            }
            self.render();
        }
    }

    // --- Screen transitions ------------------------------------------------

    pub(super) fn enter_course_home(&mut self, course: Course) {
        // New target: invalidate any in-flight request for the previous one.
        let req_gen = self.bump_gen();
        self.fetch_due(&course.id, req_gen);
        self.view = View::course_home(course);
        self.render();
    }

    pub(super) fn dismiss_result(&mut self) {
        if let View::Result { course, .. } = &self.view {
            let course = course.clone();
            // Refetch due counts; they should have dropped after the review.
            self.enter_course_home(course);
        }
    }

    /// Record `choice` for the current item of an ItemReview or ListeningReview,
    /// advancing or submitting. Shared by both choice-based review screens.
    pub(super) fn answer_choice(&mut self, choice: usize) {
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
}
