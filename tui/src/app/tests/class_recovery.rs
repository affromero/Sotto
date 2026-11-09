    #[tokio::test]
    async fn transcript_only_saved_class_requires_repair_before_completion() {
        // A class with a single transcript-only listening section (no MC
        // questions). Completing it must advance via next-class, not stall on
        // View::Class. The submit route rejects empty answers (.min(1)), so this
        // class cannot be submitted; the no-MC path re-resolves via next-class.
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-l", "skill": "LISTENING", "status": "READY",
              "episode": { "id": "ep0", "audioUrl": null, "title": "Listen", "references": [] },
              "prompts": [], "writingPrompts": [], "questions": [] }
        ]));

        let before = app.request_gen;
        // Enter on the transcript-only section -> it is the last section -> the
        // no-MC completion path dispatches next-class.
        app.on_select();

        // It must NOT stall on View::Class; the next-class dispatch shows Loading
        // and bumps the generation.
        assert!(
            matches!(app.view, View::ClassRepair { .. }),
            "no-MC class must advance (Loading after next-class dispatch), not stall on Class"
        );
        assert_eq!(
            app.request_gen,
            before,
            "repair requires an explicit learner action"
        );

        app.on_next_class();
        assert!(matches!(app.view, View::Loading));
        // The accepted repair result resumes this same saved class.
        let req_gen = app.request_gen;
        app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
        accept_no_prelude(&mut app);
        assert!(
            matches!(app.view, View::Class { ref class_id, .. } if class_id == "cls1"),
            "repair resumes the same saved class"
        );
    }

    #[tokio::test]
    async fn speaking_only_saved_class_requires_repair_after_last_prompt() {
        // A speaking-only class: after the last prompt is graded, Enter advances
        // past the final section into the no-MC completion path (next-class).
        let mut app = test_app();
        app.view = class_with_sections(serde_json::json!([
            { "id": "sec-s", "skill": "SPEAKING", "status": "READY", "episode": null,
              "questions": [], "writingPrompts": [],
              "prompts": [{ "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "ipa": null, "referenceTtsUrl": null }] }
        ]));
        // Mark the single prompt graded so Enter advances the section.
        if let Some(section) = app.current_section_mut()
            && let state::SectionProgress::Speaking { phase, .. } = &mut section.progress
        {
            *phase = state::SpeakingPhase::Graded {
                score: Some(90),
                transcript: None,
                feedback: None,
            };
        }

        let before = app.request_gen;
        app.on_select(); // last graded prompt -> advance past last section -> next-class

        assert!(
            matches!(app.view, View::ClassRepair { .. }),
            "speaking-only class must advance, not stall"
        );
        assert_eq!(
            app.request_gen,
            before,
            "repair requires an explicit learner action"
        );
    }

    // --- P6c: exams (hermetic, StubApi) -----------------------------------

#[tokio::test]
async fn an_active_partial_class_can_request_repair_without_advancing_the_course() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "partial-class".into());
    if let View::Class { attempt, .. } = &mut app.view { *attempt = 4; }
    let action = app.map_key(key(KeyCode::Char('N')));
    assert!(matches!(action, Some(Action::NextClass)));
    app.on_next_class();
    assert!(matches!(app.view, View::Loading));
    assert_eq!(app.pending_course.as_ref().map(|course| course.id.as_str()), Some("A"));
    let req_gen = app.request_gen;
    app.on_next_class_resolved(req_gen, next_outcome(NextClassOutcome::Created { class_id: "partial-class".into() }));
    accept_no_prelude(&mut app);
    assert!(matches!(&app.view, View::Class { class_id, .. } if class_id == "partial-class"));
}


#[tokio::test]
async fn class_repair_waits_for_saved_drafts_and_restores_retained_work_in_the_new_attempt() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "writing", "skill": "WRITING", "status": "READY",
        "episode": null, "questions": [], "prompts": [],
        "writingPrompts": [{ "id": "w0", "task": "Greet Ana.", "order": 0 }]
    }]));
    if let View::Class { material_source, .. } = &mut app.view {
        *material_source = Some("a".repeat(64));
    }
    for letter in "Hola Ana.".chars() { app.on_writing_input(letter); }
    app.on_next_class();
    let sequence = match &app.view {
        View::Class { progress, .. } => progress.in_flight.expect("draft save pending"),
        other => panic!("repair discarded the writing screen: {other:?}"),
    };
    assert!(app.pending_course.is_none());
    app.on_next_class();
    assert!(matches!(app.view, View::Class { .. }));
    app.on_practice_progress_saved("CLASS/cls1/1".into(), sequence,
        Arc::new(Ok(serde_json::from_value(serde_json::json!({
            "saved": true, "progressRevision": 1
        })).unwrap())));
    app.on_next_class();
    assert!(matches!(app.view, View::Loading));
    app.on_next_class_resolved(app.request_gen, next_outcome(NextClassOutcome::Created { class_id: "cls1".into() }));
    accept_no_prelude(&mut app);
    app.on_class_loaded(app.request_gen, class_detail(serde_json::json!({
        "id": "cls1", "attempt": 2, "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "progressRevision": 1,
        "writingDrafts": { "w0": "Hola Ana." },
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY",
            "episode": null, "questions": [], "prompts": [],
            "writingPrompts": [{ "id": "w0", "task": "Greet Ana.", "order": 0, "savedDraft": "Hola Ana." }] }]
    })));
    assert!(matches!(app.view, View::Class { attempt: 2, .. }));
    assert!(matches!(app.current_section().map(|section| &section.progress),
        Some(SectionProgress::Writing { input, .. }) if input.text() == "Hola Ana."));
}

