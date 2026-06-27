impl SottoClient {
    /// Build a client for `server_url`, authenticating every request with
    /// `api_key`.
    pub fn new(server_url: &str, api_key: &str) -> Result<Self> {
        let mut headers = reqwest::header::HeaderMap::new();
        let mut auth = reqwest::header::HeaderValue::from_str(&format!("Bearer {api_key}"))
            .map_err(|e| eyre!("invalid API key for Authorization header: {e}"))?;
        auth.set_sensitive(true);
        headers.insert(reqwest::header::AUTHORIZATION, auth);

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| eyre!("failed to build HTTP client: {e}"))?;

        // Unauthenticated client for downloading presigned/CDN URLs. Never
        // carries the Sotto bearer key, so the credential cannot leak to the
        // third-party host the presigned URL points at.
        let download_http = reqwest::Client::builder()
            .build()
            .map_err(|e| eyre!("failed to build download HTTP client: {e}"))?;

        let base_url = server_url.trim_end_matches('/').to_string();
        // Share the authenticated reqwest client with the generated client so
        // the multipart upload reuses one connection pool + the Bearer header.
        let inner = GeneratedClient::new_with_client(&base_url, http.clone());
        Ok(Self {
            inner,
            http,
            download_http,
            base_url,
        })
    }

    /// Access the underlying generated client for typed operation calls.
    pub fn raw(&self) -> &GeneratedClient {
        &self.inner
    }

    /// Liveness probe against `/api/v1/health`.
    pub async fn health(&self) -> Result<types::HealthResponse> {
        let resp = self
            .inner
            .health()
            .await
            .map_err(|e| eyre!("health check failed: {e}"))?;
        Ok(resp.into_inner())
    }

    /// List the courses available to the authenticated learner.
    pub async fn courses(&self) -> Result<types::CoursesListResponse> {
        let resp = self
            .inner
            .list_courses()
            .await
            .map_err(|e| eyre!("failed to list courses: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Fetch the practice overview (due counts + recent sessions) for a course.
    pub async fn practice_overview(
        &self,
        course_id: &str,
    ) -> Result<types::PracticeOverviewResponse> {
        let resp = self
            .inner
            .get_practice_overview(course_id)
            .await
            .map_err(|e| eyre!("failed to load practice overview: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Start a single-skill practice session for a course. The response is a
    /// discriminated union: `ready`/`ready_speaking`/`ready_writing` when a
    /// session was created, otherwise `unavailable` with a reason.
    pub async fn start_practice(
        &self,
        course_id: &str,
        kind: types::PracticeKind,
    ) -> Result<types::StartPracticeResponse> {
        let body = types::StartPracticeRequest {
            kind,
            focus_target_id: None,
        };
        let resp = self
            .inner
            .start_practice(course_id, &body)
            .await
            .map_err(|e| eyre!("failed to start practice: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Submit graded answers for a practice session and return the score.
    pub async fn submit_practice(
        &self,
        session_id: &str,
        answers: Vec<types::SubmitPracticeRequestAnswersItem>,
    ) -> Result<types::SubmitPracticeResponse> {
        let body = types::SubmitPracticeRequest { answers };
        let resp = self
            .inner
            .submit_practice(session_id, &body)
            .await
            .map_err(|e| eyre!("failed to submit practice answers: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Fetch episode detail (listening): ordered segments with playable URLs.
    pub async fn episode(&self, episode_id: &str) -> Result<types::EpisodeDetailResponse> {
        let resp = self
            .inner
            .get_episode(episode_id)
            .await
            .map_err(|e| eyre!("failed to load episode: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Poll grading status for an uploaded speaking attempt.
    pub async fn poll_speaking(
        &self,
        session_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        let resp = self
            .inner
            .poll_speaking(session_id, prompt_id, recording_id)
            .await
            .map_err(|e| eyre!("failed to poll speaking grade: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Upload a recorded WAV attempt for a practice speaking prompt.
    pub async fn upload_speaking(
        &self,
        session_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse> {
        let url = format!(
            "{}/api/v1/practice/{}/speaking/{}",
            self.base_url, session_id, prompt_id
        );
        self.upload_wav(&url, wav).await
    }

    /// POST a WAV as multipart (field `audio`, filename `attempt.wav`, mime
    /// `audio/wav`) to `url`. The Bearer header rides on the shared client.
    /// Shared by the practice and class speaking upload paths.
    async fn upload_wav(&self, url: &str, wav: Vec<u8>) -> Result<SpeakingUploadResponse> {
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("attempt.wav")
            .mime_str("audio/wav")
            .map_err(|e| eyre!("invalid audio mime: {e}"))?;
        let form = reqwest::multipart::Form::new().part("audio", part);

        let resp = self
            .http
            .post(url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| eyre!("speaking upload request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(eyre!("speaking upload failed ({status}): {body}"));
        }
        resp.json::<SpeakingUploadResponse>()
            .await
            .map_err(|e| eyre!("could not parse upload response: {e}"))
    }

    /// Download raw bytes from an absolute (presigned/CDN) URL.
    ///
    /// Uses the UNAUTHENTICATED [`Self::download_http`] client so the Sotto API
    /// key is never sent to the third-party host the presigned URL points at.
    /// Errors are reported without the URL, since presigned links carry
    /// credentials in their query string that must not be logged.
    pub async fn download(&self, url: &str) -> Result<Vec<u8>> {
        let resp = self
            .download_http
            .get(url)
            .send()
            .await
            // reqwest's error Display can embed the URL (with presigned
            // credentials); use the status-only kind here, not `{e}`.
            .map_err(|_| eyre!("audio download request failed"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(eyre!("audio download failed ({status})"));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|_| eyre!("could not read audio bytes"))?;
        Ok(bytes.to_vec())
    }

    // --- Classes ----------------------------------------------------------

    /// Create/advance to the next gated class. Hand-rolled (not progenitor-
    /// generated) because the route returns two distinct bodies by status:
    /// `201 { classId }` or `200 { done: true }`. Dispatches on the status into
    /// [`NextClassOutcome`]. The 409 "gated" case surfaces as an error.
    pub async fn next_class(&self, course_id: &str) -> Result<NextClassOutcome> {
        let url = format!("{}/api/v1/courses/{}/next-class", self.base_url, course_id);
        // The route accepts an optional `{ sourceUrl?, topic? }` body; an empty
        // object requests a normal curriculum class.
        let resp = self
            .http
            .post(&url)
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|e| eyre!("next-class request failed: {e}"))?;

        match resp.status().as_u16() {
            201 => {
                let body: types::NextClassCreatedResponse = resp
                    .json()
                    .await
                    .map_err(|e| eyre!("could not parse next-class (created): {e}"))?;
                Ok(NextClassOutcome::Created {
                    class_id: body.class_id,
                })
            }
            200 => {
                // 200 always carries { done: true }; parse to validate the shape.
                let _body: types::NextClassDoneResponse = resp
                    .json()
                    .await
                    .map_err(|e| eyre!("could not parse next-class (done): {e}"))?;
                Ok(NextClassOutcome::Done)
            }
            status => {
                let body = resp.text().await.unwrap_or_default();
                Err(eyre!("next-class failed ({status}): {body}"))
            }
        }
    }

    /// Fetch a class with its sections.
    pub async fn class(&self, class_id: &str) -> Result<types::ClassDetailResponse> {
        let resp = self
            .inner
            .get_class(class_id)
            .await
            .map_err(|e| eyre!("failed to load class: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Submit a class's MC answers and get the grade result.
    pub async fn submit_class(
        &self,
        class_id: &str,
        answers: Vec<types::SubmitClassRequestAnswersItem>,
    ) -> Result<types::SubmitClassResponse> {
        let body = types::SubmitClassRequest { answers };
        let resp = self
            .inner
            .submit_class(class_id, &body)
            .await
            .map_err(|e| eyre!("failed to submit class: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Upload a class speaking attempt (raw multipart at the class path).
    pub async fn upload_class_speaking(
        &self,
        class_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse> {
        let url = format!(
            "{}/api/v1/classes/{}/speaking/{}",
            self.base_url, class_id, prompt_id
        );
        self.upload_wav(&url, wav).await
    }

    /// Poll grading for a class speaking attempt (raw GET; same response shape
    /// as the generated practice poll).
    pub async fn poll_class_speaking(
        &self,
        class_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        let url = format!(
            "{}/api/v1/classes/{}/speaking/{}",
            self.base_url, class_id, prompt_id
        );
        self.poll_speaking_at(&url, recording_id).await
    }

    /// GET a speaking grading poll at `url` (raw; the response shape matches the
    /// generated practice poll). Shared by the class and exam speaking paths.
    async fn poll_speaking_at(
        &self,
        url: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        let resp = self
            .http
            .get(url)
            .query(&[("recordingId", recording_id)])
            .send()
            .await
            .map_err(|e| eyre!("speaking poll request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(eyre!("speaking poll failed ({status})"));
        }
        resp.json::<types::SpeakingPollResponse>()
            .await
            .map_err(|e| eyre!("could not parse speaking poll: {e}"))
    }

    /// Submit a class writing response (`{ text }`), graded synchronously.
    pub async fn submit_class_writing(
        &self,
        class_id: &str,
        prompt_id: &str,
        text: String,
    ) -> Result<WritingGradeResponse> {
        let url = format!(
            "{}/api/v1/classes/{}/writing/{}",
            self.base_url, class_id, prompt_id
        );
        self.submit_writing_at(&url, text).await
    }

    /// POST `{ text }` to a writing-grading `url`. Shared by the class and exam
    /// writing paths.
    async fn submit_writing_at(&self, url: &str, text: String) -> Result<WritingGradeResponse> {
        let resp = self
            .http
            .post(url)
            .json(&serde_json::json!({ "text": text }))
            .send()
            .await
            .map_err(|e| eyre!("writing submit request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(eyre!("writing submit failed ({status}): {body}"));
        }
        resp.json::<WritingGradeResponse>()
            .await
            .map_err(|e| eyre!("could not parse writing grade: {e}"))
    }

    // --- Exams ------------------------------------------------------------

    /// Start a mock exam for `course_id` at an optional CEFR level.
    pub async fn start_exam(
        &self,
        course_id: &str,
        level: Option<types::CefrLevel>,
    ) -> Result<types::StartExamResponse> {
        let course_id = types::StartExamRequestCourseId::try_from(course_id.to_string())
            .map_err(|e| eyre!("invalid course id: {e}"))?;
        let body = types::StartExamRequest { course_id, level };
        let resp = self
            .inner
            .start_exam(&body)
            .await
            .map_err(|e| eyre!("failed to start exam: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Fetch an exam with its sections (and result, once scored).
    pub async fn exam(&self, exam_id: &str) -> Result<types::ExamDetailResponse> {
        let resp = self
            .inner
            .get_exam(exam_id)
            .await
            .map_err(|e| eyre!("failed to load exam: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Submit an exam's MC answers and get the band/score result.
    pub async fn submit_exam(
        &self,
        exam_id: &str,
        answers: Vec<types::SubmitExamRequestAnswersItem>,
    ) -> Result<types::SubmitExamResponse> {
        let body = types::SubmitExamRequest { answers };
        let resp = self
            .inner
            .submit_exam(exam_id, &body)
            .await
            .map_err(|e| eyre!("failed to submit exam: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Upload an exam speaking attempt (raw multipart at the exam path).
    pub async fn upload_exam_speaking(
        &self,
        exam_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse> {
        let url = format!(
            "{}/api/v1/exams/{}/speaking/{}",
            self.base_url, exam_id, prompt_id
        );
        self.upload_wav(&url, wav).await
    }

    /// Poll grading for an exam speaking attempt.
    pub async fn poll_exam_speaking(
        &self,
        exam_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        let url = format!(
            "{}/api/v1/exams/{}/speaking/{}",
            self.base_url, exam_id, prompt_id
        );
        self.poll_speaking_at(&url, recording_id).await
    }

    /// Submit an exam writing response (`{ text }`), graded synchronously.
    pub async fn submit_exam_writing(
        &self,
        exam_id: &str,
        prompt_id: &str,
        text: String,
    ) -> Result<WritingGradeResponse> {
        let url = format!(
            "{}/api/v1/exams/{}/writing/{}",
            self.base_url, exam_id, prompt_id
        );
        self.submit_writing_at(&url, text).await
    }

    // --- Placement / memory / onboarding ----------------------------------

    /// Generate a placement batch for the `native`/`target` language pair.
    pub async fn generate_placement(
        &self,
        native: &str,
        target: &str,
    ) -> Result<types::GeneratePlacementResponse> {
        // Query params are generated alphabetically: (focusLevel, native, target).
        // The TUI runs a cold placement, so it never biases toward a level.
        let resp = self
            .inner
            .generate_placement(None, native, target)
            .await
            .map_err(|e| eyre!("failed to generate placement: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Submit placement answers; assigns a CEFR level and creates the course.
    pub async fn submit_placement(
        &self,
        native: &str,
        target: &str,
        answers: Vec<types::SubmitPlacementRequestAnswersItem>,
    ) -> Result<types::SubmitPlacementResponse> {
        let native = types::SubmitPlacementRequestNative::try_from(native.to_string())
            .map_err(|e| eyre!("invalid native language code: {e}"))?;
        let target = types::SubmitPlacementRequestTarget::try_from(target.to_string())
            .map_err(|e| eyre!("invalid target language code: {e}"))?;
        let body = types::SubmitPlacementRequest {
            native,
            target,
            answers,
        };
        let resp = self
            .inner
            .submit_placement(&body)
            .await
            .map_err(|e| eyre!("failed to submit placement: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Deduce a CEFR level from pasted materials; creates no course.
    pub async fn deduce_from_notes(
        &self,
        native: &str,
        target: &str,
        content: &str,
    ) -> Result<types::DeduceFromNotesResponse> {
        let body = types::DeduceFromNotesRequest {
            native: types::DeduceFromNotesRequestNative::try_from(native.to_string())
                .map_err(|e| eyre!("invalid native language code: {e}"))?,
            target: types::DeduceFromNotesRequestTarget::try_from(target.to_string())
                .map_err(|e| eyre!("invalid target language code: {e}"))?,
            content: types::DeduceFromNotesRequestContent::try_from(content.to_string())
                .map_err(|e| eyre!("materials cannot be empty: {e}"))?,
        };
        let resp = self
            .inner
            .deduce_placement_from_notes(&body)
            .await
            .map_err(|e| eyre!("failed to deduce level from notes: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Confirm a deduced level: create the course and seed note + vocabulary.
    pub async fn confirm_from_notes(
        &self,
        native: &str,
        target: &str,
    ) -> Result<types::ConfirmFromNotesResponse> {
        let body = types::ConfirmFromNotesRequest {
            native: types::ConfirmFromNotesRequestNative::try_from(native.to_string())
                .map_err(|e| eyre!("invalid native language code: {e}"))?,
            target: types::ConfirmFromNotesRequestTarget::try_from(target.to_string())
                .map_err(|e| eyre!("invalid target language code: {e}"))?,
        };
        let resp = self
            .inner
            .confirm_placement_from_notes(&body)
            .await
            .map_err(|e| eyre!("failed to confirm placement from notes: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Declare a CEFR level manually; creates the course or raises to it.
    pub async fn manual_placement(
        &self,
        native: &str,
        target: &str,
        level: &str,
    ) -> Result<types::ManualPlacementResponse> {
        let body = types::ManualPlacementRequest {
            native: types::ManualPlacementRequestNative::try_from(native.to_string())
                .map_err(|e| eyre!("invalid native language code: {e}"))?,
            target: types::ManualPlacementRequestTarget::try_from(target.to_string())
                .map_err(|e| eyre!("invalid target language code: {e}"))?,
            level: types::CefrLevel::try_from(level)
                .map_err(|e| eyre!("invalid CEFR level: {e}"))?,
        };
        let resp = self
            .inner
            .manual_placement(&body)
            .await
            .map_err(|e| eyre!("failed to set manual placement: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Permanently delete a course and everything tied to it.
    pub async fn delete_course(
        &self,
        course_id: &str,
        confirm: &str,
    ) -> Result<types::DeleteCourseResponse> {
        let body = types::DeleteCourseRequest {
            confirm: confirm.to_string(),
        };
        let resp = self
            .inner
            .delete_course(course_id, &body)
            .await
            .map_err(|e| eyre!("failed to delete course: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Fetch the course's memory graph (vocab/grammar nodes + edges).
    pub async fn graph(&self, course_id: &str) -> Result<types::MemoryGraphResponse> {
        let resp = self
            .inner
            .get_graph(course_id)
            .await
            .map_err(|e| eyre!("failed to load memory graph: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Fetch instance/owner config (self-hosted, owner, non-secret infra).
    pub async fn onboarding_config(&self) -> Result<types::OnboardingConfigResponse> {
        let resp = self
            .inner
            .onboarding_config()
            .await
            .map_err(|e| eyre!("failed to load config: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Fetch the authenticated learner's identity.
    pub async fn me(&self) -> Result<types::MeResponse> {
        let resp = self
            .inner
            .get_me()
            .await
            .map_err(|e| eyre!("failed to load user: {e}"))?;
        Ok(resp.into_inner())
    }

    // --- Adaptive-listening Q&A -------------------------------------------

    /// Ask a contextual question about an episode; returns a PENDING interaction.
    pub async fn ask_interaction(
        &self,
        episode_id: &str,
        question: String,
        timestamp: f64,
    ) -> Result<types::InteractionResponse> {
        let question = types::AskInteractionRequestQuestion::try_from(question)
            .map_err(|e| eyre!("invalid question: {e}"))?;
        let body = types::AskInteractionRequest {
            question,
            timestamp,
        };
        let resp = self
            .inner
            .ask_interaction(episode_id, &body)
            .await
            .map_err(|e| eyre!("failed to ask question: {e}"))?;
        Ok(resp.into_inner())
    }

    /// Poll an interaction's status/answer.
    pub async fn poll_interaction(
        &self,
        episode_id: &str,
        interaction_id: &str,
    ) -> Result<types::InteractionResponse> {
        let resp = self
            .inner
            .poll_interaction(episode_id, interaction_id)
            .await
            .map_err(|e| eyre!("failed to poll question: {e}"))?;
        Ok(resp.into_inner())
    }
}
