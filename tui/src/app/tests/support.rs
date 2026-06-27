    use super::*;
    use crate::api::{Api, NextClassOutcome, types};
    use async_trait::async_trait;
    use std::sync::Arc;

    /// A pure canned-response [`Api`] stub for App tests: returns benign results
    /// and never touches the network, so dispatch + reducer behavior is
    /// exercised hermetically. The audio paths are never reached in tests.
    struct StubApi;

    #[async_trait]
    impl Api for StubApi {
        async fn courses(&self) -> Result<types::CoursesListResponse> {
            Ok(types::CoursesListResponse { courses: vec![] })
        }

        async fn practice_overview(
            &self,
            _course_id: &str,
        ) -> Result<types::PracticeOverviewResponse> {
            Ok(overview(0.0, 0.0))
        }

        async fn start_practice(
            &self,
            _course_id: &str,
            _kind: types::PracticeKind,
        ) -> Result<types::StartPracticeResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "unavailable",
                "reason": "nothing_due"
            }))
            .expect("valid start JSON"))
        }

        async fn submit_practice(
            &self,
            _session_id: &str,
            _answers: Vec<types::SubmitPracticeRequestAnswersItem>,
        ) -> Result<types::SubmitPracticeResponse> {
            Ok(types::SubmitPracticeResponse {
                score: 0.0,
                correct: 0.0,
                total: 0.0,
            })
        }

        async fn episode(&self, _episode_id: &str) -> Result<types::EpisodeDetailResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "ep-stub",
                "title": "Stub episode",
                "status": "READY",
                "audioUrl": null,
                "duration": null,
                "language": "es",
                "segments": []
            }))
            .expect("valid episode JSON"))
        }

        async fn poll_speaking(
            &self,
            _session_id: &str,
            _prompt_id: &str,
            _recording_id: &str,
        ) -> Result<types::SpeakingPollResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "PENDING",
                "overallScore": null,
                "transcript": null,
                "feedback": null
            }))
            .expect("valid poll JSON"))
        }

        async fn upload_speaking(
            &self,
            _session_id: &str,
            _prompt_id: &str,
            _wav: Vec<u8>,
        ) -> Result<SpeakingUploadResponse> {
            Ok(SpeakingUploadResponse {
                recording_id: "rec-stub".into(),
                status: "PENDING".into(),
            })
        }

        async fn download(&self, _url: &str) -> Result<Vec<u8>> {
            Ok(Vec::new())
        }

        async fn next_class(&self, _course_id: &str) -> Result<NextClassOutcome> {
            Ok(NextClassOutcome::Done)
        }

        async fn class(&self, _class_id: &str) -> Result<types::ClassDetailResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "cls-stub",
                "courseId": "course-stub",
                "status": "IN_PROGRESS",
                "order": 1,
                "passThreshold": 0.7,
                "submitted": false,
                "sections": []
            }))
            .expect("valid class JSON"))
        }

        async fn submit_class(
            &self,
            _class_id: &str,
            _answers: Vec<types::SubmitClassRequestAnswersItem>,
        ) -> Result<types::SubmitClassResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "passed": true,
                "overallScore": 1.0,
                "passedSections": 1,
                "totalSections": 1,
                "sections": []
            }))
            .expect("valid submit-class JSON"))
        }

        async fn upload_class_speaking(
            &self,
            _class_id: &str,
            _prompt_id: &str,
            _wav: Vec<u8>,
        ) -> Result<SpeakingUploadResponse> {
            Ok(SpeakingUploadResponse {
                recording_id: "rec-stub".into(),
                status: "PENDING".into(),
            })
        }

        async fn poll_class_speaking(
            &self,
            _class_id: &str,
            _prompt_id: &str,
            _recording_id: &str,
        ) -> Result<types::SpeakingPollResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "PENDING",
                "overallScore": null,
                "transcript": null,
                "feedback": null
            }))
            .expect("valid poll JSON"))
        }

        async fn submit_class_writing(
            &self,
            _class_id: &str,
            _prompt_id: &str,
            _text: String,
        ) -> Result<crate::api::WritingGradeResponse> {
            Ok(crate::api::WritingGradeResponse {
                overall_score: 0.9,
                feedback: "Good.".into(),
            })
        }

        async fn start_exam(
            &self,
            _course_id: &str,
            _level: Option<types::CefrLevel>,
        ) -> Result<types::StartExamResponse> {
            Ok(
                serde_json::from_value(serde_json::json!({ "examId": "exam-stub" }))
                    .expect("valid start-exam JSON"),
            )
        }

        async fn exam(&self, _exam_id: &str) -> Result<types::ExamDetailResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "exam-stub", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
                "level": "B1", "status": "IN_PROGRESS", "examName": "Mock", "sections": [],
                "result": null
            }))
            .expect("valid exam JSON"))
        }

        async fn submit_exam(
            &self,
            _exam_id: &str,
            _answers: Vec<types::SubmitExamRequestAnswersItem>,
        ) -> Result<types::SubmitExamResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "overallScore": 1.0, "band": "C1", "feedback": "Strong.", "sections": []
            }))
            .expect("valid submit-exam JSON"))
        }

        async fn upload_exam_speaking(
            &self,
            _exam_id: &str,
            _prompt_id: &str,
            _wav: Vec<u8>,
        ) -> Result<SpeakingUploadResponse> {
            Ok(SpeakingUploadResponse {
                recording_id: "rec-stub".into(),
                status: "PENDING".into(),
            })
        }

        async fn poll_exam_speaking(
            &self,
            _exam_id: &str,
            _prompt_id: &str,
            _recording_id: &str,
        ) -> Result<types::SpeakingPollResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "status": "PENDING", "overallScore": null, "transcript": null, "feedback": null
            }))
            .expect("valid poll JSON"))
        }

        async fn submit_exam_writing(
            &self,
            _exam_id: &str,
            _prompt_id: &str,
            _text: String,
        ) -> Result<crate::api::WritingGradeResponse> {
            Ok(crate::api::WritingGradeResponse {
                overall_score: 0.8,
                feedback: "Good.".into(),
            })
        }

        async fn generate_placement(
            &self,
            _native: &str,
            _target: &str,
        ) -> Result<types::GeneratePlacementResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "native": "en", "target": "es",
                "questions": [
                    { "id": "pq_0", "cefr": "A1", "skill": "grammar", "prompt": "?", "options": ["a","b"] }
                ]
            }))
            .expect("valid placement JSON"))
        }

        async fn submit_placement(
            &self,
            _native: &str,
            _target: &str,
            _answers: Vec<types::SubmitPlacementRequestAnswersItem>,
        ) -> Result<types::SubmitPlacementResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-stub", "level": "A2", "scoreBySkill": { "grammar": 0.5 }
            }))
            .expect("valid submit-placement JSON"))
        }

        async fn deduce_from_notes(
            &self,
            _native: &str,
            _target: &str,
            _content: &str,
        ) -> Result<types::DeduceFromNotesResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "native": "en", "target": "es",
                "deducedLevel": "B1", "rationale": "Uses past tense.", "confidence": 0.8
            }))
            .expect("valid deduce-from-notes JSON"))
        }

        async fn confirm_from_notes(
            &self,
            _native: &str,
            _target: &str,
        ) -> Result<types::ConfirmFromNotesResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-stub", "level": "B1", "addedVocabulary": 5
            }))
            .expect("valid confirm-from-notes JSON"))
        }

        async fn manual_placement(
            &self,
            _native: &str,
            _target: &str,
            level: &str,
        ) -> Result<types::ManualPlacementResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "courseId": "course-stub", "level": level
            }))
            .expect("valid manual-placement JSON"))
        }

        async fn delete_course(
            &self,
            _course_id: &str,
            _confirm: &str,
        ) -> Result<types::DeleteCourseResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "deleted": true, "episodesDeleted": 0,
                "filesAttempted": 0, "filesDeleted": 0, "filesFailed": 0
            }))
            .expect("valid delete-course JSON"))
        }

        async fn graph(&self, _course_id: &str) -> Result<types::MemoryGraphResponse> {
            Ok(
                serde_json::from_value(serde_json::json!({ "nodes": [], "edges": [] }))
                    .expect("valid graph JSON"),
            )
        }

        async fn onboarding_config(&self) -> Result<types::OnboardingConfigResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "selfHosted": true, "isOwner": false, "infra": null
            }))
            .expect("valid config JSON"))
        }

        async fn me(&self) -> Result<types::MeResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "u_stub", "name": "Stub Learner", "email": null,
                "image": null
            }))
            .expect("valid me JSON"))
        }

        async fn ask_interaction(
            &self,
            _episode_id: &str,
            _question: String,
            _timestamp: f64,
        ) -> Result<types::InteractionResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "int-stub", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            }))
            .expect("valid interaction JSON"))
        }

        async fn poll_interaction(
            &self,
            _episode_id: &str,
            _interaction_id: &str,
        ) -> Result<types::InteractionResponse> {
            Ok(serde_json::from_value(serde_json::json!({
                "id": "int-stub", "question": "?", "timestamp": 0,
                "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
            }))
            .expect("valid interaction JSON"))
        }
    }

    /// A config with a single active `default` profile pointing at the stub.
    fn stub_config() -> Config {
        let mut config = Config::default();
        config.upsert_profile(
            "default",
            crate::config::Profile {
                server_url: "stub://test".into(),
                api_key: "test-key".into(),
                name: None,
            },
        );
        config.active = "default".into();
        config
    }

    /// A [`ClientFactory`] that hands out a fresh [`StubApi`] for any profile and
    /// records the server_url it was last asked to build, so a switch test can
    /// assert the client was rebuilt for the new profile.
    fn recording_factory() -> (ClientFactory, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        let built = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&built);
        let factory: ClientFactory = Arc::new(move |profile: &crate::config::Profile| {
            sink.lock().unwrap().push(profile.server_url.clone());
            Ok(Arc::new(StubApi) as Arc<dyn Api>)
        });
        (factory, built)
    }

    /// Build an `App` around a [`StubApi`]. No terminal is created and no
    /// network is possible: the only [`Api`] impl is the stub.
    fn test_app() -> App {
        let (factory, _) = recording_factory();
        // `None` config path: tests must never persist to the real config file.
        App::with_factory_at(stub_config(), factory, None).expect("stub app builds")
    }

    #[test]
    fn config_persists_to_the_injected_path_only() {
        // Regression: the App must write to its injected config_path, never the
        // real platform path, or running `cargo test` clobbers the developer's
        // own ~/.config/sotto/config.toml.
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("config.toml");
        let (factory, _) = recording_factory();
        let mut app =
            App::with_factory_at(stub_config(), factory, Some(path.clone())).expect("app builds");

        assert!(!path.exists(), "nothing is written before a save");
        app.persist_theme();
        assert!(path.exists(), "persist_theme writes to the injected path");

        // A None-path app persists nowhere and must not panic.
        let (factory2, _) = recording_factory();
        let mut noop = App::with_factory_at(stub_config(), factory2, None).expect("app builds");
        noop.persist_theme();
    }

    fn course(id: &str) -> Course {
        Course {
            id: id.into(),
            title: format!("Course {id}"),
            native_lang: "en".into(),
            target_lang: "es".into(),
            current_level: "A2".into(),
            placement_source: None,
        }
    }

    fn ok<T>(value: T) -> ApiResult<T> {
        Arc::new(Ok(value))
    }

    fn overview(vocab: f64, total: f64) -> types::PracticeOverviewResponse {
        serde_json::from_value(serde_json::json!({
            "due": { "vocab": vocab, "grammar": 0 },
            "totalVocab": total,
            "recent": []
        }))
        .expect("valid overview JSON")
    }
