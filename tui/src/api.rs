//! Typed Sotto API client generated from the committed OpenAPI contract.
//!
//! The `progenitor::generate_api!` invocation below consumes the spec that
//! `@sotto/shared` emits from its Zod registry. A successful build here is the
//! load-bearing validation that the committed spec is progenitor-clean —
//! later phases call the generated, typed methods rather than hand-rolled
//! requests.
//!
//! The wrapper and its typed methods are not yet wired into a screen, so the
//! module is `allow(dead_code)` until Phase 4 consumes it.
#![allow(dead_code)]

use async_trait::async_trait;
use color_eyre::{Result, eyre::eyre};
use serde::Deserialize;

/// Generated client + models. The spec path is resolved relative to
/// `CARGO_MANIFEST_DIR` (the `tui/` crate root), so the macro reads the
/// crate-local **vendored** copy `tui/openapi.codegen.json`. That vendored file
/// is written by `npm run gen:openapi` alongside the canonical
/// `packages/shared/openapi.codegen.json` (byte-for-byte identical), so the
/// crate builds standalone and is publishable to crates.io — where the
/// `packages/shared` workspace path does not ship. A CI sync check fails if the
/// vendored copy drifts from the canonical spec.
///
/// We feed progenitor the `openapi.codegen.json` view — the truthful
/// `openapi.json` minus operations progenitor cannot generate (currently only
/// `next-class`, whose 200 and 201 carry different bodies). Those excluded
/// operations are hand-rolled below in [`SottoClient`]. Both specs are
/// generated together by `npm run gen:openapi` and drift-tested.
mod generated {
    #![allow(clippy::all)]
    #![allow(dead_code)]
    progenitor::generate_api!("openapi.codegen.json");
}

pub(crate) use generated::Client as GeneratedClient;
pub(crate) use generated::types;

/// Response of the multipart speaking-attempt upload (POST). The upload itself
/// is intentionally not in the OpenAPI contract — multipart binary does not
/// codegen cleanly — so its small response is modeled here directly. Mirrors
/// the `{ recordingId, status }` body the speaking route returns on 201.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpeakingUploadResponse {
    pub recording_id: String,
    pub status: String,
}

/// Response of the class writing submit (POST `{ text }`), graded synchronously.
/// Modeled here rather than in the OpenAPI contract because the writing submit
/// endpoint is hand-rolled in this client (its request is a plain `{ text }`
/// body the codegen does not need). Mirrors `gradeWriting`'s `WritingGrade`.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WritingGradeResponse {
    /// 0..1 overall writing score.
    pub overall_score: f64,
    pub feedback: String,
}

/// Outcome of `next-class`. The route returns two genuinely different bodies by
/// status — `201 { classId }` (a class was created/returned) or
/// `200 { done: true }` (the curriculum is complete). progenitor cannot model
/// two distinct 2xx bodies for one operation, so `next-class` is excluded from
/// the codegen spec and hand-rolled in [`SottoClient::next_class`], which
/// dispatches on the HTTP status into this enum.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NextClassOutcome {
    /// A class is ready to work (201).
    Created { class_id: String },
    /// The course curriculum is complete (200).
    Done,
}

