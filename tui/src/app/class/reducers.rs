impl App {
    pub(super) fn on_next_class_resolved(
        &mut self,
        req_gen: u64,
        result: ApiResult<NextClassOutcome>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let course = match self.pending_course.take() {
            Some(c) => c,
            None => return,
        };
        match result.as_ref() {
            Ok(NextClassOutcome::Done) => self.view = View::ClassDone { course },
            Ok(NextClassOutcome::Created { class_id }) => {
                // Enter the class and fetch its sections.
                let class_id = class_id.clone();
                let fetch_gen = self.bump_gen();
                self.view = View::class_view(course, class_id.clone());
                let client = Arc::clone(&self.client);
                self.dispatch(
                    fetch_gen,
                    async move { client.class(&class_id).await },
                    Action::ClassLoaded,
                );
            }
            Err(message) => {
                self.status_bar.set_error(message.clone());
                self.enter_course_home(course);
            }
        }
        self.render();
    }

    pub(super) fn on_class_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::ClassDetailResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) if resp.status == types::ClassStatus::Generating => {
                let class_id = resp.id.clone();
                let client = Arc::clone(&self.client);
                self.dispatch(req_gen, async move {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    tokio::time::timeout(std::time::Duration::from_secs(30), client.class(&class_id)).await
                        .map_err(|_| color_eyre::eyre::eyre!("Class status timed out. Its saved preparation can be resumed."))?
                }, Action::ClassLoaded);
            },
            Ok(resp) => match class_sections(resp) {
                Some(built) => {
                    if let View::Class { sections, cursor, progress, attempt, .. } = &mut self.view {
                        *cursor = built.iter().position(|section| !crate::app::state::section_complete(section)).unwrap_or(0);
                        *sections = Some(built);
                        let snapshot = serde_json::to_value(resp).unwrap_or_default();
                        progress.revision = snapshot["progressRevision"].as_i64().unwrap_or_default();
                        *attempt = snapshot["attempt"].as_i64().unwrap_or(1);
                    }
                    if let View::Class { class_id, attempt, .. } = &self.view {
                        let key = format!("CLASS/{class_id}/{attempt}");
                        if let Some(mut cached) = self.practice_cache.remove(&key)
                            && matches!(&cached, View::Class { attempt: saved, progress, .. } if saved == attempt &&
                                (progress.dirty || progress.in_flight.is_some() || progress.conflict || cached.has_uncertain_upload())) {
                                crate::app::state::refresh_cached_practice(&mut cached, &self.view);
                                self.view = cached;
                        }
                    }
                    self.class_resume_current_speaking();
                    // If the first section is listening, kick off its episode.
                    self.class_fetch_current_episode();
                }
                None => {
                    if let View::Class { attempt, .. } = &mut self.view {
                        *attempt = serde_json::to_value(resp).unwrap_or_default()["attempt"].as_i64().unwrap_or(1);
                    }
                    self.show_class_repair("This saved class is incomplete. Press n to repair its missing exercises.");
                }
            },
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }

    pub(super) fn on_class_submitted(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::SubmitClassResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let View::Class { course, class_id, attempt, .. } = &self.view {
                    let course = course.clone(); let class_id = class_id.clone(); let attempt = *attempt;
                    self.stop_audio();
                    self.view = View::ClassOutcome {
                        course,
                        class_id, attempt,
                        result: ClassResult::from(resp),
                    };
                }
            }
            Err(message) => {
                if let View::Class { submitting, .. } = &mut self.view {
                    *submitting = false;
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    pub(super) fn on_class_episode_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::EpisodeDetailResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Listening { episode, .. } = &mut section.progress
                {
                    *episode = Some(EpisodeDetail::from(resp));
                }
            }
            Err(message) => self.status_bar.set_error(message.clone()),
        }
        self.render();
    }

    pub(super) fn on_class_audio_downloaded(&mut self, req_gen: u64, result: ApiResult<Vec<u8>>) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(bytes) => self.class_play_bytes(bytes.clone()),
            Err(message) => self.set_class_audio_note(&format!("Audio unavailable: {message}")),
        }
        self.render();
    }

    fn class_play_bytes(&mut self, bytes: Vec<u8>) {
        if self.player.is_none() {
            match AudioPlayer::new() {
                Ok(p) => self.player = Some(p),
                Err(e) => {
                    self.set_class_audio_note(&format!("Playback unavailable: {e}"));
                    return;
                }
            }
        }
        let Some(player) = &self.player else {
            return;
        };
        match player.play(bytes) {
            Ok(()) => self.set_class_audio_note("Playing"),
            Err(e) => self.set_class_audio_note(&format!("Could not play audio: {e}")),
        }
    }

    pub(super) fn on_class_speaking_uploaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<SpeakingUploadResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let recording_id = resp.recording_id.clone();
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { phase, prompts, index } = &mut section.progress
                {
                    if let Some(prompt) = prompts.get_mut(*index) { prompt.recording_id = Some(recording_id.clone()); }
                    *phase = SpeakingPhase::Polling {
                        recording_id: recording_id.clone(),
                    };
                }
                self.class_poll_grade(recording_id, req_gen);
            }
            Err(message) => {
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { phase, .. } = &mut section.progress
                {
                    *phase = SpeakingPhase::UnknownUpload {
                        message: format!("Upload outcome is unknown. Press r to check saved work. {message}"),
                    };
                }
                self.mark_practice_progress();
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    pub(super) fn on_class_speaking_polled(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::SpeakingPollResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let recording_id = match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Speaking {
                phase: SpeakingPhase::Polling { recording_id },
                ..
            }) => recording_id.clone(),
            _ => return,
        };
        match result.as_ref() {
            Ok(resp) => {
                let next = reduce_speaking_poll(&recording_id, resp);
                let terminal = poll_is_terminal(&next);
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { phase, .. } = &mut section.progress
                {
                    *phase = next;
                }
                if !terminal {
                    self.class_schedule_poll(recording_id, req_gen);
                }
            }
            Err(message) => {
                self.status_bar.set_error(format!("Recording is saved. Status check failed: {message}"));
                self.class_schedule_poll(recording_id, req_gen);
            }
        }
        self.render();
    }

    pub(super) fn on_class_writing_graded(
        &mut self,
        req_gen: u64,
        result: ApiResult<WritingGradeResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                let score = (resp.overall_score.clamp(0.0, 1.0) * 100.0).round() as u32;
                // Show the graded score + feedback and STOP. The learner reads it
                // and presses enter to advance (handled in `class_advance_after_select`),
                // so a multi-prompt section never auto-advances past a prompt's
                // feedback before it can be seen.
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Writing { phase, .. } = &mut section.progress
                {
                    *phase = WritingPhase::Graded {
                        score,
                        feedback: crate::app::state::writing_feedback(&resp.feedback, &resp.corrections.iter().map(|c| (c.old.as_str(), c.new.as_str(), c.why.as_str())).collect::<Vec<_>>()),
                    };
                }
            }
            Err(message) => {
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Writing { phase, .. } = &mut section.progress
                {
                    *phase = WritingPhase::Failed {
                        message: message.clone(),
                    };
                }
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    // --- Small accessors ---------------------------------------------------

    pub(super) fn current_section_mut(&mut self) -> Option<&mut ClassSection> {
        match &mut self.view {
            View::Class {
                sections: Some(sections),
                cursor,
                ..
            }
            | View::Exam {
                sections: Some(sections),
                cursor,
                ..
            }
            | View::Practice { sections: Some(sections), cursor, .. } => sections.get_mut(*cursor),
            _ => None,
        }
    }

    /// The active section-walk flow (class or exam) and its target id, if the id
    /// is known. For an exam the id is `None` until the start request mints it
    /// (which only happens before any section dispatch), so callers that need a
    /// concrete id treat `None` as "not ready".
    fn current_flow(&self) -> Option<(FlowKind, Option<String>)> {
        match &self.view {
            View::Class { class_id, .. } => Some((FlowKind::Class, Some(class_id.clone()))),
            View::Exam { exam_id, .. } => Some((FlowKind::Exam, exam_id.clone())),
            View::Practice { session_id, .. } => Some((FlowKind::Practice, Some(session_id.clone()))),
            _ => None,
        }
    }

    /// The active flow's target id (class id or exam id), when known.
    fn flow_id(&self) -> Option<String> {
        self.current_flow().and_then(|(_, id)| id)
    }

    fn current_speaking_prompt_id(&self) -> Option<String> {
        match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Speaking { prompts, index, .. }) => {
                prompts.get(*index).map(|p| p.id.clone())
            }
            _ => None,
        }
    }

    fn current_writing_prompt_id(&self) -> Option<String> {
        match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Writing { prompts, index, .. }) => {
                prompts.get(*index).map(|p| p.id.clone())
            }
            _ => None,
        }
    }

    /// Fetch the current listening section's episode (called after class load /
    /// when entering a listening section).
    pub(super) fn class_fetch_current_episode(&mut self) {
        let episode_id = match self.current_section().map(|s| &s.progress) {
            Some(SectionProgress::Listening {
                episode_id,
                episode,
                ..
            }) if episode.is_none() && !episode_id.is_empty() => episode_id.clone(),
            _ => return,
        };
        let req_gen = self.request_gen;
        let client = Arc::clone(&self.client);
        self.dispatch(
            req_gen,
            async move { client.episode(&episode_id).await },
            Action::ClassEpisodeLoaded,
        );
    }
}

/// How a Select that doesn't answer an item should advance the class.
enum SectionAdvance {
    None,
    NextSpeakingPrompt,
    NextWritingPrompt,
    NextSection,
}

/// The keyboard option cursor of the current MC/listening section, if it has
/// answerable items remaining.
fn section_cursor(section: &ClassSection) -> Option<usize> {
    match &section.progress {
        SectionProgress::Mc {
            questions, cursor, ..
        }
        | SectionProgress::Listening {
            questions, cursor, ..
        } if !questions.is_empty() => Some(*cursor),
        _ => None,
    }
}

fn section_option_count(section: &ClassSection) -> Option<usize> {
    match &section.progress {
        SectionProgress::Mc {
            questions, index, ..
        }
        | SectionProgress::Listening {
            questions, index, ..
        } => questions.get(*index).map(|q| q.options.len()),
        _ => None,
    }

}
