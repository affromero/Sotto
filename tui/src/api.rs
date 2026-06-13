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
/// `CARGO_MANIFEST_DIR` (the `tui/` crate root), so it points at the
/// repo-committed contract in `packages/shared/`.
mod generated {
    #![allow(clippy::all)]
    #![allow(dead_code)]
    progenitor::generate_api!("../packages/shared/openapi.json");
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

    /// Upload a recorded WAV attempt for a speaking prompt via raw multipart.
    /// The form field is `audio` with filename `attempt.wav` and `audio/wav`
    /// mime; the Bearer header rides on the shared reqwest client.
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
        let part = reqwest::multipart::Part::bytes(wav)
            .file_name("attempt.wav")
            .mime_str("audio/wav")
            .map_err(|e| eyre!("invalid audio mime: {e}"))?;
        let form = reqwest::multipart::Form::new().part("audio", part);

        let resp = self
            .http
            .post(&url)
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
}