/// The async seam the [`crate::app::App`] dispatches through. Production uses
/// [`SottoClient`] (the progenitor-backed impl below); tests inject a stub that
/// returns canned results, so the App's dispatch/reducer logic is exercised
/// with zero network and no dependence on task-scheduling timing. P5/P6 reuse
/// this trait to mock new endpoints.
///
/// `#[async_trait]` boxes the returned futures so the trait is dyn-compatible
/// (`Arc<dyn Api>`). Methods return the same generated types the App consumes.
#[async_trait]
pub(crate) trait Api: Send + Sync {
    async fn courses(&self) -> Result<types::CoursesListResponse>;
    async fn practice_overview(&self, course_id: &str) -> Result<types::PracticeOverviewResponse>;
    async fn start_practice(
        &self,
        course_id: &str,
        kind: types::PracticeKind,
    ) -> Result<types::StartPracticeResponse>;
    async fn submit_practice(
        &self,
        session_id: &str,
        answers: Vec<types::SubmitPracticeRequestAnswersItem>,
    ) -> Result<types::SubmitPracticeResponse>;
    /// Episode detail (listening): segments with playable presigned audio URLs.
    async fn episode(&self, episode_id: &str) -> Result<types::EpisodeDetailResponse>;
    /// Poll grading for an uploaded speaking attempt.
    async fn poll_speaking(
        &self,
        session_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse>;
    /// Upload a recorded WAV attempt (raw multipart, not in the OpenAPI spec).
    async fn upload_speaking(
        &self,
        session_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse>;
    /// Download raw bytes from an absolute (presigned) URL — segment audio.
    async fn download(&self, url: &str) -> Result<Vec<u8>>;

    // --- Classes (the gated CEFR curriculum flow) ---
    /// Create/advance to the next gated class, or report the course done.
    async fn next_class(&self, course_id: &str) -> Result<NextClassOutcome>;
    /// Fetch a class with its ordered, mixed-skill sections.
    async fn class(&self, class_id: &str) -> Result<types::ClassDetailResponse>;
    /// Submit a class's MC answers and get the grade result.
    async fn submit_class(
        &self,
        class_id: &str,
        answers: Vec<types::SubmitClassRequestAnswersItem>,
    ) -> Result<types::SubmitClassResponse>;
    /// Upload a class speaking attempt (raw multipart at the class path).
    async fn upload_class_speaking(
        &self,
        class_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse>;
    /// Poll grading for a class speaking attempt.
    async fn poll_class_speaking(
        &self,
        class_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse>;
    /// Submit a class writing response (`{ text }`), graded synchronously.
    async fn submit_class_writing(
        &self,
        class_id: &str,
        prompt_id: &str,
        text: String,
    ) -> Result<WritingGradeResponse>;

    // --- Exams (ungated mock exams) ---
    /// Start a mock exam for a course at an optional CEFR level; returns its id.
    async fn start_exam(
        &self,
        course_id: &str,
        level: Option<types::CefrLevel>,
    ) -> Result<types::StartExamResponse>;
    /// Fetch an exam with its ordered, mixed-skill sections (+ result if scored).
    async fn exam(&self, exam_id: &str) -> Result<types::ExamDetailResponse>;
    /// Submit an exam's MC answers and get the band/score result.
    async fn submit_exam(
        &self,
        exam_id: &str,
        answers: Vec<types::SubmitExamRequestAnswersItem>,
    ) -> Result<types::SubmitExamResponse>;
    /// Upload an exam speaking attempt (raw multipart at the exam path).
    async fn upload_exam_speaking(
        &self,
        exam_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse>;
    /// Poll grading for an exam speaking attempt.
    async fn poll_exam_speaking(
        &self,
        exam_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse>;
    /// Submit an exam writing response (`{ text }`), graded synchronously.
    async fn submit_exam_writing(
        &self,
        exam_id: &str,
        prompt_id: &str,
        text: String,
    ) -> Result<WritingGradeResponse>;

    // --- Placement, memory graph, onboarding (P6d) ---
    /// Generate an adaptive placement batch for a native/target language pair.
    async fn generate_placement(
        &self,
        native: &str,
        target: &str,
    ) -> Result<types::GeneratePlacementResponse>;
    /// Submit placement answers; assigns a CEFR level and creates the course.
    async fn submit_placement(
        &self,
        native: &str,
        target: &str,
        answers: Vec<types::SubmitPlacementRequestAnswersItem>,
    ) -> Result<types::SubmitPlacementResponse>;
    /// Fetch the course's vocabulary/grammar memory graph.
    async fn graph(&self, course_id: &str) -> Result<types::MemoryGraphResponse>;
    /// Fetch instance/owner config (self-hosted, owner, non-secret infra).
    async fn onboarding_config(&self) -> Result<types::OnboardingConfigResponse>;
    /// Fetch the authenticated learner's identity (id, name, email, handle).
    async fn me(&self) -> Result<types::MeResponse>;

    // --- Adaptive-listening Q&A (P6e) ---
    /// Ask a contextual question about an episode at `timestamp` seconds; the
    /// answer is generated asynchronously, so this returns a PENDING interaction.
    async fn ask_interaction(
        &self,
        episode_id: &str,
        question: String,
        timestamp: f64,
    ) -> Result<types::InteractionResponse>;
    /// Poll an interaction until it is ANSWERED with answer text.
    async fn poll_interaction(
        &self,
        episode_id: &str,
        interaction_id: &str,
    ) -> Result<types::InteractionResponse>;
}

/// Thin wrapper over the progenitor-generated [`GeneratedClient`] that bakes in
/// the configured base URL and a default `Authorization: Bearer <api_key>`
/// header so every call to the Sotto server is authenticated.
///
/// Two HTTP clients on purpose:
/// - `http` carries the Bearer key; it backs the generated client AND the
///   hand-rolled multipart speaking upload — both hit the Sotto server.
/// - `download_http` has NO default Authorization header; it is used ONLY to
///   GET absolute presigned/CDN audio URLs ([`SottoClient::download`]). Those
///   URLs point at R2/CDN, not Sotto, and are self-authenticating, so the Sotto
///   API key must never be attached — sending it would leak the credential to
///   a third-party host.
pub(crate) struct SottoClient {
    inner: GeneratedClient,
    http: reqwest::Client,
    download_http: reqwest::Client,
    base_url: String,
}

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
        let body = types::StartPracticeRequest { kind };
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
        let resp = self
            .inner
            .generate_placement(native, target)
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

/// The real implementation of the [`Api`] seam: each method delegates to the
/// inherent progenitor-backed method above.
#[async_trait]
impl Api for SottoClient {
    async fn courses(&self) -> Result<types::CoursesListResponse> {
        SottoClient::courses(self).await
    }

    async fn practice_overview(&self, course_id: &str) -> Result<types::PracticeOverviewResponse> {
        SottoClient::practice_overview(self, course_id).await
    }

    async fn start_practice(
        &self,
        course_id: &str,
        kind: types::PracticeKind,
    ) -> Result<types::StartPracticeResponse> {
        SottoClient::start_practice(self, course_id, kind).await
    }

    async fn submit_practice(
        &self,
        session_id: &str,
        answers: Vec<types::SubmitPracticeRequestAnswersItem>,
    ) -> Result<types::SubmitPracticeResponse> {
        SottoClient::submit_practice(self, session_id, answers).await
    }

    async fn episode(&self, episode_id: &str) -> Result<types::EpisodeDetailResponse> {
        SottoClient::episode(self, episode_id).await
    }

    async fn poll_speaking(
        &self,
        session_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        SottoClient::poll_speaking(self, session_id, prompt_id, recording_id).await
    }

    async fn upload_speaking(
        &self,
        session_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse> {
        SottoClient::upload_speaking(self, session_id, prompt_id, wav).await
    }

    async fn download(&self, url: &str) -> Result<Vec<u8>> {
        SottoClient::download(self, url).await
    }

    async fn next_class(&self, course_id: &str) -> Result<NextClassOutcome> {
        SottoClient::next_class(self, course_id).await
    }

    async fn class(&self, class_id: &str) -> Result<types::ClassDetailResponse> {
        SottoClient::class(self, class_id).await
    }

    async fn submit_class(
        &self,
        class_id: &str,
        answers: Vec<types::SubmitClassRequestAnswersItem>,
    ) -> Result<types::SubmitClassResponse> {
        SottoClient::submit_class(self, class_id, answers).await
    }

    async fn upload_class_speaking(
        &self,
        class_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse> {
        SottoClient::upload_class_speaking(self, class_id, prompt_id, wav).await
    }

    async fn poll_class_speaking(
        &self,
        class_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        SottoClient::poll_class_speaking(self, class_id, prompt_id, recording_id).await
    }

    async fn submit_class_writing(
        &self,
        class_id: &str,
        prompt_id: &str,
        text: String,
    ) -> Result<WritingGradeResponse> {
        SottoClient::submit_class_writing(self, class_id, prompt_id, text).await
    }

    async fn start_exam(
        &self,
        course_id: &str,
        level: Option<types::CefrLevel>,
    ) -> Result<types::StartExamResponse> {
        SottoClient::start_exam(self, course_id, level).await
    }

    async fn exam(&self, exam_id: &str) -> Result<types::ExamDetailResponse> {
        SottoClient::exam(self, exam_id).await
    }

    async fn submit_exam(
        &self,
        exam_id: &str,
        answers: Vec<types::SubmitExamRequestAnswersItem>,
    ) -> Result<types::SubmitExamResponse> {
        SottoClient::submit_exam(self, exam_id, answers).await
    }

    async fn upload_exam_speaking(
        &self,
        exam_id: &str,
        prompt_id: &str,
        wav: Vec<u8>,
    ) -> Result<SpeakingUploadResponse> {
        SottoClient::upload_exam_speaking(self, exam_id, prompt_id, wav).await
    }

    async fn poll_exam_speaking(
        &self,
        exam_id: &str,
        prompt_id: &str,
        recording_id: &str,
    ) -> Result<types::SpeakingPollResponse> {
        SottoClient::poll_exam_speaking(self, exam_id, prompt_id, recording_id).await
    }

    async fn submit_exam_writing(
        &self,
        exam_id: &str,
        prompt_id: &str,
        text: String,
    ) -> Result<WritingGradeResponse> {
        SottoClient::submit_exam_writing(self, exam_id, prompt_id, text).await
    }

    async fn generate_placement(
        &self,
        native: &str,
        target: &str,
    ) -> Result<types::GeneratePlacementResponse> {
        SottoClient::generate_placement(self, native, target).await
    }

    async fn submit_placement(
        &self,
        native: &str,
        target: &str,
        answers: Vec<types::SubmitPlacementRequestAnswersItem>,
    ) -> Result<types::SubmitPlacementResponse> {
        SottoClient::submit_placement(self, native, target, answers).await
    }

    async fn graph(&self, course_id: &str) -> Result<types::MemoryGraphResponse> {
        SottoClient::graph(self, course_id).await
    }

    async fn onboarding_config(&self) -> Result<types::OnboardingConfigResponse> {
        SottoClient::onboarding_config(self).await
    }

    async fn me(&self) -> Result<types::MeResponse> {
        SottoClient::me(self).await
    }

    async fn ask_interaction(
        &self,
        episode_id: &str,
        question: String,
        timestamp: f64,
    ) -> Result<types::InteractionResponse> {
        SottoClient::ask_interaction(self, episode_id, question, timestamp).await
    }

    async fn poll_interaction(
        &self,
        episode_id: &str,
        interaction_id: &str,
    ) -> Result<types::InteractionResponse> {
        SottoClient::poll_interaction(self, episode_id, interaction_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Accept one connection, read the raw HTTP request, reply 201 with a JSON
    /// body, and return the captured request bytes. A loopback stand-in for the
    /// route — no real backend — so the multipart form construction is verified
    /// deterministically.
    async fn capture_one_request(listener: TcpListener) -> String {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = vec![0u8; 64 * 1024];
        // A single read captures the small request (headers + tiny WAV body).
        let n = socket.read(&mut buf).await.expect("read request");
        let request = String::from_utf8_lossy(&buf[..n]).to_string();

        let body = br#"{"recordingId":"rec-42","status":"PENDING"}"#;
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write head");
        socket.write_all(body).await.expect("write body");
        let _ = socket.flush().await;
        request
    }

    #[tokio::test]
    async fn upload_speaking_builds_an_audio_multipart_part() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_one_request(listener));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let wav = b"RIFF....WAVEfake".to_vec();
        let resp = client
            .upload_speaking("sess-1", "prompt-1", wav)
            .await
            .expect("upload ok");

        // Parsed the canned 201 body.
        assert_eq!(resp.recording_id, "rec-42");
        assert_eq!(resp.status, "PENDING");

        // The captured request carries the right multipart part + auth + path.
        // HTTP header-name case is not normative (reqwest emits request headers
        // lowercase but multipart part headers capitalized), so match case-
        // insensitively on header keywords while keeping field values exact.
        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/practice/sess-1/speaking/prompt-1"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("content-type: multipart/form-data"),
            "must be multipart"
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "bearer header must ride along"
        );
        assert!(
            request.contains(r#"name="audio""#),
            "form field must be `audio`"
        );
        assert!(
            request.contains(r#"filename="attempt.wav""#),
            "filename must be attempt.wav"
        );
        assert!(
            lower.contains("content-type: audio/wav"),
            "part mime must be audio/wav"
        );
        assert!(
            request.contains("RIFF....WAVEfake"),
            "wav bytes in the body"
        );
    }

    #[tokio::test]
    async fn download_does_not_send_the_sotto_api_key() {
        // A presigned/CDN URL is self-authenticating; the Sotto bearer key must
        // never be attached, or it leaks to the third-party host. The download
        // client has no default Authorization header.
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_one_request(listener));

        let client = SottoClient::new("http://sotto.invalid", "secret-key").expect("client");
        // Point at the loopback "CDN"; the response body is irrelevant here.
        let _ = client
            .download(&format!("http://{addr}/presigned/seg1.mp3?sig=abc"))
            .await
            .expect("download ok");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /presigned/seg1.mp3"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            !lower.contains("authorization:"),
            "download must NOT carry any Authorization header; request was:\n{request}"
        );
        assert!(
            !request.contains("secret-key"),
            "the Sotto API key must never appear in a download request"
        );
    }

    /// Accept one connection, read the raw HTTP request, and reply with the given
    /// `status_line` (e.g. "200 OK") + JSON `body`. Returns the captured request.
    /// A flexible loopback stand-in for any route, used to verify each
    /// hand-rolled method's path/method/query/body/auth + response parse.
    async fn capture_with_response(
        listener: TcpListener,
        status_line: &'static str,
        body: &'static str,
    ) -> String {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = vec![0u8; 64 * 1024];
        let n = socket.read(&mut buf).await.expect("read request");
        let request = String::from_utf8_lossy(&buf[..n]).to_string();
        let response = format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write head");
        socket.write_all(body.as_bytes()).await.expect("write body");
        let _ = socket.flush().await;
        request
    }

    #[tokio::test]
    async fn submit_class_writing_posts_text_json_with_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"overallScore":0.75,"feedback":"Nice work."}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let grade = client
            .submit_class_writing("cls-1", "w0", "mi respuesta".to_string())
            .await
            .expect("writing graded");
        assert_eq!(grade.overall_score, 0.75);
        assert_eq!(grade.feedback, "Nice work.");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/classes/cls-1/writing/w0"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(lower.contains("authorization: bearer test-key"), "bearer");
        assert!(
            lower.contains("content-type: application/json"),
            "json content-type"
        );
        assert!(
            request.contains(r#"{"text":"mi respuesta"}"#),
            "body must be {{text}}; got:\n{request}"
        );
    }

    #[tokio::test]
    async fn submit_exam_writing_posts_to_the_exam_writing_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"overallScore":0.5,"feedback":"ok"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let grade = client
            .submit_exam_writing("exam-9", "w1", "essay".to_string())
            .await
            .expect("writing graded");
        assert_eq!(grade.overall_score, 0.5);

        let request = server.await.expect("server task");
        assert!(
            request.starts_with("POST /api/v1/exams/exam-9/writing/w1"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key"),
            "bearer"
        );
        assert!(
            request.contains(r#"{"text":"essay"}"#),
            "body must be {{text}}"
        );
    }

    #[tokio::test]
    async fn poll_class_speaking_gets_with_recording_id_query_and_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"status":"SCORED","overallScore":0.9,"transcript":"hola","feedback":"great"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let poll = client
            .poll_class_speaking("cls-1", "p0", "rec-7")
            .await
            .expect("poll ok");
        assert_eq!(poll.overall_score, Some(0.9));
        assert_eq!(poll.transcript.as_deref(), Some("hola"));

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /api/v1/classes/cls-1/speaking/p0?recordingId=rec-7"),
            "request line (path + query): {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(lower.contains("authorization: bearer test-key"), "bearer");
    }

    #[tokio::test]
    async fn poll_exam_speaking_gets_with_recording_id_query() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"status":"PENDING","overallScore":null,"transcript":null,"feedback":null}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let poll = client
            .poll_exam_speaking("exam-9", "p1", "rec-8")
            .await
            .expect("poll ok");
        assert_eq!(poll.overall_score, None);

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /api/v1/exams/exam-9/speaking/p1?recordingId=rec-8"),
            "request line (path + query): {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "the exam-speaking poll must carry the bearer key"
        );
    }

    #[tokio::test]
    async fn upload_class_speaking_posts_multipart_to_the_class_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "201 Created",
            r#"{"recordingId":"rec-1","status":"PENDING"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let resp = client
            .upload_class_speaking("cls-2", "p3", b"RIFF....WAVEx".to_vec())
            .await
            .expect("upload ok");
        assert_eq!(resp.recording_id, "rec-1");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/classes/cls-2/speaking/p3"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("content-type: multipart/form-data"),
            "multipart"
        );
        assert!(lower.contains("authorization: bearer test-key"), "bearer");
        assert!(request.contains(r#"name="audio""#), "audio field");
    }

    #[tokio::test]
    async fn upload_exam_speaking_posts_multipart_to_the_exam_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "201 Created",
            r#"{"recordingId":"rec-2","status":"PENDING"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let resp = client
            .upload_exam_speaking("exam-3", "p4", b"RIFF....WAVEy".to_vec())
            .await
            .expect("upload ok");
        assert_eq!(resp.recording_id, "rec-2");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/exams/exam-3/speaking/p4"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("content-type: multipart/form-data"),
            "multipart"
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "the exam-speaking upload must carry the bearer key"
        );
        assert!(
            request.contains(r#"name="audio""#),
            "form field must be `audio`"
        );
        assert!(
            request.contains(r#"filename="attempt.wav""#),
            "filename must be attempt.wav"
        );
        assert!(
            lower.contains("content-type: audio/wav"),
            "part mime must be audio/wav"
        );
        assert!(
            request.contains("RIFF....WAVEy"),
            "the uploaded wav bytes must be in the multipart body"
        );
    }

    #[tokio::test]
    async fn me_gets_users_me_with_bearer_and_parses_identity() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"id":"u_1","name":"Ada","email":"ada@example.com","handle":"ada","image":null,"episodeCount":3}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let me = client.me().await.expect("me ok");
        // Parses the identity subset; tolerates the extra `episodeCount` field.
        assert_eq!(me.id, "u_1");
        assert_eq!(me.name.as_deref(), Some("Ada"));
        assert_eq!(me.email.as_deref(), Some("ada@example.com"));

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /api/v1/users/me"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "the live identity call must carry the bearer key"
        );
    }
}
