#[derive(Clone, Debug, serde::Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlacementAnalysisReference {
    pub analysis_id: uuid::Uuid,
    pub analysis_revision: u64,
    pub result_digest: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlacementInference {
    pub level: String,
    pub confidence: f64,
    pub rationale: String,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct PlacementAnalysisSummary {
    pub inference: Option<PlacementInference>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlacementAnalysisStatus {
    pub analysis_id: uuid::Uuid,
    pub analysis_revision: u64,
    pub identity_digest: Option<String>,
    pub result_digest: Option<String>,
    pub native: String,
    pub target: String,
    pub status: String,
    pub stale: bool,
    pub summary: Option<PlacementAnalysisSummary>,
    pub failure_reason: Option<String>,
}

impl PlacementAnalysisStatus {
    pub fn reference(&self) -> Result<PlacementAnalysisReference> {
        if self.analysis_revision == 0
            || self.result_digest.as_ref().is_none_or(|digest| {
                digest.len() != 64
                    || !digest
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
        {
            return Err(eyre!("The saved analysis result digest is invalid."));
        }
        if self.identity_digest.as_ref().is_some_and(|digest| {
            digest.len() != 64
                || !digest
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        }) {
            return Err(eyre!("The saved analysis identity digest is invalid."));
        }
        Ok(PlacementAnalysisReference {
            analysis_id: self.analysis_id,
            analysis_revision: self.analysis_revision,
            result_digest: self
                .result_digest
                .clone()
                .ok_or_else(|| eyre!("Source analysis has no verified result digest."))?,
        })
    }
}

impl SottoClient {
    async fn placement_json<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T> {
        let response = request
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await?;
        let status = response.status();
        if !matches!(status.as_u16(), 200..=202) {
            return Err(eyre!(
                "Placement request failed ({status}): {}",
                response.text().await?
            ));
        }
        Ok(response.json().await?)
    }

    pub async fn generate_placement(
        &self,
        native: &str,
        target: &str,
        request_id: uuid::Uuid,
        source: Option<PlacementAnalysisReference>,
        accept_partial: bool,
    ) -> Result<types::GeneratePlacementResponse> {
        let mut body = serde_json::json!({"schemaVersion":1,"requestId":request_id,"native":native,"target":target,"acceptPartial":accept_partial});
        if let Some(source) = &source {
            body["analysisId"] = serde_json::json!(source.analysis_id);
            body["analysisRevision"] = serde_json::json!(source.analysis_revision);
            body["resultDigest"] = serde_json::json!(source.result_digest);
        }
        let mut batch: types::GeneratePlacementResponse = self
            .placement_json(
                self.http
                    .post(format!("{}/api/v1/placement/generate", self.base_url))
                    .json(&body),
            )
            .await?;
        let session_id = batch.placement_session_id;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            if batch.native.to_string() != native
                || batch.target.to_string() != target
                || batch.placement_session_id != session_id
                || batch.analysis_id != source.as_ref().map(|s| s.analysis_id)
                || batch.analysis_revision.map(u64::from)
                    != source.as_ref().map(|s| s.analysis_revision)
                || batch.result_digest.as_ref().map(|s| s.to_string())
                    != source.as_ref().map(|s| s.result_digest.clone())
            {
                return Err(eyre!("The saved placement identity changed."));
            }
            match batch.status.to_string().as_str() {
                "READY" | "ACCEPTED" => return Ok(batch),
                "QUEUED" | "GENERATING" | "DISPATCHING" | "SUCCEEDED" => {}
                state => {
                    return Err(eyre!(
                        "Placement stopped in {state}. Resume the saved request or resolve recovery on the web app."
                    ));
                }
            }
            tokio::time::sleep_until(
                (tokio::time::Instant::now() + std::time::Duration::from_secs(2)).min(deadline),
            )
            .await;
            if tokio::time::Instant::now() >= deadline {
                return Err(eyre!(
                    "Placement remains saved on the server. Retry to resume the same request."
                ));
            }
            batch = self
                .placement_json(
                    self.http
                        .get(format!("{}/api/v1/placement", self.base_url))
                        .query(&[("placementSessionId", session_id.to_string())]),
                )
                .await?;
        }
    }

    pub async fn submit_placement(
        &self,
        batch: types::GeneratePlacementResponse,
        request_id: uuid::Uuid,
        answers: Vec<types::SubmitPlacementRequestAnswersItem>,
        accept_partial: bool,
    ) -> Result<types::SubmitPlacementResponse> {
        if !matches!(batch.status.to_string().as_str(), "READY" | "ACCEPTED")
            || answers.len() != batch.questions.len()
            || !(6..=24).contains(&answers.len())
            || batch
                .questions
                .iter()
                .any(|q| answers.iter().filter(|a| a.id.to_string() == q.id).count() != 1)
        {
            return Err(eyre!(
                "Answer every question in the saved placement batch once."
            ));
        }
        self.placement_json(self.http.post(format!("{}/api/v1/placement",self.base_url)).json(&serde_json::json!({
            "schemaVersion":1,"requestId":request_id,"native":batch.native,"target":batch.target,
            "placementSessionId":batch.placement_session_id,"questionsDigest":batch.questions_digest,
            "analysisId":batch.analysis_id,"analysisRevision":batch.analysis_revision,"resultDigest":batch.result_digest,
            "acceptPartial":accept_partial,"answers":answers}))).await
    }

    pub async fn deduce_from_notes(
        &self,
        native: &str,
        target: &str,
        content: &str,
        request_id: uuid::Uuid,
    ) -> Result<PlacementAnalysisStatus> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Admission {
            analysis_id: uuid::Uuid,
            analysis_revision: u64,
        }
        let admission:Admission = self.placement_json(self.http.post(format!("{}/api/v1/placement/from-notes",self.base_url)).json(&serde_json::json!({
            "schemaVersion":1,"requestId":request_id,"native":native,"target":target,"content":content,"materialIds":[],"includeCourseNote":false}))).await?;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            let status: PlacementAnalysisStatus = self
                .placement_json(self.http.get(format!(
                    "{}/api/v1/material-analyses/{}",
                    self.base_url, admission.analysis_id
                )))
                .await?;
            if status.analysis_id != admission.analysis_id
                || status.analysis_revision != admission.analysis_revision
                || status.native != native
                || status.target != target
                || status.stale
            {
                return Err(eyre!(
                    "The source analysis identity changed or its source was retired."
                ));
            }
            match status.status.as_str() {
                "COMPLETE" | "PARTIAL" => {
                    status.reference()?;
                    if status
                        .summary
                        .as_ref()
                        .and_then(|s| s.inference.as_ref())
                        .is_none()
                    {
                        return Err(eyre!(
                            "The saved source has no placement inference. Use its private practice focuses or take a cold diagnostic."
                        ));
                    }
                    return Ok(status);
                }
                "WAITING_SOURCE" | "RUNNING" => {}
                state => {
                    return Err(eyre!(
                        "Source analysis stopped in {state}: {}. Reopen the saved analysis on the web app.",
                        status
                            .failure_reason
                            .as_deref()
                            .unwrap_or("recovery or additional source is required")
                    ));
                }
            }
            tokio::time::sleep_until(
                (tokio::time::Instant::now() + std::time::Duration::from_secs(2)).min(deadline),
            )
            .await;
            if tokio::time::Instant::now() >= deadline {
                return Err(eyre!(
                    "Source analysis remains saved. Retry unchanged materials to resume the same request."
                ));
            }
        }
    }

    pub async fn confirm_from_notes(
        &self,
        native: &str,
        target: &str,
        source: PlacementAnalysisReference,
        request_id: uuid::Uuid,
        accept_partial: bool,
    ) -> Result<types::ConfirmFromNotesResponse> {
        self.placement_json(self.http.post(format!("{}/api/v1/placement/from-notes/confirm",self.base_url)).json(&serde_json::json!({
            "schemaVersion":1,"requestId":request_id,"native":native,"target":target,
            "analysisId":source.analysis_id,"analysisRevision":source.analysis_revision,"resultDigest":source.result_digest,"acceptPartial":accept_partial}))).await
    }
}