#[tokio::test]
async fn class_repair_keeps_an_unknown_recording_on_its_original_prompt() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "speaking", "skill": "SPEAKING", "status": "READY",
        "episode": null, "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0 }]
    }]));
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Lost acknowledgement".into())));
    app.on_next_class();
    assert!(app.view.has_uncertain_upload());
    assert!(matches!(app.view, View::Class { attempt: 1, .. }));
    assert!(app.pending_course.is_none());
}

#[test]
fn class_recording_binding_tracks_prompt_attempt_and_material() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "speaking", "skill": "SPEAKING", "status": "READY",
        "episode": null, "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0 }]
    }]));
    assert!(app.current_class_recording_binding().is_none());
    if let View::Class { material_source, attempt, .. } = &mut app.view {
        *material_source = Some("a".repeat(64));
        *attempt = 4;
    }
    let captured = app.current_class_recording_binding().unwrap();
    assert_eq!(captured.0, "cls1");
    assert_eq!(captured.1, "s0");
    assert_eq!(captured.2.attempt, 4);
    if let View::Class { material_source, .. } = &mut app.view { *material_source = Some("b".repeat(64)); }
    assert_ne!(Some(captured), app.current_class_recording_binding());
}

#[cfg(unix)]
#[test]
fn retained_class_recording_is_private_and_contains_the_original_audio() {
    use std::os::unix::fs::PermissionsExt;
    let mut app = test_app();
    let path = app.retain_class_audio(b"RIFF-test-audio".to_vec()).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"RIFF-test-audio");
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn a_recording_not_yet_saved_to_disk_blocks_leaving_the_class() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "cls1".into());
    app.retained_class_recording = Some(b"unsaved audio".to_vec());
    app.on_back();
    assert!(matches!(app.view, View::Class { .. }));
    app.handle_event(crate::event::Event::Key(key(KeyCode::Char('q')))).unwrap();
    assert!(matches!(app.view, View::Class { .. }));
    assert_eq!(app.retained_class_recording.as_deref(), Some(b"unsaved audio".as_slice()));
}

#[tokio::test]
async fn definite_class_recording_rejection_does_not_become_unknown_upload() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "speaking", "skill": "SPEAKING", "status": "READY",
        "episode": null, "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0 }]
    }]));
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Recording was not submitted. Recording saved at /tmp/recording.wav".into())));
    assert!(matches!(app.current_section().map(|section| &section.progress),
        Some(SectionProgress::Speaking { phase: SpeakingPhase::Failed { message }, .. }) if message.contains("recording.wav")));
}

#[tokio::test]
async fn local_recording_is_removed_only_after_its_current_receipt() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "speaking", "skill": "SPEAKING", "status": "READY",
        "episode": null, "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0 }]
    }]));
    let directory = tempfile::tempdir().unwrap();
    if let View::Class { material_source, .. } = &mut app.view { *material_source = Some("a".repeat(64)); }
    let target = app.current_class_recording_binding().unwrap();
    let profile = app.config.active_profile().unwrap();
    let owner = (profile.server_url.trim_end_matches('/').to_string(), profile.api_key.clone());
    let accepted = directory.path().join("accepted.wav");
    std::fs::write(&accepted, b"audio").unwrap();
    app.pending_class_audio.insert(app.request_gen, PendingClassAudio { path: accepted.clone(), owner: owner.clone(), target: target.clone(), origin: app.view.clone() });
    if let Some(section) = app.current_section_mut() {
        if let SectionProgress::Speaking { phase, .. } = &mut section.progress { *phase = SpeakingPhase::Uploading; }
        section.remember_productive_work();
    }
    app.on_class_speaking_uploaded(app.request_gen, ok(SpeakingUploadResponse {
        recording_id: "saved".into(), status: "PENDING".into(),
    }));
    assert!(!accepted.exists());
    assert!(!app.view.has_upload_in_progress());

    let unknown = directory.path().join("unknown.wav");
    std::fs::write(&unknown, b"audio").unwrap();
    app.pending_class_audio.insert(app.request_gen, PendingClassAudio { path: unknown.clone(), owner, target, origin: app.view.clone() });
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Lost acknowledgement".into())));
    assert_eq!(std::fs::read(&unknown).unwrap(), b"audio");
}

