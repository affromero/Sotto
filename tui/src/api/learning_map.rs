impl SottoClient {
    pub async fn learning_map(
        &self,
        course_id: &str,
        level: Option<&str>,
    ) -> Result<types::LearningMapResponse> {
        let response = match level {
            Some(level) => {
                self.inner
                    .get_learning_level_requirements(course_id, level)
                    .await
            }
            None => self.inner.get_learning_map(course_id, None).await,
        }
        .map_err(|error| eyre!("Learning map unavailable: {error}"))?;
        Ok(response.into_inner())
    }

    pub async fn preview_learning_selection(
        &self,
        course_id: &str,
        selection: types::LearningSelectionRequest,
    ) -> Result<types::LearningSelectionPreview> {
        Ok(self
            .inner
            .preview_learning_selection(course_id, &selection)
            .await
            .map_err(|error| eyre!("Selection preview unavailable: {error}"))?
            .into_inner())
    }

    pub async fn start_selected_practice(
        &self,
        course_id: &str,
        kind: types::PracticeKind,
        request_id: uuid::Uuid,
        selection: types::LearningSelectionRequest,
    ) -> Result<types::StartPracticeResponse> {
        let body: types::StartPracticeRequest = serde_json::from_value(serde_json::json!({
            "kind": kind,
            "requestId": request_id,
            "learningSelection": selection,
        }))?;
        Ok(self
            .inner
            .start_practice(course_id, &body)
            .await
            .map_err(|error| eyre!("Focused practice unavailable: {error}"))?
            .into_inner())
    }

    pub async fn advance_learning_level(
        &self,
        course_id: &str,
        request: types::AdvanceLearningLevelRequest,
    ) -> Result<types::LearningLevelCompletion> {
        Ok(self
            .inner
            .advance_learning_level(course_id, &request)
            .await
            .map_err(|error| eyre!("Level advancement unavailable: {error}"))?
            .into_inner())
    }
}
