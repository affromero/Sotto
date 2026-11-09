impl App {
    pub(super) fn class_history_toggle(&mut self) {
        if let View::Class { previous_work, history_open, history_scroll, history_audio, .. }
            | View::ClassRepair { previous_work, history_open, history_scroll, history_audio, .. } = &mut self.view
            && (*history_open || !previous_work.is_empty()) {
            *history_open = !*history_open;
            *history_scroll = 0;
            history_audio.pending = None;
            history_audio.note = None;
            if let Some(task) = self.history_audio_task.take() { task.abort(); }
            if let Some(player) = &self.player { player.stop(); }
            self.render();
        }
    }

    pub(super) fn class_history_audio_move(&mut self, next: bool) {
        if let View::Class { history_open: true, history_audio, .. }
            | View::ClassRepair { history_open: true, history_audio, .. } = &mut self.view {
            if history_audio.items.is_empty() { return; }
            let cursor = if next { (history_audio.cursor + 1).min(history_audio.items.len() - 1) }
                else { history_audio.cursor.saturating_sub(1) };
            if cursor == history_audio.cursor { return; }
            history_audio.cursor = cursor;
            history_audio.pending = None;
            history_audio.note = None;
            if let Some(task) = self.history_audio_task.take() { task.abort(); }
            if let Some(player) = &self.player { player.stop(); }
            self.render();
        }
    }

    pub(super) fn class_history_audio_play(&mut self) {
        let (class_id, item, request) = match &mut self.view {
            View::Class { class_id, history_open: true, history_audio, .. }
            | View::ClassRepair { class_id, history_open: true, history_audio, .. } => {
                if history_audio.pending.is_some() { return; }
                let Some(item) = history_audio.items.get(history_audio.cursor).cloned() else { return; };
                let request = uuid::Uuid::new_v4();
                history_audio.pending = Some(request);
                history_audio.note = Some("Loading saved recording".into());
                (class_id.clone(), item, request)
            }
            _ => return,
        };
        if let Some(player) = &self.player { player.stop(); }
        let client = Arc::clone(&self.client);
        let (request_class, request_prompt, request_recording) = (class_id.clone(), item.prompt_id.clone(), item.recording_id.clone());
        if let Some(task) = self.history_audio_task.take() { task.abort(); }
        let generation = self.request_gen;
        let sender = self.action_tx.clone();
        let task = tokio::spawn(async move {
            let result = client.class_history_audio(&request_class, &request_prompt, &request_recording)
                .await.map_err(|error| error.to_string());
            let _ = sender.send(Action::ClassHistoryAudioDownloaded(generation, request, class_id,
                item.prompt_id, item.recording_id, Arc::new(result)));
        });
        self.history_audio_task = Some(task.abort_handle());
        self.render();
    }

    pub(super) fn on_class_history_audio_downloaded(&mut self, generation: u64, request: uuid::Uuid,
        class_id: &str, prompt_id: &str, recording_id: &str, result: ApiResult<Vec<u8>>) {
        if !self.is_current(generation) { return; }
        let active = match &self.view {
            View::Class { class_id: current, history_open: true, history_audio, .. }
            | View::ClassRepair { class_id: current, history_open: true, history_audio, .. } => {
                current == class_id && history_audio.pending == Some(request) &&
                    history_audio.items.get(history_audio.cursor).is_some_and(|item|
                        item.prompt_id == prompt_id && item.recording_id == recording_id)
            }
            _ => false,
        };
        if !active { return; }
        self.history_audio_task = None;
        let note = match result.as_ref() {
            Err(message) => format!("Recording unavailable: {message}"),
            Ok(bytes) => {
                if self.player.is_none() { self.player = AudioPlayer::new().ok(); }
                match &self.player {
                    Some(player) => match player.play(bytes.clone()) {
                        Ok(()) => "Playing saved recording".into(),
                        Err(error) => format!("Could not play recording: {error}"),
                    },
                    None => "Audio playback is unavailable".into(),
                }
            }
        };
        if let View::Class { history_audio, .. } | View::ClassRepair { history_audio, .. } = &mut self.view {
            history_audio.pending = None;
            history_audio.note = Some(note);
        }
        self.render();
    }

    pub(super) fn class_history_scroll(&mut self, down: bool) {
        if let View::Class { history_open: true, history_scroll, .. }
            | View::ClassRepair { history_open: true, history_scroll, .. } = &mut self.view {
            *history_scroll = if down { history_scroll.saturating_add(1) } else { history_scroll.saturating_sub(1) };
            self.render();
        }
    }
    pub(super) fn class_direction_scroll(&mut self, down: bool) {
        let View::Class {
            sections: Some(sections),
            cursor,
            directions: Some(directions),
            direction_scroll,
            ..
        } = &mut self.view
        else {
            return;
        };
        let Some(key) = sections
            .get(*cursor)
            .and_then(ClassSection::current_task_key)
        else {
            return;
        };
        if !directions.tasks.contains_key(&key) {
            return;
        }
        let offset = direction_scroll.entry(key).or_default();
        *offset = if down {
            offset.saturating_add(1)
        } else {
            offset.saturating_sub(1)
        };
        self.render();
    }

    pub(super) fn dispatch_class_prelude<F>(&mut self, req_gen: u64, task: F)
    where
        F: std::future::Future<Output = color_eyre::Result<types::ClassPreludeResponse>>
            + Send
            + 'static,
    {
        if let Some(previous) = self.prelude_task.take() {
            previous.abort();
        }
        let sender = self.action_tx.clone();
        let handle = tokio::spawn(async move {
            let result = match tokio::time::timeout(std::time::Duration::from_secs(30), task).await
            {
                Ok(result) => result.map_err(|error| error.to_string()),
                Err(_) => Err("The request timed out. Check saved status.".into()),
            };
            let _ = sender.send(Action::ClassPreludeLoaded(req_gen, Arc::new(result)));
        });
        self.prelude_task = Some(handle.abort_handle());
    }
    pub(super) fn on_class_prelude_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<types::ClassPreludeResponse>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let View::ClassPrelude { class_id, .. } = &self.view else {
            return;
        };
        let class_id = class_id.clone();
        let parsed = result
            .as_ref()
            .as_ref()
            .map_err(Clone::clone)
            .and_then(|response| {
                let value = serde_json::to_value(response).map_err(|e| e.to_string())?;
                validate_class_prelude(&value)?;
                Ok(value)
            });
        let mut poll = false;
        match parsed {
            Ok(value) => {
                let kind = value["kind"].as_str().unwrap_or_default();
                if kind == "ADDENDUM" && value["acknowledged"] == true {
                    let receipt = value["receiptId"].as_str().unwrap_or_default().to_string();
                    let source = value["request"]["sourceHash"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let languages = (
                        value["nativeLang"].as_str().unwrap_or_default().to_string(),
                        value["targetLang"].as_str().unwrap_or_default().to_string(),
                    );
                    if let View::ClassPrelude {
                        in_flight,
                        value: saved,
                        ..
                    } = &mut self.view
                    {
                        *in_flight = true;
                        *saved = Some(value);
                    }
                    let client = Arc::clone(&self.client);
                    self.dispatch(
                        req_gen,
                        async move {
                            tokio::time::timeout(std::time::Duration::from_secs(30), async move {
                                let detail = client.class(&class_id).await?;
                                let prerequisite = client.class_prerequisite(&class_id).await?;
                                let directions = validate_class_directions(
                                    &detail,
                                    &prerequisite,
                                    &class_id,
                                    &receipt,
                                    &source,
                                    &languages,
                                )
                                .map_err(|error| color_eyre::eyre::eyre!(error))?;
                                Ok(crate::api::ClassPreludeMaterial {
                                    detail,
                                    directions: Some(directions),
                                })
                            })
                            .await
                            .map_err(|_| {
                                color_eyre::eyre::eyre!(
                                    "The request timed out. Check saved status."
                                )
                            })?
                        },
                        Action::ClassPreludeMaterialLoaded,
                    );
                } else if ["NOT_REQUIRED", "REPLAY"].contains(&kind)
                    || value["acknowledged"] == true
                {
                    if let View::ClassPrelude {
                        in_flight,
                        value: saved,
                        ..
                    } = &mut self.view
                    {
                        *in_flight = true;
                        *saved = Some(value);
                    }
                    let client = Arc::clone(&self.client);
                    self.dispatch(
                        req_gen,
                        async move {
                            let detail = tokio::time::timeout(
                                std::time::Duration::from_secs(30),
                                client.class(&class_id),
                            )
                            .await
                            .map_err(|_| {
                                color_eyre::eyre::eyre!(
                                    "The request timed out. Check saved status."
                                )
                            })??;
                            if detail.id != class_id {
                                return Err(color_eyre::eyre::eyre!(
                                    "The class changed. Check saved status."
                                ));
                            }
                            Ok(crate::api::ClassPreludeMaterial {
                                detail,
                                directions: None,
                            })
                        },
                        Action::ClassPreludeMaterialLoaded,
                    );
                } else if let View::ClassPrelude {
                    value: stored,
                    in_flight,
                    error,
                    polls,
                    ..
                } = &mut self.view
                {
                    let pending = value["kind"] == "GENERATING" || value["status"] == "PENDING";
                    if pending && *polls < 300 {
                        *polls += 1;
                        poll = true;
                    }
                    *stored = Some(value);
                    *in_flight = false;
                    *error = if pending && !poll {
                        Some("This is taking longer than expected. Check saved status.".into())
                    } else {
                        None
                    };
                }
            }
            Err(message) => {
                if let View::ClassPrelude {
                    value,
                    in_flight,
                    error,
                    ..
                } = &mut self.view
                {
                    *value = None;
                    *in_flight = false;
                    *error = Some(message);
                }
            }
        }
        if poll {
            self.class_prelude_dispatch(true);
        }
        self.render();
    }

    pub(super) fn on_class_prelude_material_loaded(
        &mut self,
        req_gen: u64,
        result: ApiResult<crate::api::ClassPreludeMaterial>,
    ) {
        if !self.is_current(req_gen) {
            return;
        }
        let View::ClassPrelude {
            course,
            class_id,
            value,
            ..
        } = &self.view
        else {
            return;
        };
        let course = course.clone();
        let class_id = class_id.clone();
        let replay = value.as_ref().is_some_and(|item| item["kind"] == "REPLAY");
        match result.as_ref() {
            Ok(material) => {
                if let Some(work) = conflicting_cached_class_work(
                    &self.practice_cache,
                    &class_id,
                    &material.detail,
                    replay,
                ) {
                    if let View::ClassPrelude {
                        in_flight,
                        error,
                        retained_work,
                        ..
                    } = &mut self.view
                    {
                        *in_flight = false;
                        *retained_work = work;
                        *error = Some("The class changed. Your local work remains in memory below. Copy it before exiting; it will not be submitted to changed exercises.".into());
                    }
                    self.render();
                    return;
                }
                self.view = View::class_view(course, class_id);
                self.on_class_loaded(req_gen, Arc::new(Ok(material.detail.clone())));
                if let View::Class { directions, .. } = &mut self.view {
                    *directions = material.directions.clone();
                }
            }
            Err(message) => {
                if let View::ClassPrelude {
                    value,
                    in_flight,
                    error,
                    ..
                } = &mut self.view
                {
                    *value = None;
                    *in_flight = false;
                    *error = Some(message.clone());
                }
            }
        }
        self.render();
    }

    pub(super) fn class_prelude_read(&mut self) {
        if let View::ClassPrelude {
            polls,
            in_flight: false,
            ..
        } = &mut self.view
        {
            *polls = 0;
        }
        self.class_prelude_dispatch(false);
    }

    fn class_prelude_dispatch(&mut self, delay: bool) {
        let View::ClassPrelude {
            class_id,
            value,
            in_flight,
            error,
            ..
        } = &mut self.view
        else {
            return;
        };
        if *in_flight {
            return;
        }
        *in_flight = true;
        *error = None;
        let class_id = class_id.clone();
        let recovery = value
            .as_ref()
            .filter(|v| v["status"] == "PENDING" && v["recoverable"] == true)
            .and_then(|v| {
                serde_json::from_value::<types::ClassPrerequisiteRequest>(v["request"].clone()).ok()
            });
        let client = Arc::clone(&self.client);
        let req_gen = self.request_gen;
        self.dispatch_class_prelude(req_gen, async move {
            if delay {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            match recovery {
                Some(request) => client.prepare_class_prelude(&class_id, request, true).await,
                None => client.class_prelude(&class_id).await,
            }
        });
        self.render();
    }

    pub(super) fn class_prelude_select(&mut self) {
        let View::ClassPrelude {
            class_id,
            value: Some(value),
            in_flight,
            ..
        } = &mut self.view
        else {
            return;
        };
        if *in_flight {
            return;
        }
        let kind = value["kind"].as_str().unwrap_or_default();
        let status = value["status"].as_str().unwrap_or_default();
        let class_id = class_id.clone();
        let client = Arc::clone(&self.client);
        let req_gen = self.request_gen;
        if kind == "ADDENDUM"
            && (status == "AVAILABLE"
                || (["FAILED", "STALE"].contains(&status) && value["canRetry"] == true))
        {
            let Ok(request) =
                serde_json::from_value::<types::ClassPrerequisiteRequest>(value["request"].clone())
            else {
                return;
            };
            *in_flight = true;
            self.dispatch_class_prelude(req_gen, async move {
                client
                    .prepare_class_prelude(&class_id, request, false)
                    .await
            });
        } else if (kind == "BASE" || (kind == "ADDENDUM" && status == "READY"))
            && value["acknowledged"] == false
        {
            let receipt = value["receiptId"].as_str().unwrap_or_default().to_string();
            let kind = kind.to_string();
            let Ok(request) = serde_json::from_value::<types::ClassPreludeAcknowledgment>(
                serde_json::json!({"kind": kind, "receiptId": receipt}),
            ) else {
                return;
            };
            *in_flight = true;
            self.dispatch_class_prelude(req_gen, async move {
                let accepted = client.acknowledge_class_prelude(&class_id, request).await?;
                let accepted = serde_json::to_value(accepted)?;
                if accepted["kind"] != kind
                    || accepted["receiptId"] != receipt
                    || accepted["acknowledged"] != true
                {
                    return Err(color_eyre::eyre::eyre!(
                        "The lesson changed. Check saved status."
                    ));
                }
                let current = client.class_prelude(&class_id).await?;
                let check = serde_json::to_value(&current)?;
                if check["kind"] != kind
                    || check["receiptId"] != receipt
                    || check["acknowledged"] != true
                {
                    return Err(color_eyre::eyre::eyre!(
                        "The lesson changed. Check saved status."
                    ));
                }
                Ok(current)
            });
        }
        self.render();
    }
}

pub(super) fn conflicting_cached_class_work(
    cache: &std::collections::BTreeMap<String, View>,
    class_id: &str,
    detail: &types::ClassDetailResponse,
    replay: bool,
) -> Option<Vec<String>> {
    let detail_json = serde_json::to_value(detail).unwrap_or_default();
    let attempt = detail_json["attempt"].as_i64().unwrap_or(1);
    let key = format!("CLASS/{class_id}/{attempt}");
    let prefix = format!("CLASS/{class_id}/");
    let fresh = class_sections(detail);
    let mut mismatch = false;
    let mut work = Vec::new();
    for (cached_key, cached_view) in cache {
        let View::Class {
            sections: Some(cached),
            progress,
            directions,
            material_source,
            ..
        } = cached_view
        else {
            continue;
        };
        if !cached_key.starts_with(&prefix)
            || !(progress.dirty
                || progress.in_flight.is_some()
                || progress.conflict
                || cached_view.has_uncertain_upload())
        {
            continue;
        }
        let same_source = material_source
            .as_deref()
            .is_some_and(|source| detail_json["taskMaterialRevision"].as_str() == Some(source))
            && directions.as_ref().is_none_or(|saved| {
                detail_json["prerequisiteSourceHash"].as_str() == Some(saved.source_hash.as_str())
            });
        if cached_key != &key
            || replay
            || !same_source
            || fresh
                .as_ref()
                .is_none_or(|fresh| !same_class_tasks(cached, fresh))
        {
            mismatch = true;
            work.extend(retained_class_work(cached));
        }
    }
    mismatch.then_some(work)
}

fn validate_class_prelude(value: &serde_json::Value) -> Result<(), String> {
    let kind = value["kind"].as_str().unwrap_or_default();
    if ["NOT_REQUIRED", "REPLAY", "GENERATING", "UNAVAILABLE"].contains(&kind) {
        return Ok(());
    }
    let valid_receipt = value["receiptId"]
        .as_str()
        .and_then(|s| uuid::Uuid::parse_str(s).ok())
        .is_some();
    if kind == "BASE"
        && valid_receipt
        && value["acknowledged"].is_boolean()
        && value["teaching"].is_object()
    {
        return Ok(());
    }
    if kind == "ADDENDUM" {
        let status = value["status"].as_str().unwrap_or_default();
        let digest = |v: &serde_json::Value| {
            v.as_str().is_some_and(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        };
        if !digest(&value["request"]["sourceHash"]) || !digest(&value["request"]["snapshotHash"]) {
            return Err("Invalid prerequisite revision.".into());
        }
        if status == "READY"
            && valid_receipt
            && value["acknowledged"].is_boolean()
            && value["content"].is_object()
        {
            return Ok(());
        }
        if [
            "AVAILABLE",
            "UNAVAILABLE",
            "PENDING",
            "UNRESOLVED",
            "FAILED",
            "STALE",
        ]
        .contains(&status)
            && value["receiptId"].is_null()
            && value["content"].is_null()
            && value["acknowledged"].is_null()
            && (!["FAILED", "STALE"].contains(&status) || value["canRetry"].is_boolean())
        {
            return Ok(());
        }
    }
    Err("Prerequisite teaching is incomplete. Check saved status.".into())
}

pub(super) fn validate_class_directions(
    detail: &types::ClassDetailResponse,
    prerequisite: &types::ClassPrerequisiteResponse,
    class_id: &str,
    receipt: &str,
    source: &str,
    languages: &(String, String),
) -> Result<crate::api::ClassDirections, String> {
    let invalid =
        || "The class or prerequisite directions changed. Check saved status.".to_string();
    let class = serde_json::to_value(detail).map_err(|_| invalid())?;
    let saved = serde_json::to_value(prerequisite).map_err(|_| invalid())?;
    if class["id"] != class_id
        || saved["status"] != "READY"
        || saved["acknowledged"] != true
        || saved["receiptId"] != receipt
        || saved["request"]["sourceHash"] != source
        || class["prerequisiteSourceHash"] != source
        || saved["nativeLang"] != languages.0
        || saved["targetLang"] != languages.1
    {
        return Err(invalid());
    }
    let mut expected = std::collections::BTreeSet::new();
    for section in class["sections"].as_array().ok_or_else(invalid)? {
        let section_id = section["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(invalid)?;
        for (field, kind) in [
            ("questions", "question"),
            ("prompts", "speaking"),
            ("writingPrompts", "writing"),
        ] {
            for item in section[field].as_array().ok_or_else(invalid)? {
                let id = item["id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or_else(invalid)?;
                if !expected.insert((section_id.to_string(), kind.to_string(), id.to_string())) {
                    return Err(invalid());
                }
            }
        }
    }
    if expected.is_empty() {
        return Err(invalid());
    }
    let mut tasks = std::collections::BTreeMap::new();
    for item in saved["content"]["directions"]["tasks"]
        .as_array()
        .ok_or_else(invalid)?
    {
        let section = item["sectionId"].as_str().ok_or_else(invalid)?;
        let kind = item["kind"].as_str().ok_or_else(invalid)?;
        let id = item["taskId"].as_str().ok_or_else(invalid)?;
        let instruction = item["instruction"]
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 1000)
            .ok_or_else(invalid)?;
        let key = (section.to_string(), kind.to_string(), id.to_string());
        if !expected.contains(&key) || tasks.insert(key, instruction.to_string()).is_some() {
            return Err(invalid());
        }
    }
    if tasks.len() != expected.len() {
        return Err(invalid());
    }
    Ok(crate::api::ClassDirections {
        source_hash: source.to_string(),
        tasks,
    })
}

pub(super) fn same_class_tasks(cached: &[ClassSection], fresh: &[ClassSection]) -> bool {
    fn static_tasks(section: &ClassSection) -> serde_json::Value {
        match &section.progress {
            SectionProgress::Mc { questions, .. } => serde_json::json!(
                questions
                    .iter()
                    .map(|q| (&q.id, &q.prompt, &q.options))
                    .collect::<Vec<_>>()
            ),
            SectionProgress::Listening {
                episode_id,
                questions,
                ..
            } => serde_json::json!((
                episode_id,
                questions
                    .iter()
                    .map(|q| (&q.id, &q.prompt, &q.options))
                    .collect::<Vec<_>>()
            )),
            SectionProgress::Speaking { prompts, .. } => serde_json::json!(
                prompts
                    .iter()
                    .map(|p| (&p.id, &p.target_phrase, &p.translation))
                    .collect::<Vec<_>>()
            ),
            SectionProgress::Writing { prompts, .. } => serde_json::json!(
                prompts
                    .iter()
                    .map(|p| (&p.id, &p.task, &p.guidance))
                    .collect::<Vec<_>>()
            ),
        }
    }
    cached.len() == fresh.len()
        && cached.iter().all(|old| {
            fresh
                .iter()
                .find(|new| new.id == old.id)
                .is_some_and(|new| old.skill == new.skill && static_tasks(old) == static_tasks(new))
        })
}

pub(super) fn retained_class_work(sections: &[ClassSection]) -> Vec<String> {
    let mut result = Vec::new();
    for section in sections {
        match &section.progress {
            SectionProgress::Mc {
                questions,
                selected,
                ..
            }
            | SectionProgress::Listening {
                questions,
                selected,
                ..
            } => {
                for (question, choice) in questions.iter().zip(selected) {
                    if let Some(answer) = choice.and_then(|index| question.options.get(index)) {
                        result.push(format!("{}\nYour choice: {}", question.prompt, answer));
                    }
                }
            }
            SectionProgress::Writing {
                prompts,
                index,
                input,
                ..
            } => {
                let mut drafts = std::collections::BTreeMap::new();
                for (id, work) in &section.work {
                    if let ProductiveWork::Writing { text, .. } = work {
                        drafts.insert(id.clone(), text.clone());
                    }
                }
                if let Some(prompt) = prompts.get(*index) {
                    drafts.insert(prompt.id.clone(), input.text());
                }
                for prompt in prompts {
                    if let Some(text) = drafts
                        .get(&prompt.id)
                        .filter(|text| !text.trim().is_empty())
                    {
                        result.push(format!("{}\nYour draft:\n{}", prompt.task, text));
                    }
                }
            }
            SectionProgress::Speaking {
                prompts,
                index,
                phase,
            } => {
                for (position, prompt) in prompts.iter().enumerate() {
                    let saved = if position == *index {
                        Some(phase)
                    } else {
                        match section.work.get(&prompt.id) {
                            Some(ProductiveWork::Speaking(saved)) => Some(saved),
                            _ => None,
                        }
                    };
                    if let Some(
                        SpeakingPhase::UnknownUpload { .. }
                        | SpeakingPhase::Uploading
                        | SpeakingPhase::Polling { .. },
                    ) = saved
                    {
                        let recording = match saved {
                            Some(SpeakingPhase::UnknownUpload { message }) => format!(" {message}"),
                            Some(SpeakingPhase::Polling { recording_id }) => {
                                format!(" Recording ID: {recording_id}.")
                            }
                            _ => prompt
                                .recording_id
                                .as_ref()
                                .map(|id| format!(" Recording ID: {id}."))
                                .unwrap_or_default(),
                        };
                        result.push(format!(
                            "{}\nRecording status is unconfirmed.{}",
                            prompt.target_phrase, recording
                        ));
                    }
                }
            }
        }
    }
    result
}
