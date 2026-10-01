use super::*;
use state::ProductiveWork;

impl App {
    pub(super) fn practice_tick(&mut self) {
        if matches!(&self.view, View::PracticePreparing { status, in_flight: false, admission_unknown: false, .. } if ["QUEUED", "RUNNING", "CANCELLING"].contains(&status.as_str()))
        {
            self.practice_check_status(false);
        }
        self.save_practice_progress();
    }

    pub(super) fn resume_recent_practice(
        &mut self,
        course: Course,
        session: state::RecentPractice,
    ) {
        let request_id = match session.id.parse() {
            Ok(id) => id,
            Err(error) => {
                self.status_bar
                    .set_error(format!("Invalid practice identity: {error}"));
                return;
            }
        };
        let unknown = self.pending_admissions.contains_key(&request_id);
        self.bump_gen();
        self.view = View::PracticePreparing {
            course,
            request_id,
            kind: session.kind,
            status: session.status,
            message: "Loading saved practice.".into(),
            can_recover: false,
            in_flight: false,
            admission_unknown: unknown,
            recovery_confirmation: false,
        };
        self.practice_check_status(false);
        self.render();
    }

    pub(super) fn practice_check_status(&mut self, retry_admission: bool) {
        let (course_id, request_id, kind, unknown) = match &mut self.view {
            View::PracticePreparing {
                course,
                request_id,
                kind,
                in_flight,
                admission_unknown,
                ..
            } if !*in_flight => {
                *in_flight = true;
                (course.id.clone(), *request_id, *kind, *admission_unknown)
            }
            _ => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            self.request_gen,
            async move {
                let request = async {
                    if !retry_admission {
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    }
                    if retry_admission && unknown {
                        client.start_practice(&course_id, kind, request_id).await
                    } else {
                        client.resume_practice(&request_id.to_string()).await
                    }
                };
                tokio::time::timeout(std::time::Duration::from_secs(30), request)
                    .await
                    .map_err(|_| {
                        color_eyre::eyre::eyre!(
                            "Practice status timed out. The saved request can be checked again."
                        )
                    })?
            },
            Action::PracticeStarted,
        );
    }

    pub(super) fn practice_change_preparation(&mut self, recover: bool) {
        let id = match &mut self.view {
            View::PracticePreparing {
                request_id,
                in_flight,
                can_recover,
                recovery_confirmation,
                ..
            } if !*in_flight => {
                if recover {
                    if !*can_recover {
                        return;
                    }
                    if !*recovery_confirmation {
                        *recovery_confirmation = true;
                        self.render();
                        return;
                    }
                }
                *in_flight = true;
                request_id.to_string()
            }
            _ => return,
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            self.request_gen,
            async move {
                let response = tokio::time::timeout(
                    std::time::Duration::from_secs(30),
                    client.practice_generation_action(&id, recover),
                )
                .await
                .map_err(|_| {
                    color_eyre::eyre::eyre!("Preparation action timed out. Check its saved status.")
                })??;
                Ok(types::StartPracticeResponse::Preparing(response))
            },
            Action::PracticeStarted,
        );
    }

    pub(super) fn class_resume_current_speaking(&self) {
        if let Some(SectionProgress::Speaking {
            phase: SpeakingPhase::Polling { recording_id },
            ..
        }) = self.current_section().map(|section| &section.progress)
        {
            self.class_poll_grade(recording_id.clone(), self.request_gen);
        }
    }

    pub(super) fn mark_practice_progress(&mut self) {
        if let Some(section) = self.current_section_mut() {
            section.remember_productive_work();
        }
        if let Some(progress) = self.view.learning_progress_mut() {
            progress.dirty = true;
        }
    }

