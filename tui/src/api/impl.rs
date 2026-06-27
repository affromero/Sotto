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

    async fn deduce_from_notes(
        &self,
        native: &str,
        target: &str,
        content: &str,
    ) -> Result<types::DeduceFromNotesResponse> {
        SottoClient::deduce_from_notes(self, native, target, content).await
    }

    async fn confirm_from_notes(
        &self,
        native: &str,
        target: &str,
    ) -> Result<types::ConfirmFromNotesResponse> {
        SottoClient::confirm_from_notes(self, native, target).await
    }

    async fn manual_placement(
        &self,
        native: &str,
        target: &str,
        level: &str,
    ) -> Result<types::ManualPlacementResponse> {
        SottoClient::manual_placement(self, native, target, level).await
    }

    async fn delete_course(
        &self,
        course_id: &str,
        confirm: &str,
    ) -> Result<types::DeleteCourseResponse> {
        SottoClient::delete_course(self, course_id, confirm).await
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
