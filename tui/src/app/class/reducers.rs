fn history_audio(detail: &types::ClassDetailResponse) -> state::HistoryAudioState {
    let value = serde_json::to_value(detail).unwrap_or_default();
    let mut items = Vec::new();
    if let Some(sections) = value["speakingHistory"].as_array() {
        for section in sections {
            if let Some(prompts) = section["prompts"].as_array() {
                for prompt in prompts {
                    let Some(prompt_id) = prompt["id"].as_str() else { continue; };
                    let phrase: String = prompt["targetPhrase"].as_str().unwrap_or("Speaking task")
                        .chars().filter(|ch| !ch.is_control()).collect();
                    if let Some(recordings) = prompt["recordings"].as_array() {
                        for recording in recordings {
                            let Some(recording_id) = recording["id"].as_str() else { continue; };
                            let status: String = recording["status"].as_str().unwrap_or("unavailable")
                                .chars().filter(|ch| !ch.is_control()).collect();
                            let timestamp: String = recording["createdAt"].as_str().unwrap_or("")
                                .chars().filter(|ch| !ch.is_control()).collect();
                            let label = format!("{} · Attempt {} · {} · {}", phrase,
                                recording["attempt"].as_i64().unwrap_or_default(), status, timestamp);
                            items.push(state::HistoryAudioItem { prompt_id: prompt_id.into(),
                                recording_id: recording_id.into(), label });
                        }
                    }
                }
            }
        }
    }
    state::HistoryAudioState { items, ..Default::default() }
}

