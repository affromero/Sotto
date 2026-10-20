#[derive(Default)]
pub(super) struct PlacementTransport {
    quiz_key: String,
    quiz_request: Option<uuid::Uuid>,
    pub batch: Option<crate::api::types::GeneratePlacementResponse>,
    answer_key: String,
    submit_request: Option<uuid::Uuid>,
    notes_key: String,
    notes_request: Option<uuid::Uuid>,
    pub analysis: Option<crate::api::PlacementAnalysisStatus>,
    confirm_request: Option<uuid::Uuid>,
    pub accept_partial: bool,
}

impl super::App {
    pub(super) fn dispatch_placement<F, T, A>(&mut self, req_gen: u64, task: F, to_action: A)
    where
        F: std::future::Future<Output = color_eyre::Result<T>> + Send + 'static,
        T: Send + 'static,
        A: FnOnce(u64, crate::action::ApiResult<T>) -> crate::action::Action + Send + 'static,
    {
        let tx = self.action_tx.clone();
        let task = tokio::spawn(async move {
            let result = task.await.map_err(|error| error.to_string());
            let _ = tx.send(to_action(req_gen, std::sync::Arc::new(result)));
        });
        self.placement_task = Some(task.abort_handle());
    }
}

impl PlacementTransport {
    pub fn quiz_request(&mut self, native: &str, target: &str) -> uuid::Uuid {
        let key = serde_json::to_string(&(
            native,
            target,
            self.analysis
                .as_ref()
                .map(|a| (&a.analysis_id, a.analysis_revision, &a.result_digest)),
            self.accept_partial,
        ))
        .expect("string tuple");
        if self.quiz_key != key || self.quiz_request.is_none() {
            self.quiz_key = key;
            self.quiz_request = Some(uuid::Uuid::new_v4());
            self.batch = None;
            self.submit_request = None;
        }
        self.quiz_request.expect("request initialized")
    }
    pub fn submit_request(
        &mut self,
        answers: &[crate::api::types::SubmitPlacementRequestAnswersItem],
    ) -> uuid::Uuid {
        let key = serde_json::to_string(answers).expect("typed placement answers");
        if self.answer_key != key || self.submit_request.is_none() {
            self.answer_key = key;
            self.submit_request = Some(uuid::Uuid::new_v4());
        }
        self.submit_request.expect("request initialized")
    }
    pub fn notes_request(&mut self, native: &str, target: &str, content: &str) -> uuid::Uuid {
        let key = serde_json::to_string(&(native, target, content)).expect("source strings");
        if self.notes_key != key || self.notes_request.is_none() {
            self.notes_key = key;
            self.notes_request = Some(uuid::Uuid::new_v4());
            self.analysis = None;
            self.confirm_request = None;
            self.accept_partial = false;
        }
        self.notes_request.expect("request initialized")
    }
    pub fn confirm_request(&mut self) -> uuid::Uuid {
        *self.confirm_request.get_or_insert_with(uuid::Uuid::new_v4)
    }
    pub fn source(&self) -> color_eyre::Result<Option<crate::api::PlacementAnalysisReference>> {
        self.analysis.as_ref().map(|a| a.reference()).transpose()
    }
    pub fn source_allowed(&self) -> bool {
        self.analysis.as_ref().is_some_and(|a| {
            a.status == "COMPLETE" || (a.status == "PARTIAL" && self.accept_partial)
        })
    }
}
