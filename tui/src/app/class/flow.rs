impl App {
    // --- Entry + navigation -----------------------------------------------

    /// Start/resume the course's gated class: from CourseHome, a ClassResult, or
    /// the done screen. Dispatches `next-class`, which either creates/returns a
    /// class id (enter Class) or reports the course done.
    pub(super) fn on_next_class(&mut self) {
        let course = match &self.view {
            View::CourseHome { course, .. }
            | View::ClassOutcome { course, .. }
            | View::ClassDone { course, .. } => course.clone(),
            _ => return,
        };
        self.dispatch_next_class(course);
    }

    /// Dispatch `next-class` for `course`: stop audio, show Loading, and carry
    /// the course forward for the result screen's "next class" action. Shared by
    /// the menu entry ([`on_next_class`]) and the no-MC class completion path
    /// ([`class_advance_no_mc`]).
    fn dispatch_next_class(&mut self, course: Course) {
        let req_gen = self.bump_gen();
        self.stop_audio();
        self.view = View::Loading;
        let client = Arc::clone(&self.client);
        let course_id = course.id.clone();
        self.pending_course = Some(course);
        self.dispatch(
            req_gen,
            async move { client.next_class(&course_id).await },
            Action::NextClassResolved,
        );
        self.render();
    }

    /// Advance after completing a class that has NO multiple-choice sections
    /// (transcript-only listening / speaking-only / writing-only). The class
    /// submit route rejects an empty `answers` array (`.min(1)`), so such a
    /// class cannot be graded through it; instead we re-resolve via `next-class`
    /// so the learner advances (or sees the current gate state) rather than
    /// stalling on the last section. Works from `View::Class` (unlike
    /// [`on_next_class`], whose menu sources do not include `View::Class`).
    fn class_advance_no_mc(&mut self) {
        if let View::Class { course, .. } = &self.view {
            let course = course.clone();
            self.dispatch_next_class(course);
        }
    }

    /// Move the option cursor within the current section's MC/listening items.
    pub(super) fn class_cursor_move(&mut self, up: bool) {
        if let Some(section) = self.current_section_mut() {
            match &mut section.progress {
                SectionProgress::Mc {
                    questions,
                    index,
                    cursor,
                    ..
                }
                | SectionProgress::Listening {
                    questions,
                    index,
                    cursor,
                    ..
                } => {
                    let count = questions.get(*index).map_or(0, |q| q.options.len());
                    *cursor = if up {
                        cursor_up(*cursor)
                    } else {
                        cursor_down(*cursor, count)
                    };
                    self.render();
                }
                _ => {}
            }
        }
    }

    /// Scroll the current MC section's prompt (PageUp/PageDown).
    pub(super) fn class_scroll(&mut self, down: bool) {
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Mc { prompt_scroll, .. } = &mut section.progress
        {
            *prompt_scroll = if down {
                prompt_scroll.saturating_add(1)
            } else {
                prompt_scroll.saturating_sub(1)
            };
            self.render();
        }
    }

    /// True while a class submit is in flight; blocks any input that could
    /// answer/advance/re-submit so key-mashing cannot spawn duplicate submits.
    /// Covers both the class and exam flows.
    fn class_submitting(&self) -> bool {
        matches!(
            self.view,
            View::Class {
                submitting: true,
                ..
            } | View::Exam {
                submitting: true,
                ..
            }
        )
    }

    /// Enter / space on the current section: answer an MC item, advance speaking
    /// after grading, or (on a finished section) move to the next section.
    pub(super) fn class_on_select(&mut self) {
        // Ignore input entirely while a class submit is in flight.
        if self.class_submitting() {
            return;
        }
        let cursor = match self.current_section().and_then(section_cursor) {
            Some(c) => c,
            None => {
                // Speaking graded/failed -> advance; otherwise try to advance
                // the section if it is complete.
                self.class_advance_after_select();
                return;
            }
        };
        self.class_answer(cursor);
    }

    /// Pick a 1-based option by number key in the current MC/listening section.
    pub(super) fn class_on_choose(&mut self, index: usize) {
        if self.class_submitting() {
            return;
        }
        let count = self
            .current_section()
            .and_then(section_option_count)
            .unwrap_or(0);
        if index < count {
            self.class_answer(index);
        }
    }

    /// Record `choice` for the current MC/listening question and advance within
    /// the section; when the section's questions are all answered, move on.
    fn class_answer(&mut self, choice: usize) {
        let advanced_section = if let Some(section) = self.current_section_mut() {
            match &mut section.progress {
                SectionProgress::Mc {
                    questions,
                    index,
                    cursor,
                    selected,
                    prompt_scroll,
                } => {
                    let last = answer_current_choice(questions.len(), selected, *index, choice);
                    if last {
                        true
                    } else {
                        *index += 1;
                        *cursor = 0;
                        *prompt_scroll = 0;
                        false
                    }
                }
                SectionProgress::Listening {
                    questions,
                    index,
                    cursor,
                    selected,
                    ..
                } => {
                    let last = answer_current_choice(questions.len(), selected, *index, choice);
                    if last {
                        true
                    } else {
                        *index += 1;
                        *cursor = 0;
                        false
                    }
                }
                _ => false,
            }
        } else {
            false
        };
        if advanced_section {
            self.class_next_section();
        }
        self.render();
    }

    /// After a non-answering Select (speaking graded, or any complete section),
    /// advance: next speaking prompt, or next section.
    fn class_advance_after_select(&mut self) {
        let advance = match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Speaking {
                index,
                prompts,
                phase,
            }) => {
                if matches!(
                    phase,
                    SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. }
                ) {
                    if *index + 1 < prompts.len() {
                        SectionAdvance::NextSpeakingPrompt
                    } else {
                        SectionAdvance::NextSection
                    }
                } else {
                    SectionAdvance::None
                }
            }
            Some(SectionProgress::Writing {
                index,
                prompts,
                phase,
                ..
            }) => {
                // Graded/Failed writing advances on enter (after the learner has
                // read the feedback); other phases stay put.
                if matches!(
                    phase,
                    WritingPhase::Graded { .. } | WritingPhase::Failed { .. }
                ) {
                    if *index + 1 < prompts.len() {
                        SectionAdvance::NextWritingPrompt
                    } else {
                        SectionAdvance::NextSection
                    }
                } else {
                    SectionAdvance::None
                }
            }
            Some(SectionProgress::Listening { .. }) | Some(SectionProgress::Mc { .. }) => {
                SectionAdvance::NextSection
            }
            _ => SectionAdvance::None,
        };
        match advance {
            SectionAdvance::NextSpeakingPrompt => {
                // New prompt target: bump the generation so a late poll from the
                // previous prompt is dropped rather than applied here.
                self.bump_gen();
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { index, phase, .. } = &mut section.progress
                {
                    *index += 1;
                    *phase = SpeakingPhase::Idle;
                }
                self.render();
            }
            SectionAdvance::NextWritingPrompt => {
                // Advance to the next writing prompt with a fresh editor, now that
                // the learner has seen the previous prompt's feedback.
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Writing {
                        index,
                        input,
                        phase,
                        ..
                    } = &mut section.progress
                {
                    *index += 1;
                    *input = WritingInput::new();
                    *phase = WritingPhase::Editing;
                }
                self.render();
            }
            SectionAdvance::NextSection => self.class_next_section(),
            SectionAdvance::None => {}
        }
    }

    /// Move to the next section, or submit when the last is done. Shared by the
    /// class and exam flows (only the submit differs).
    fn class_next_section(&mut self) {
        let advanced = match &mut self.view {
            View::Class {
                sections: Some(sections),
                cursor,
                ..
            }
            | View::Exam {
                sections: Some(sections),
                cursor,
                ..
            } if *cursor + 1 < sections.len() => {
                *cursor += 1;
                true
            }
            _ => false,
        };

        if advanced {
            // New section target: bump the generation so any in-flight result
            // from the section we just left (a late episode load, audio
            // download, or speaking poll) is dropped by `is_current` instead of
            // attaching to this section. Then kick the new section's episode if
            // it is a listening section (under the fresh generation).
            self.bump_gen();
            self.stop_audio();
            self.class_fetch_current_episode();
        } else {
            // Last section done — submit through the active flow.
            match self.current_flow().map(|(flow, _)| flow) {
                Some(FlowKind::Class) => self.submit_class(),
                Some(FlowKind::Exam) => self.submit_exam(),
                None => {}
            }
        }
        self.render();
    }

    // --- Listening section -------------------------------------------------

    pub(super) fn class_play_pause(&mut self) {
        let url = self.current_section().and_then(|s| match &s.progress {
            SectionProgress::Listening { episode, .. } => {
                episode.as_ref().and_then(|e| e.audio_url.clone())
            }
            _ => None,
        });

        if let Some(player) = &self.player
            && !player.is_finished()
        {
            let playing = player.toggle();
            self.set_class_audio_note(if playing { "Playing" } else { "Paused" });
            self.render();
            return;
        }

        match url {
            Some(url) => {
                self.set_class_audio_note("Loading audio…");
                let req_gen = self.request_gen;
                let client = Arc::clone(&self.client);
                self.dispatch(
                    req_gen,
                    async move { client.download(&url).await },
                    Action::ClassAudioDownloaded,
                );
            }
            None => self.set_class_audio_note("No audio available for this section yet."),
        }
        self.render();
    }

    fn set_class_audio_note(&mut self, note: &str) {
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Listening { audio_note, .. } = &mut section.progress
        {
            *audio_note = Some(note.to_string());
        }
    }

    // --- Speaking section --------------------------------------------------

    pub(super) fn class_toggle_record(&mut self) {
        let phase = match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Speaking { phase, .. }) => phase.clone(),
            _ => return,
        };
        match phase {
            SpeakingPhase::Idle | SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. } => {
                match self.recorder.start() {
                    Ok(()) => {
                        if let Some(section) = self.current_section_mut()
                            && let SectionProgress::Speaking { phase, .. } = &mut section.progress
                        {
                            *phase = SpeakingPhase::Recording;
                        }
                    }
                    Err(e) => self.status_bar.set_error(e.to_string()),
                }
                self.render();
            }
            SpeakingPhase::Recording => self.class_stop_and_upload(),
            SpeakingPhase::Uploading | SpeakingPhase::Polling { .. } => {}
        }
    }

    fn class_stop_and_upload(&mut self) {
        let wav = match self.recorder.stop() {
            Ok(wav) => wav,
            Err(e) => {
                self.status_bar.set_error(e.to_string());
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { phase, .. } = &mut section.progress
                {
                    *phase = SpeakingPhase::Idle;
                }
                self.render();
                return;
            }
        };
        let req_gen = self.bump_gen();
        let (flow, id) = match self.current_flow() {
            Some((flow, Some(id))) => (flow, id),
            _ => return,
        };
        let prompt_id = match self.current_speaking_prompt_id() {
            Some(id) => id,
            None => return,
        };
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Speaking { phase, .. } = &mut section.progress
        {
            *phase = SpeakingPhase::Uploading;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move {
                match flow {
                    FlowKind::Class => client.upload_class_speaking(&id, &prompt_id, wav).await,
                    FlowKind::Exam => client.upload_exam_speaking(&id, &prompt_id, wav).await,
                }
            },
            Action::ClassSpeakingUploaded,
        );
        self.render();
    }

    fn class_poll_grade(&self, recording_id: String, req_gen: u64) {
        let (flow, id) = match self.current_flow() {
            Some((flow, Some(id))) => (flow, id),
            _ => return,
        };
        let prompt_id = match self.current_speaking_prompt_id() {
            Some(id) => id,
            None => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move {
                match flow {
                    FlowKind::Class => {
                        client
                            .poll_class_speaking(&id, &prompt_id, &recording_id)
                            .await
                    }
                    FlowKind::Exam => {
                        client
                            .poll_exam_speaking(&id, &prompt_id, &recording_id)
                            .await
                    }
                }
            },
            Action::ClassSpeakingPolled,
        );
    }

    fn class_schedule_poll(&self, recording_id: String, req_gen: u64) {
        let (flow, id, prompt_id) = match (self.current_flow(), self.current_speaking_prompt_id()) {
            (Some((flow, Some(id))), Some(p)) => (flow, id, p),
            _ => return,
        };
        let client = Arc::clone(&self.client);
        let tx = self.action_tx.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            let result = match flow {
                FlowKind::Class => {
                    client
                        .poll_class_speaking(&id, &prompt_id, &recording_id)
                        .await
                }
                FlowKind::Exam => {
                    client
                        .poll_exam_speaking(&id, &prompt_id, &recording_id)
                        .await
                }
            }
            .map_err(|e| e.to_string());
            let _ = tx.send(Action::ClassSpeakingPolled(req_gen, Arc::new(result)));
        });
    }

    // --- Writing section ---------------------------------------------------

    pub(super) fn on_writing_input(&mut self, c: char) {
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Writing { input, .. } = &mut section.progress
        {
            input.push_char(c);
            self.render();
        }
    }

    pub(super) fn on_writing_newline(&mut self) {
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Writing { input, .. } = &mut section.progress
        {
            input.newline();
            self.render();
        }
    }

    pub(super) fn on_writing_backspace(&mut self) {
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Writing { input, .. } = &mut section.progress
        {
            input.backspace();
            self.render();
        }
    }

    /// Submit (or, after a failure, resubmit) the current writing prompt's text
    /// for synchronous grading. The typed text is preserved across a failure, so
    /// a retry re-sends it without re-typing. In-flight (`Submitting`) and
    /// already-`Graded` phases are ignored.
    pub(super) fn on_writing_submit(&mut self) {
        let text = match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Writing {
                input,
                phase: WritingPhase::Editing | WritingPhase::Failed { .. },
                ..
            }) => {
                if input.is_empty() {
                    self.status_bar
                        .set_error("Write something before submitting.".to_string());
                    self.render();
                    return;
                }
                input.text()
            }
            _ => return,
        };
        let req_gen = self.bump_gen();
        let (flow, id) = match self.current_flow() {
            Some((flow, Some(id))) => (flow, id),
            _ => return,
        };
        let prompt_id = match self.current_writing_prompt_id() {
            Some(id) => id,
            None => return,
        };
        if let Some(section) = self.current_section_mut()
            && let SectionProgress::Writing { phase, .. } = &mut section.progress
        {
            *phase = WritingPhase::Submitting;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move {
                match flow {
                    FlowKind::Class => client.submit_class_writing(&id, &prompt_id, text).await,
                    FlowKind::Exam => client.submit_exam_writing(&id, &prompt_id, text).await,
                }
            },
            Action::ClassWritingGraded,
        );
        self.render();
    }

    // --- Class submit ------------------------------------------------------

    fn submit_class(&mut self) {
        // In-flight guard: never dispatch a second submit while one is pending.
        if self.class_submitting() {
            return;
        }
        let answers = match &self.view {
            View::Class {
                sections: Some(sections),
                ..
            } => {
                // Defensive: only submit once every MC/listening question is
                // answered (speaking/writing are graded separately and never
                // gate this). The section walk only reaches here when complete,
                // but guard against any partial state.
                if !class_ready_to_submit(sections) {
                    return;
                }
                collect_class_answers(sections)
            }
            _ => return,
        };
        // The class submit route requires a non-empty `answers` array
        // (`.min(1)`), so a class with no MC sections cannot be submitted
        // through it. Advance via `next-class` instead — from `View::Class`,
        // which `on_next_class` does not accept — so the learner moves on rather
        // than stalling on the last section.
        if answers.is_empty() {
            self.class_advance_no_mc();
            return;
        }
        let req_gen = self.bump_gen();
        let class_id = self.flow_id().unwrap_or_default();
        if let View::Class { submitting, .. } = &mut self.view {
            *submitting = true;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.submit_class(&class_id, answers).await },
            Action::ClassSubmitted,
        );
        self.render();
    }

    /// Submit an exam and produce its band/score result. Unlike the class submit,
    /// the exam route accepts an EMPTY answers array (no `.min(1)`), so a no-MC
    /// exam submits normally — no stall workaround needed.
    fn submit_exam(&mut self) {
        if self.class_submitting() {
            return;
        }
        let answers = match &self.view {
            View::Exam {
                sections: Some(sections),
                ..
            } => {
                if !class_ready_to_submit(sections) {
                    return;
                }
                match collect_exam_answers(sections) {
                    Ok(answers) => answers,
                    // A malformed answer id would misgrade the exam; surface it
                    // rather than sending a partial payload.
                    Err(message) => {
                        self.status_bar.set_error(message);
                        self.render();
                        return;
                    }
                }
            }
            _ => return,
        };
        let req_gen = self.bump_gen();
        let exam_id = self.flow_id().unwrap_or_default();
        if let View::Exam { submitting, .. } = &mut self.view {
            *submitting = true;
        }
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.submit_exam(&exam_id, answers).await },
            Action::ExamSubmitted,
        );
        self.render();
    }

    // --- Result reducers ---------------------------------------------------

}