fn previous_work(detail: &types::ClassDetailResponse) -> Vec<String> {
    let value = serde_json::to_value(detail).unwrap_or_default();
    let mut lines = Vec::new();
    let clean = |text: &str| text.chars().filter(|ch| !ch.is_control() || *ch == '\n' || *ch == '\t').collect::<String>();
    let score_label = |score: &serde_json::Value| match score.as_f64() {
        Some(score) if !(0.0..=1.0).contains(&score) => format!("Recorded score: {score} (outside expected range)"),
        Some(score) => format!("Score: {:.0}%", score * 100.0),
        None => "Score unavailable".into(),
    };
    let choice = |options: &serde_json::Value, selected: i64| {
        let label = usize::try_from(selected).ok().and_then(|index| options.as_array().and_then(|values| values.get(index))).and_then(|value| value.as_str());
        match label {
            Some(label) => format!("{}. {}", selected + 1, clean(label)),
            None => format!("Choice index {selected} (text unavailable)"),
        }
    };
    let add_submissions = |entries: &serde_json::Value, options: &serde_json::Value, lines: &mut Vec<String>| {
        if let Some(entries) = entries.as_array() {
            for entry in entries {
                    let selected = entry["selectedIndex"].as_i64().map(|value| choice(options, value)).unwrap_or_else(|| "Choice unavailable".into());
                    let attempt = entry["attempt"].as_i64().map(|value| format!(" · Attempt {value}")).unwrap_or_default();
                    let outcome = match entry["isCorrect"].as_bool() { Some(true) => "Correct", Some(false) => "Incorrect", None => "Outcome unavailable" };
                    let timestamp = entry["submittedAt"].as_str().map(|value| format!(" · {}", clean(value))).unwrap_or_default();
                    lines.push(format!("Submitted{attempt}{timestamp}: {selected} · {outcome}"));
            }
        }
    };
    let add_recording = |recording: &serde_json::Value, lines: &mut Vec<String>| {
        lines.push(format!("Recording: {}", clean(recording["status"].as_str().unwrap_or("unavailable"))));
        if recording["attemptMatches"] == false { lines.push("Saved with a different attempt number.".into()); }
        if let Some(transcript) = recording["transcript"].as_str() { lines.push(format!("Transcript: {}", clean(transcript))); }
        if !recording["overallScore"].is_null() { lines.push(score_label(&recording["overallScore"])); }
        if let Some(feedback) = recording["feedback"].as_str() { lines.push(format!("Feedback: {}", clean(feedback))); }
        let mut invalid = false;
        if let Some(scores) = recording["rubricScores"].as_object() {
            for (name, score) in scores {
                if score.as_f64().is_some() { lines.push(format!("{}: {}", clean(name), score_label(score).trim_start_matches("Score: "))); }
                else { invalid = true; }
            }
        } else if !recording["rubricScores"].is_null() { invalid = true; }
        if let Some(tokens) = recording["phonemeScores"].as_array() {
            for token in tokens {
                if let Some(op) = token["op"].as_str() {
                    let expected = token["expected"].as_str().unwrap_or("unavailable");
                    let actual = token["actual"].as_str().unwrap_or("unavailable");
                    lines.push(format!("{}: {} → {}", clean(op), clean(expected), clean(actual)));
                } else { invalid = true; }
            }
        } else if !recording["phonemeScores"].is_null() { invalid = true; }
        if invalid { lines.push("Some speaking feedback could not be displayed.".into()); }
    };
    if let Some(sections) = value["speakingHistory"].as_array() {
        for section in sections {
            lines.push(format!("Previous speaking · Attempt {}", section["attempt"].as_i64().unwrap_or_default()));
            if let Some(prompts) = section["prompts"].as_array() {
                for prompt in prompts {
                    lines.push(clean(prompt["targetPhrase"].as_str().unwrap_or_default()));
                    lines.push(clean(prompt["translation"].as_str().unwrap_or_default()));
                    if let Some(recordings) = prompt["recordings"].as_array() {
                        for recording in recordings { add_recording(recording, &mut lines); }
                    }
                }
            }
        }
    }
    if let Some(recordings) = value["speakingHistoryUnlinked"].as_array() {
        for recording in recordings {
            lines.push("Recording without its original task".into());
            add_recording(recording, &mut lines);
        }
    }
    if let Some(sections) = value["writingHistory"].as_array() {
        for section in sections {
            lines.push(format!("Attempt {}", section["attempt"].as_i64().unwrap_or_default()));
            if let Some(prompts) = section["prompts"].as_array() {
                for prompt in prompts {
                    lines.push(clean(prompt["task"].as_str().unwrap_or_default()));
                    if let Some(draft) = prompt["savedDraft"].as_str() {
                        lines.push(format!("Saved draft:\n{}", if draft.is_empty() { "(Empty draft)".into() } else { clean(draft) }));
                    }
                    if let Some(responses) = prompt["responses"].as_array() {
                        for response in responses {
                            lines.push(format!("{}:\n{}", if response["overallScore"].is_null() { "Submitted response" } else { "Graded response" }, clean(response["text"].as_str().unwrap_or_default())));
                            if response["attemptMatches"] == false { lines.push("Saved with a different attempt number.".into()); }
                            if let Some(score) = response["overallScore"].as_f64() { lines.push(format!("Score: {:.0}%", score * 100.0)); }
                            if let Some(feedback) = response["feedback"].as_str() { lines.push(clean(feedback)); }
                            if let Some(corrections) = response["corrections"].as_array() {
                                for correction in corrections {
                                    if let (Some(old), Some(new), Some(why)) = (correction["old"].as_str(), correction["new"].as_str(), correction["why"].as_str()) {
                                        lines.push(format!("{} → {}: {}", clean(old), clean(new), clean(why)));
                                    } else { lines.push("Some corrections could not be displayed.".into()); }
                                }
                            } else if !response["corrections"].is_null() { lines.push("Some corrections could not be displayed.".into()); }
                        }
                    }
                    lines.push(String::new());
                }
            }
        }
    }
    if let Some(drafts) = value["orphanWritingDrafts"].as_array() {
        for draft in drafts {
            if let Some(text) = draft["text"].as_str() {
                lines.push(format!("Saved draft without its original task:\n{}", if text.is_empty() { "(Empty draft)".into() } else { clean(text) }));
            }
        }
    }
    if let Some(sections) = value["quizHistory"].as_array() {
        if !sections.is_empty() { lines.push("Previous quiz work. Tasks and choices are the currently saved versions; earlier wording may have changed.".into()); }
        for section in sections {
            lines.push(format!("{} · Attempt {}", clean(section["skill"].as_str().unwrap_or("Quiz")), section["attempt"].as_i64().unwrap_or_default()));
            if let Some(questions) = section["questions"].as_array() {
                for question in questions {
                    if let Some(passage) = question["passageText"].as_str() { lines.push(clean(passage)); }
                    lines.push(clean(question["question"].as_str().unwrap_or_default()));
                    if let Some(selected) = question["savedChoice"].as_i64() {
                        lines.push(format!("Saved choice: {}", choice(&question["options"], selected)));
                    }
                    add_submissions(&question["submissions"], &question["options"], &mut lines);
                }
            }
        }
    }
    if let Some(answers) = value["orphanQuizAnswers"].as_array() {
        for answer in answers {
            lines.push("Answer without its original task".into());
            if let Some(selected) = answer["savedChoice"].as_i64() {
                lines.push(format!("Saved choice: {}", choice(&serde_json::Value::Null, selected)));
            }
            add_submissions(&answer["submissions"], &serde_json::Value::Null, &mut lines);
        }
    }
    if let Some(receipts) = value["quizSubmissionReceipts"].as_array() {
        for receipt in receipts {
            let attempt = receipt["attempt"].as_i64().map(|value| format!(" · Attempt {value}")).unwrap_or_default();
            lines.push(format!("Saved submission{attempt}"));
            if let Some(timestamp) = receipt["submittedAt"].as_str() { lines.push(format!("Submitted at: {}", clean(timestamp))); }
            lines.push(match receipt["passed"].as_bool() { Some(true) => "Passed", Some(false) => "Not passed", None => "Outcome unavailable" }.into());
            lines.push(score_label(&receipt["overallScore"]));
            let passed = receipt["passedSections"].as_i64();
            let total = receipt["totalSections"].as_i64();
            if passed.is_some() || total.is_some() { lines.push(format!("Recorded: {} of {} skills passed", passed.map(|value| value.to_string()).unwrap_or_else(|| "?".into()), total.map(|value| value.to_string()).unwrap_or_else(|| "?".into()))); }
            if let Some(sections) = receipt["sections"].as_array() {
                for section in sections {
                    let skill = clean(section["skill"].as_str().unwrap_or("Skill unavailable"));
                    let passed = match section["passed"].as_bool() { Some(true) => "Passed", Some(false) => "Not passed", None => "Outcome unavailable" };
                    lines.push(format!("{} · {} · {}", skill, score_label(&section["score"]), passed));
                }
            }
            if receipt["summaryIncomplete"] == true { lines.push("Some result details are unavailable.".into()); }
            if receipt["answersUnavailable"] == true { lines.push("Some individual answers are unavailable.".into()); }
        }
    }
    if value["quizHistoryUnreadable"] == true { lines.push("Some previous quiz records could not be displayed.".into()); }
    lines
}

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
                let class_id = class_id.clone();
                let fetch_gen = self.bump_gen();
                self.view = View::ClassPrelude { course, class_id: class_id.clone(), value: None, in_flight: true, error: None, scroll: 0, polls: 0, retained_work: Vec::new() };
                let client = Arc::clone(&self.client);
                self.dispatch_class_prelude(
                    fetch_gen,
                    async move { client.class_prelude(&class_id).await },
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
        if matches!(result.as_ref(), Ok(detail) if detail.status != types::ClassStatus::Generating)
            && matches!(&self.view, View::Class { history_open: true, .. }) {
            if let Some(task) = self.history_audio_task.take() { task.abort(); }
            if let Some(player) = &self.player { player.stop(); }
        }
        if let (View::Class { class_id, .. }, Ok(detail)) = (&self.view, result.as_ref())
            && detail.id != *class_id
        {
            self.status_bar.set_error("The server returned a different class. Reopen this class to try again.".into());
            self.render();
            return;
        }
        if let (View::Class { course, class_id, directions, material_source, sections: Some(sections), progress, attempt, .. }, Ok(detail)) = (&self.view, result.as_ref()) {
            let current = serde_json::to_value(detail).unwrap_or_default();
            let source_changed = material_source.as_ref().is_some_and(|source| current["taskMaterialRevision"] != *source)
                || directions.as_ref().is_some_and(|saved| current["prerequisiteSourceHash"] != saved.source_hash);
            let changed_work = (progress.dirty || progress.in_flight.is_some() || progress.conflict || self.view.has_uncertain_upload())
                && (material_source.is_none() || current["attempt"].as_i64().unwrap_or(1) != *attempt ||
                    class_sections(detail).is_none_or(|fresh| !same_class_tasks(sections, &fresh)));
            if source_changed || changed_work {
                let course = course.clone();
                let class_id = class_id.clone();
                self.cache_practice();
                let next = self.bump_gen();
                self.view = View::ClassPrelude { course, class_id: class_id.clone(), value: None, in_flight: true, error: None, scroll: 0, polls: 0, retained_work: Vec::new() };
                let client = Arc::clone(&self.client);
                self.dispatch_class_prelude(next, async move { client.class_prelude(&class_id).await });
                self.render();
                return;
            }
        }
        if let (View::Class { course, class_id, sections, progress, .. }, Ok(detail)) = (&self.view, result.as_ref()) {
            let snapshot = serde_json::to_value(detail).unwrap_or_default();
            if let Some(mut work) = conflicting_cached_class_work(&self.practice_cache, class_id, detail, snapshot["submitted"] == true) {
                let course = course.clone();
                let class_id = class_id.clone();
                if progress.dirty || progress.in_flight.is_some() || progress.conflict || self.view.has_uncertain_upload() {
                    if let Some(sections) = sections { work.extend(retained_class_work(sections)); }
                    if let Some(key) = self.view.learning_key() {
                        let key = if self.practice_cache.contains_key(&key) {
                            format!("CLASS/{class_id}/recovery-{}", uuid::Uuid::new_v4())
                        } else { key };
                        self.practice_cache.insert(key, self.view.clone());
                    }
                }
                self.bump_gen();
                self.view = View::ClassPrelude { course, class_id, value: None, in_flight: false,
                    error: Some("The class changed. Your local work remains in memory below. Copy it before exiting; it will not be submitted to changed exercises.".into()),
                    scroll: 0, polls: 0, retained_work: work };
                self.render();
                return;
            }
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
                    if let View::Class { sections, cursor, progress, attempt, material_source, previous_work: history, history_open, history_scroll, history_audio: audio, .. } = &mut self.view {
                        *cursor = built.iter().position(|section| !crate::app::state::section_complete(section)).unwrap_or(0);
                        *sections = Some(built);
                        let snapshot = serde_json::to_value(resp).unwrap_or_default();
                        *material_source = snapshot["taskMaterialRevision"].as_str().map(str::to_string);
                        progress.revision = snapshot["progressRevision"].as_i64().unwrap_or_default();
                        *attempt = snapshot["attempt"].as_i64().unwrap_or(1);
                        *history = previous_work(resp);
                        *audio = history_audio(resp);
                        if history.is_empty() { *history_open = false; }
                        *history_scroll = 0;
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
                    if let View::Class { attempt, previous_work: history, history_audio: audio, .. } = &mut self.view {
                        *attempt = serde_json::to_value(resp).unwrap_or_default()["attempt"].as_i64().unwrap_or(1);
                        *history = previous_work(resp);
                        *audio = history_audio(resp);
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
            self.quarantine_pending_class_audio(req_gen);
            return;
        }
        if let Some(pending) = self.pending_class_audio.get(&req_gen).cloned() {
            let owner_matches = self.config.active_profile().is_some_and(|profile| {
                pending.owner == (profile.server_url.trim_end_matches('/').to_string(), profile.api_key.clone())
            });
            if !owner_matches || self.current_class_recording_binding().as_ref() != Some(&pending.target) {
                self.quarantine_pending_class_audio(req_gen);
                if owner_matches {
                    let message = format!("The recording target changed. The local copy remains at {}", pending.path.display());
                    let mut found = false;
                    if let View::Class { class_id, sections: Some(sections), .. } = &mut self.view
                        && class_id == &pending.target.0 {
                        for section in sections {
                            if let SectionProgress::Speaking { prompts, index, phase } = &mut section.progress
                                && let Some(position) = prompts.iter().position(|prompt| prompt.id == pending.target.1) {
                                found = true;
                                let unknown = SpeakingPhase::UnknownUpload { message: message.clone() };
                                if *index == position { *phase = unknown.clone(); }
                                section.work.insert(pending.target.1.clone(), ProductiveWork::Speaking(unknown));
                            }
                        }
                    }
                    if !found && let View::Class { course, class_id, .. } = &self.view
                        && class_id == &pending.target.0 {
                        let course = course.clone();
                        let class_id = class_id.clone();
                        let retained_work = match &pending.origin {
                            View::Class { sections: Some(sections), .. } => retained_class_work(sections),
                            _ => Vec::new(),
                        };
                        self.cache_practice();
                        self.bump_gen();
                        self.view = View::ClassPrelude { course, class_id, value: None, in_flight: false,
                            error: Some(message.clone()), scroll: 0, polls: 0, retained_work };
                    }
                    self.status_bar.set_error(message);
                } else {
                    self.bump_gen();
                    self.view = View::Error { message: "The recording belongs to another account. Return to that account to recover it.".into(), retry: super::state::RetryKind::Courses };
                    self.status_bar.set_error("The recording belongs to another account. Return to that account to recover it.".into());
                }
                self.render();
                return;
            }
        }
        if let Ok(resp) = result.as_ref()
            && (resp.recording_id.trim().is_empty() || resp.recording_id.trim() != resp.recording_id || resp.status != "PENDING")
        {
            let message = self.pending_class_audio.get(&req_gen).map_or_else(
                || "The upload receipt is incomplete. Its outcome is unknown.".into(),
                |pending| format!("The upload receipt is incomplete. Recording saved at {}", pending.path.display()),
            );
            if let Some(section) = self.current_section_mut()
                && let SectionProgress::Speaking { phase, .. } = &mut section.progress {
                *phase = SpeakingPhase::UnknownUpload { message };
            }
            if let Some(section) = self.current_section_mut() { section.remember_productive_work(); }
            self.render();
            return;
        }
        match result.as_ref() {
            Ok(resp) => {
                if let Some(pending) = self.pending_class_audio.remove(&req_gen)
                    && let Err(error) = std::fs::remove_file(&pending.path) {
                    self.status_bar.set_error(format!("Recording was uploaded, but the local copy remains at {}: {error}", pending.path.display()));
                    self.pending_class_audio.insert(req_gen, pending);
                }
                let recording_id = resp.recording_id.clone();
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { phase, prompts, index } = &mut section.progress
                {
                    if let Some(prompt) = prompts.get_mut(*index) { prompt.recording_id = Some(recording_id.clone()); }
                    *phase = SpeakingPhase::Polling {
                        recording_id: recording_id.clone(),
                    };
                }
                if let Some(section) = self.current_section_mut() { section.remember_productive_work(); }
                self.class_poll_grade(recording_id, req_gen);
            }
            Err(message) => {
                if let Some(section) = self.current_section_mut()
                    && let SectionProgress::Speaking { phase, .. } = &mut section.progress
                {
                    *phase = if message.starts_with("Recording was not submitted.") {
                        SpeakingPhase::Failed { message: message.clone() }
                    } else {
                        SpeakingPhase::UnknownUpload {
                            message: format!("Upload outcome is unknown and cannot be confirmed automatically. {message}"),
                        }
                    };
                }
                self.mark_practice_progress();
                self.status_bar.set_error(message.clone());
            }
        }
        self.render();
    }

    fn quarantine_pending_class_audio(&mut self, req_gen: u64) {
        let Some(pending) = self.pending_class_audio.get(&req_gen).cloned() else { return; };
        let mut origin = pending.origin;
        origin.mark_abandoned_uploads_unknown(Some(pending.path.as_path()));
        let key = format!("CLASS/{}/recovery-upload-{req_gen}", pending.target.0);
        let current = self.config.active_profile().map(|profile| (
            profile.server_url.trim_end_matches('/').to_string(), profile.api_key.clone(),
        ));
        let cache = if current.as_ref() == Some(&pending.owner) {
            &mut self.practice_cache
        } else {
            self.account_practice_cache.entry(pending.owner).or_default()
        };
        cache.entry(key).or_insert(origin);
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
