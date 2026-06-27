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
    /// Deduce a CEFR level from pasted materials (creates no course).
    async fn deduce_from_notes(
        &self,
        native: &str,
        target: &str,
        content: &str,
    ) -> Result<types::DeduceFromNotesResponse>;
    /// Accept a deduced level: create the course and seed note + vocabulary.
    async fn confirm_from_notes(
        &self,
        native: &str,
        target: &str,
    ) -> Result<types::ConfirmFromNotesResponse>;
    /// Declare a CEFR level manually; creates the course or raises to it.
    async fn manual_placement(
        &self,
        native: &str,
        target: &str,
        level: &str,
    ) -> Result<types::ManualPlacementResponse>;
    /// Permanently delete a course and everything tied to it. `confirm` must
    /// echo the course's target language code.
    async fn delete_course(
        &self,
        course_id: &str,
        confirm: &str,
    ) -> Result<types::DeleteCourseResponse>;
    /// Fetch the course's vocabulary/grammar memory graph.
    async fn graph(&self, course_id: &str) -> Result<types::MemoryGraphResponse>;
    /// Fetch instance/owner config (self-hosted, owner, non-secret infra).
    async fn onboarding_config(&self) -> Result<types::OnboardingConfigResponse>;
    /// Fetch the authenticated learner's identity (id, name, email).
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

include!("api/client.rs");
include!("api/impl.rs");

#[cfg(test)]
mod tests {
    include!("api/tests.rs");
}