    pub(super) fn save_practice_progress(&mut self) {
        if let Some(section) = self.current_section_mut() {
            section.remember_productive_work();
        }
        let Some(id) = self.view.learning_key() else {
            return;
        };
        let (id, sequence, body) = match &mut self.view {
            View::Practice {
                sections: Some(sections),
                progress,
                ..
            }
            | View::Class {
                sections: Some(sections),
                progress,
                ..
            } if progress.dirty && progress.in_flight.is_none() && !progress.conflict => {
                self.progress_sequence += 1;
                let sequence = self.progress_sequence;
                progress.sequence = sequence;
                let answers: std::collections::BTreeMap<String, i64> =
                    state::collect_class_answers(sections)
                        .iter()
                        .map(|answer| (answer.question_id.clone(), answer.selected_index))
                        .collect();
                let drafts: std::collections::BTreeMap<String, String> = sections
                    .iter()
                    .flat_map(|section| section.work.iter())
                    .filter_map(|(id, work)| match work {
                        ProductiveWork::Writing { text, .. } => Some((id.clone(), text.clone())),
                        _ => None,
                    })
                    .collect();
                let body = match serde_json::from_value(serde_json::json!({
                    "expectedRevision": progress.revision, "answers": answers, "writingDrafts": drafts
                })) {
                    Ok(body) => body,
                    Err(error) => {
                        progress.conflict = true;
                        self.status_bar
                            .set_error(format!("Drafts are preserved locally. {error}"));
                        return;
                    }
                };
                progress.in_flight = Some(sequence);
                progress.dirty = false;
                (id, sequence, body)
            }
            _ => return,
        };
        let client = Arc::clone(&self.client);
        let tx = self.action_tx.clone();
        tokio::spawn(async move {
            let (is_class, target) = id
                .strip_prefix("CLASS/")
                .map(|target| (true, target.split('/').next().unwrap_or_default()))
                .unwrap_or((false, id.as_str()));
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                client.save_learning_progress(is_class, target, body),
            )
            .await
            .map_err(|_| "Progress save timed out. Local work is preserved.".to_string())
            .and_then(|result| result.map_err(|error| error.to_string()));
            let _ = tx.send(Action::PracticeProgressSaved(
                id,
                sequence,
                Arc::new(result),
            ));
        });
    }

    pub(super) fn on_practice_progress_saved(
        &mut self,
        id: String,
        sequence: u64,
        result: ApiResult<types::LearningProgressResponse>,
    ) {
        let target = if self.view.learning_key().as_ref() == Some(&id)
            && self
                .view
                .learning_progress_mut()
                .is_some_and(|progress| progress.in_flight == Some(sequence))
        {
            Some(&mut self.view)
        } else {
            self.practice_cache.get_mut(&id)
        };
        let Some(progress) = target.and_then(View::learning_progress_mut) else {
            return;
        };
        if progress.in_flight != Some(sequence) {
            return;
        }
        progress.in_flight = None;
        match result.as_ref() {
            Ok(response) => progress.revision = response.progress_revision.get() as i64,
            Err(message) => {
                progress.dirty = true;
                progress.conflict = true;
                self.status_bar
                    .set_error(format!("Your local answers are preserved. {message}"));
            }
        }
        self.render();
    }

    pub(super) fn cache_practice(&mut self) {
        self.save_practice_progress();
        if let Some(id) = self.view.learning_key() {
            self.practice_cache.insert(id, self.view.clone());
        }
    }

    pub(super) fn reconcile_practice_progress(&mut self) {
        let Some(id) = self.view.learning_key() else {
            return;
        };
        match self.view.learning_progress_mut() {
            Some(progress) if progress.conflict && progress.in_flight.is_none() => {
                if !progress.reconcile_confirmation {
                    progress.reconcile_confirmation = true;
                    self.render();
                    return;
                }
                self.progress_sequence += 1;
                progress.in_flight = Some(self.progress_sequence);
            }
            _ => return,
        };
        let sequence = self.progress_sequence;
        let client = Arc::clone(&self.client);
        let tx = self.action_tx.clone();
        tokio::spawn(async move {
            let request = async {
                if let Some(target) = id.strip_prefix("CLASS/") {
                    serde_json::to_value(
                        client
                            .class(target.split('/').next().unwrap_or_default())
                            .await?,
                    )
                    .map_err(Into::into)
                } else {
                    serde_json::to_value(client.resume_practice(&id).await?).map_err(Into::into)
                }
            };
            let result = tokio::time::timeout(std::time::Duration::from_secs(30), request)
                .await
                .map_err(|_| "Progress status timed out. Local work is preserved.".to_string())
                .and_then(|result: color_eyre::Result<serde_json::Value>| {
                    result.map_err(|error| error.to_string())
                });
            let _ = tx.send(Action::PracticeReconciled(id, sequence, Arc::new(result)));
        });
    }

    pub(super) fn on_practice_reconciled(
        &mut self,
        id: String,
        sequence: u64,
        result: ApiResult<serde_json::Value>,
    ) {
        let target = if self.view.learning_key().as_ref() == Some(&id)
            && self
                .view
                .learning_progress_mut()
                .is_some_and(|progress| progress.in_flight == Some(sequence))
        {
            Some(&mut self.view)
        } else {
            self.practice_cache.get_mut(&id)
        };
        let Some(progress) = target.and_then(View::learning_progress_mut) else {
            return;
        };
        if progress.in_flight != Some(sequence) {
            return;
        }
        progress.in_flight = None;
        progress.reconcile_confirmation = false;
        let response = match result.as_ref() {
            Ok(response) => Ok(response.clone()),
            Err(error) => Err(error.clone()),
        };
        match response {
            Ok(response)
                if (response["sessionId"] == id && response["submissionResult"].is_null())
                    || (id.strip_prefix("CLASS/").is_some_and(|target| {
                        let mut parts = target.split('/');
                        response["id"] == parts.next().unwrap_or_default()
                            && response["attempt"].as_i64()
                                == parts.next().and_then(|attempt| attempt.parse().ok())
                    }) && ["AVAILABLE", "IN_PROGRESS"]
                        .contains(&response["status"].as_str().unwrap_or_default())) =>
            {
                if let Some(revision) = response["progressRevision"].as_i64() {
                    progress.revision = revision;
                    progress.conflict = false;
                    progress.dirty = true;
                }
            }
            Ok(_) => self.status_bar.set_error(
                "This session changed or was completed. Local work is preserved.".into(),
            ),
            Err(error) => self
                .status_bar
                .set_error(format!("Local work is preserved. {error}")),
        }
        self.render();
    }

    pub(super) fn play_speaking_reference(&mut self) {
        let url = self
            .current_section()
            .and_then(|section| match &section.progress {
                SectionProgress::Speaking { prompts, index, .. } => prompts
                    .get(*index)
                    .and_then(|prompt| prompt.reference_tts_url.clone()),
                _ => None,
            });
        let Some(url) = url else {
            self.status_bar
                .set_error("Reference audio is unavailable for this prompt.".into());
            self.render();
            return;
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            self.request_gen,
            async move { client.download(&url).await },
            Action::ClassAudioDownloaded,
        );
    }

    pub(super) fn submit_full_practice(&mut self) {
        self.mark_practice_progress();
        let (id, answers) = match &mut self.view {
            View::Practice {
                session_id,
                sections: Some(sections),
                submitting,
                ..
            } if !*submitting && state::class_ready_to_submit(sections) => {
                let answers = state::collect_class_answers(sections)
                    .into_iter()
                    .map(|answer| {
                        Ok(types::SubmitPracticeRequestAnswersItem {
                            item_id: types::SubmitPracticeRequestAnswersItemItemId::try_from(
                                answer.question_id,
                            )
                            .map_err(|error| error.to_string())?,
                            selected_index: answer.selected_index,
                        })
                    })
                    .collect::<std::result::Result<Vec<_>, String>>();
                let answers = match answers {
                    Ok(answers) => answers,
                    Err(error) => {
                        self.status_bar.set_error(error);
                        return;
                    }
                };
                *submitting = true;
                (session_id.clone(), answers)
            }
            _ => {
                self.status_bar
                    .set_error("Complete and grade every required prompt before finishing.".into());
                return;
            }
        };
        let client = Arc::clone(&self.client);
        self.dispatch(
            self.request_gen,
            async move { client.submit_practice(&id, answers).await },
            Action::Submitted,
        );
    }
}