#[tokio::test]
async fn incomplete_receipts_and_changed_targets_keep_local_audio() {
    let mut app = test_app();
    app.view = class_with_sections(serde_json::json!([{
        "id": "speaking", "skill": "SPEAKING", "status": "READY",
        "episode": null, "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0 }]
    }]));
    if let View::Class { material_source, .. } = &mut app.view { *material_source = Some("a".repeat(64)); }
    let target = app.current_class_recording_binding().unwrap();
    let profile = app.config.active_profile().unwrap();
    let owner = (profile.server_url.trim_end_matches('/').to_string(), profile.api_key.clone());
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("recording.wav");
    std::fs::write(&path, b"audio").unwrap();
    app.pending_class_audio.insert(app.request_gen, PendingClassAudio { path: path.clone(), owner, target, origin: app.view.clone() });
    app.on_class_speaking_uploaded(app.request_gen, ok(SpeakingUploadResponse {
        recording_id: "".into(), status: "PENDING".into(),
    }));
    assert_eq!(std::fs::read(&path).unwrap(), b"audio");
    assert!(app.view.has_uncertain_upload());
    if let View::Class { material_source, .. } = &mut app.view { *material_source = Some("b".repeat(64)); }
    if let Some(section) = app.current_section_mut()
        && let SectionProgress::Speaking { phase, .. } = &mut section.progress { *phase = SpeakingPhase::Uploading; }
    app.on_class_speaking_uploaded(app.request_gen, ok(SpeakingUploadResponse {
        recording_id: "saved".into(), status: "PENDING".into(),
    }));
    assert_eq!(std::fs::read(&path).unwrap(), b"audio");
    assert!(app.pending_class_audio.contains_key(&app.request_gen));
    assert!(!app.view.has_upload_in_progress());
    assert!(app.view.has_uncertain_upload());
    if let View::Class { material_source, .. } = &mut app.view { *material_source = Some("a".repeat(64)); }
    app.pending_class_audio.get_mut(&app.request_gen).unwrap().path = directory.path().to_path_buf();
    app.on_class_speaking_uploaded(app.request_gen, ok(SpeakingUploadResponse {
        recording_id: "saved".into(), status: "PENDING".into(),
    }));
    assert!(app.pending_class_audio.contains_key(&app.request_gen));
}

#[tokio::test]
async fn class_newer_recording_does_not_resolve_a_lost_upload_acknowledgement() {
    let mut app = test_app();
    let detail = |recording_id: &str| class_detail(serde_json::json!({
        "id": "cls1", "attempt": 1, "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "taskMaterialRevision": "a".repeat(64),
        "sections": [{ "id": "speaking", "skill": "SPEAKING", "status": "READY",
            "episode": null, "questions": [], "writingPrompts": [],
            "prompts": [{ "id": "s0", "targetPhrase": "Hola", "translation": "Hello", "order": 0,
                "latestRecording": { "id": recording_id, "status": "SCORED",
                    "overallScore": 0.9, "transcript": "Hola", "feedback": "Recognized greeting" } }] }]
    }));
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("previous-recording"));
    if let View::Class { progress, .. } = &mut app.view { progress.conflict = true; }
    app.cache_practice();
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("recognized-recording"));
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Lost acknowledgement".into())));
    app.cache_practice();
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("recognized-recording"));
    assert!(app.view.has_uncertain_upload());
    app.cache_practice();
    app.view = View::class_view(course("A"), "cls1".into());
    app.on_class_loaded(app.request_gen, detail("new-recording"));
    assert!(app.view.has_uncertain_upload());
    assert!(matches!(app.current_section().map(|section| &section.progress),
        Some(SectionProgress::Speaking { phase: SpeakingPhase::UnknownUpload { .. }, .. })));
}
