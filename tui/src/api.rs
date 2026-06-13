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

use color_eyre::{Result, eyre::eyre};

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

/// Thin wrapper over the progenitor-generated [`GeneratedClient`] that bakes in
/// the configured base URL and a default `Authorization: Bearer <api_key>`
/// header so every call is authenticated.
pub(crate) struct SottoClient {
    inner: GeneratedClient,
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

        let baseurl = server_url.trim_end_matches('/');
        let inner = GeneratedClient::new_with_client(baseurl, http);
        Ok(Self { inner })
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
}
