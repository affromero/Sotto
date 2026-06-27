use super::*;

impl App {
    // --- Async dispatch ----------------------------------------------------

    /// Spawn `task` and send `to_action(gen, result)` back through the channel
    /// when it resolves. `gen` lets the handler drop the result if the learner
    /// navigated away meanwhile. Keeps the render loop non-blocking.
    pub(super) fn dispatch<F, T, A>(&self, req_gen: u64, task: F, to_action: A)
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

    pub(super) fn fetch_courses(&mut self) {
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

    pub(super) fn fetch_due(&self, course_id: &str, req_gen: u64) {
        let client = Arc::clone(&self.client);
        let course_id = course_id.to_string();
        self.dispatch(
            req_gen,
            async move { client.practice_overview(&course_id).await },
            Action::DueLoaded,
        );
    }

    pub(super) fn start_skill(&mut self, course: Course, skill: SkillChoice) {
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

    pub(super) fn submit_answers(&mut self, answers: Vec<types::SubmitPracticeRequestAnswersItem>) {
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
    pub(super) fn fetch_episode(&self, episode_id: &str, req_gen: u64) {
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
    pub(super) fn on_play_pause(&mut self) {
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

    pub(super) fn set_audio_note(&mut self, note: &str) {
        if let View::ListeningReview { audio_note, .. } = &mut self.view {
            *audio_note = Some(note.to_string());
        }
    }

    // --- Speaking ----------------------------------------------------------

    /// Start or stop a recording on the speaking screen. Start → `Recording`;
    /// stop → encode WAV, upload, then poll grading. Guards re-entry by phase.
    pub(super) fn on_toggle_record(&mut self) {
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
    pub(super) fn stop_and_upload(&mut self) {
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
    pub(super) fn poll_grade(&self, recording_id: String, req_gen: u64) {
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
    pub(super) fn next_speaking_prompt(&mut self) {
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
    pub(super) fn is_current(&self, req_gen: u64) -> bool {
        req_gen == self.request_gen
    }

    pub(super) fn on_courses_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::CoursesListResponse>,
    ) {
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

    pub(super) fn on_due_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::PracticeOverviewResponse>,
    ) {
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

    pub(super) fn on_practice_started(
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

    pub(super) fn on_submitted(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::SubmitPracticeResponse>,
    ) {
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

    pub(super) fn on_episode_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::EpisodeDetailResponse>,
    ) {
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

    pub(super) fn on_audio_downloaded(&mut self, req_gen: u64, result: ApiResult<Vec<u8>>) {
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
    pub(super) fn play_bytes(&mut self, bytes: Vec<u8>) {
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

    pub(super) fn on_speaking_uploaded(
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

    pub(super) fn on_speaking_polled(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::SpeakingPollResponse>,
    ) {
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
    pub(super) fn schedule_poll(&self, recording_id: String, req_gen: u64) {
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
}
