fn ready_writing_practice(draft: &str) -> types::StartPracticeResponse {
    serde_json::from_value(serde_json::json!({
        "status": "ready_writing", "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "progressRevision": 2,
        "prompts": [{ "id": "w0", "task": "Introduce yourself", "guidance": null, "savedDraft": draft }]
    })).unwrap()
}

#[tokio::test]
async fn leaving_practice_preserves_dirty_drafts_and_late_save_acknowledgments() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    app.on_practice_started(app.request_gen, ok(ready_writing_practice("Saved")));
    app.on_writing_input('!');
    app.on_back();
    let id = "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac";
    let View::Practice { sections: Some(sections), progress, .. } = app.practice_cache.get(id).unwrap() else { panic!("cached practice") };
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "Saved!"));
    let sequence = progress.in_flight.unwrap();
    let receipt = serde_json::from_value(serde_json::json!({ "saved": true, "progressRevision": 3 })).unwrap();
    app.on_practice_progress_saved(id.into(), sequence, ok(receipt));
    let View::Practice { progress, .. } = app.practice_cache.get(id).unwrap() else { panic!("cached practice") };
    assert_eq!(progress.revision, 3);
    assert!(progress.in_flight.is_none());
}

#[tokio::test]
async fn a_save_for_an_earlier_snapshot_cannot_clear_newer_work() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    app.on_practice_started(app.request_gen, ok(ready_writing_practice("Saved")));
    app.on_writing_input('!');
    app.practice_tick();
    let (id, sequence) = match &app.view { View::Practice { session_id, progress, .. } => (session_id.clone(), progress.in_flight.unwrap()), _ => panic!("practice") };
    app.on_writing_input('?');
    let receipt = serde_json::from_value(serde_json::json!({ "saved": true, "progressRevision": 3 })).unwrap();
    app.on_practice_progress_saved(id.clone(), sequence, ok(receipt));
    app.practice_tick();
    let next_sequence = match &app.view { View::Practice { progress, .. } => progress.in_flight.unwrap(), _ => panic!("practice") };
    assert!(next_sequence > sequence);
    let stale = serde_json::from_value(serde_json::json!({ "saved": true, "progressRevision": 2 })).unwrap();
    app.on_practice_progress_saved(id, sequence, ok(stale));
    let View::Practice { progress, sections: Some(sections), .. } = &app.view else { panic!("practice") };
    assert_eq!(progress.revision, 3);
    assert_eq!(progress.in_flight, Some(next_sequence));
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "Saved!?"));
}

#[tokio::test]
async fn save_conflicts_keep_local_work_and_require_explicit_reconciliation() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    app.on_practice_started(app.request_gen, ok(ready_writing_practice("My draft")));
    app.on_writing_input('!');
    app.practice_tick();
    let (id, sequence) = match &app.view { View::Practice { session_id, progress, .. } => (session_id.clone(), progress.in_flight.unwrap()), _ => panic!("practice") };
    app.on_practice_progress_saved(id, sequence, Arc::new(Err("409 revision changed".into())));
    app.reconcile_practice_progress();
    let View::Practice { progress, sections: Some(sections), .. } = &app.view else { panic!("practice") };
    assert!(progress.conflict);
    assert!(progress.reconcile_confirmation);
    assert!(progress.in_flight.is_none());
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "My draft!"));
}

#[tokio::test]
async fn interrupted_admissions_remain_available_after_starting_another_session() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    app.start_skill(course("A"), SkillChoice::Full);
    let first = match app.view { View::PracticePreparing { request_id, .. } => request_id, _ => panic!("preparing") };
    app.on_practice_started(app.request_gen, Arc::new(Err("lost acknowledgement".into())));
    app.on_back();
    app.start_skill(course("A"), SkillChoice::Writing);
    let second = match app.view { View::PracticePreparing { request_id, .. } => request_id, _ => panic!("preparing") };
    assert_ne!(first, second);
    app.on_back();
    app.on_due_loaded(app.request_gen, ok(overview(0.0, 0.0)));
    let View::CourseHome { due, .. } = &app.view else { panic!("home") };
    assert!(due.recent.iter().any(|session| session.id == first.to_string()));
    assert!(due.recent.iter().any(|session| session.id == second.to_string()));
}

#[tokio::test]
async fn a_pending_recording_keeps_its_identity_after_a_status_network_failure() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    let response = serde_json::from_value(serde_json::json!({
        "status": "ready_full", "kind": "FULL", "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "items": [], "writingPrompts": [], "speakingPrompts": [
            { "id": "s0", "targetPhrase": "Hallo", "translation": "Hello", "referenceTtsUrl": null,
              "latestRecording": { "recordingId": "rec-existing", "status": "GRADING" } }
        ]
    })).unwrap();
    app.on_practice_started(app.request_gen, ok(response));
    app.on_class_speaking_polled(app.request_gen, Arc::new(Err("network unavailable".into())));
    assert!(matches!(app.current_section().map(|section| &section.progress), Some(SectionProgress::Speaking { phase: SpeakingPhase::Polling { recording_id }, .. }) if recording_id == "rec-existing"));
}

#[tokio::test]
async fn single_skill_speaking_keeps_pending_recording_after_status_failure() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    let response = serde_json::from_value(serde_json::json!({
        "status": "ready_speaking", "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "prompts": [{ "id": "s0", "targetPhrase": "Hallo", "translation": "Hello" }]
    })).unwrap();
    app.on_practice_started(app.request_gen, ok(response));
    if let View::SpeakingReview { phase, .. } = &mut app.view {
        *phase = SpeakingPhase::Polling { recording_id: "saved-recording".into() };
    } else {
        panic!("expected speaking review");
    }
    app.on_speaking_polled(app.request_gen, Arc::new(Err("network unavailable".into())));
    app.on_select();
    assert!(matches!(&app.view, View::SpeakingReview { index: 0, phase: SpeakingPhase::Polling { recording_id }, .. } if recording_id == "saved-recording"));
    app.on_toggle_record();
    assert!(matches!(&app.view, View::SpeakingReview { phase: SpeakingPhase::Polling { recording_id }, .. } if recording_id == "saved-recording"));
}

#[tokio::test]
async fn leaving_a_speaking_session_does_not_discard_an_active_recording() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    let response = serde_json::from_value(serde_json::json!({
        "status": "ready_speaking", "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "prompts": [{ "id": "s0", "targetPhrase": "Hallo", "translation": "Hello" }]
    })).unwrap();
    app.on_practice_started(app.request_gen, ok(response));
    if let View::SpeakingReview { phase, .. } = &mut app.view {
        *phase = SpeakingPhase::Recording;
    } else {
        panic!("expected speaking review");
    }
    app.on_back();
    assert!(matches!(&app.view, View::SpeakingReview { phase: SpeakingPhase::Recording, .. }));

    app.view = class_with_sections(serde_json::json!([{
        "id": "s1", "skill": "SPEAKING", "status": "READY", "episode": null,
        "questions": [], "writingPrompts": [],
        "prompts": [{ "id": "p1", "targetPhrase": "Hallo", "translation": "Hello", "order": 0 }]
    }]));
    if let Some(SectionProgress::Speaking { phase, .. }) = app.current_section_mut().map(|section| &mut section.progress) {
        *phase = SpeakingPhase::Recording;
    } else {
        panic!("expected speaking section");
    }
    app.on_back();
    assert!(matches!(app.current_section().map(|section| &section.progress),
        Some(SectionProgress::Speaking { phase: SpeakingPhase::Recording, .. })));
}

#[test]
fn writing_resume_preserves_formatting_without_regrading_unchanged_text() {
    let response = serde_json::from_value(serde_json::json!({
        "status": "ready_writing", "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "prompts": [{ "id": "w0", "task": "Introduce yourself", "guidance": null, "savedDraft": "Ich bin Mia.\n",
          "response": { "text": "Ich bin Mia.", "overallScore": 0.8, "feedback": "Clear.", "corrections": [] } }]
    })).unwrap();
    let view = state::reduce_start(View::course_home(course("A")), &response);
    let View::Practice { sections: Some(sections), .. } = view else { panic!("practice") };
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, phase: WritingPhase::Graded { score: 80, .. }, .. } if input.text().ends_with('\n')));
    assert!(state::class_ready_to_submit(&sections));
}

#[tokio::test]
async fn resuming_dirty_work_refreshes_server_feedback_without_losing_local_drafts() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    app.on_practice_started(app.request_gen, ok(ready_writing_practice("Ich bin Mia.")));
    app.on_writing_newline();
    app.on_back();
    app.on_practice_started(app.request_gen, ok(serde_json::from_value(serde_json::json!({
        "status": "ready_writing", "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "progressRevision": 3, "prompts": [{ "id": "w0", "task": "Introduce yourself", "guidance": null,
            "response": { "text": "Ich bin Mia.", "overallScore": 0.8, "feedback": "Clear.", "corrections": [] }
        }]
    })).unwrap()));
    let View::Practice { sections: Some(sections), .. } = &app.view else { panic!("practice") };
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, phase: WritingPhase::Graded { score: 80, .. }, .. } if input.text().ends_with('\n')));
}

#[tokio::test]
async fn leaving_class_preserves_drafts_and_matches_a_late_save_to_the_cached_attempt() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    let cls = serde_json::from_value(serde_json::json!({
        "id": "class-saved", "courseId": "A", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
        "submitted": false, "attempt": 4, "progressRevision": 2, "taskMaterialRevision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "writingDrafts": { "w0": "My draft" },
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY", "questions": [], "prompts": [],
            "writingPrompts": [{ "id": "w0", "order": 1, "task": "Introduce yourself" }] }]
    })).unwrap();
    app.on_class_loaded(app.request_gen, ok(cls));
    app.on_writing_input('!');
    app.on_back();
    let key = "CLASS/class-saved/4";
    let View::Class { sections: Some(sections), progress, attempt, .. } = app.practice_cache.get(key).unwrap() else { panic!("cached class") };
    assert_eq!(*attempt, 4);
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "My draft!"));
    let sequence = progress.in_flight.unwrap();
    let receipt = serde_json::from_value(serde_json::json!({ "saved": true, "progressRevision": 3 })).unwrap();
    app.on_practice_progress_saved(key.into(), sequence, ok(receipt));
    let View::Class { progress, .. } = app.practice_cache.get(key).unwrap() else { panic!("cached class") };
    assert_eq!(progress.revision, 3);
    assert!(progress.in_flight.is_none());
}

#[tokio::test]
async fn class_save_acknowledgement_updates_the_cache_while_the_same_class_is_loading() {
    let mut app = test_app();
    let key = "CLASS/class-saved/4";
    let mut cached = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, progress, .. } = &mut cached {
        *attempt = 4; progress.revision = 2; progress.in_flight = Some(17);
    }
    app.practice_cache.insert(key.into(), cached);
    app.view = View::class_view(course("A"), "class-saved".into());
    let receipt = serde_json::from_value(serde_json::json!({ "saved": true, "progressRevision": 3 })).unwrap();
    app.on_practice_progress_saved(key.into(), 17, ok(receipt));
    let View::Class { progress, .. } = app.practice_cache.get(key).unwrap() else { panic!("cached class") };
    assert_eq!(progress.revision, 3);
    assert!(progress.in_flight.is_none());
}

#[tokio::test]
async fn late_save_updates_only_the_original_class_attempt() {
    let mut app = test_app();
    let mut old = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, progress, .. } = &mut old {
        *attempt = 4;
        progress.revision = 2;
        progress.in_flight = Some(17);
    }
    app.practice_cache.insert("CLASS/class-saved/4".into(), old);
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, progress, .. } = &mut app.view {
        *attempt = 5;
        progress.revision = 6;
        progress.in_flight = Some(18);
    }
    let receipt = serde_json::from_value(serde_json::json!({ "saved": true, "progressRevision": 3 })).unwrap();
    app.on_practice_progress_saved("CLASS/class-saved/4".into(), 17, ok(receipt));
    let View::Class { progress, .. } = &app.view else { panic!("current class") };
    assert_eq!((progress.revision, progress.in_flight), (6, Some(18)));
    let View::Class { progress, .. } = app.practice_cache.get("CLASS/class-saved/4").unwrap() else { panic!("cached class") };
    assert_eq!((progress.revision, progress.in_flight), (3, None));
}

#[tokio::test]
async fn class_conflict_reconciliation_cannot_apply_a_new_attempt_revision_to_old_material() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, progress, .. } = &mut app.view {
        *attempt = 4; progress.revision = 2; progress.conflict = true; progress.in_flight = Some(17);
    }
    app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(serde_json::json!({
        "classId": "class-saved", "status": "IN_PROGRESS", "attempt": 5, "progressRevision": 9
    })));
    let View::Class { progress, .. } = &app.view else { panic!("class") };
    assert_eq!(progress.revision, 2);
    assert!(progress.conflict);
}

#[tokio::test]
async fn class_reconciliation_keeps_local_work_when_material_changes_on_the_same_attempt() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, material_source, progress, .. } = &mut app.view {
        *attempt = 4;
        *material_source = Some("a".repeat(64));
        progress.revision = 2;
        progress.dirty = true;
        progress.conflict = true;
        progress.in_flight = Some(17);
    }
    app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(serde_json::json!({
        "classId": "class-saved", "status": "IN_PROGRESS", "attempt": 4,
        "progressRevision": 9, "taskMaterialRevision": "b".repeat(64)
    })));
    let View::Class { progress, material_source, .. } = &app.view else { panic!("class") };
    assert_eq!(progress.revision, 2);
    assert!(progress.conflict && progress.dirty);
    assert_eq!(material_source.as_deref(), Some("a".repeat(64).as_str()));
}

#[tokio::test]
async fn class_reconciliation_accepts_the_same_attempt_and_material() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, material_source, progress, .. } = &mut app.view {
        *attempt = 4;
        *material_source = Some("a".repeat(64));
        progress.revision = 2;
        progress.conflict = true;
        progress.in_flight = Some(17);
    }
    app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(serde_json::json!({
        "classId": "class-saved", "status": "IN_PROGRESS", "attempt": 4,
        "progressRevision": 9, "taskMaterialRevision": "a".repeat(64)
    })));
    let View::Class { progress, .. } = &app.view else { panic!("class") };
    assert_eq!(progress.revision, 9);
    assert!(!progress.conflict && progress.dirty);
}

#[tokio::test]
async fn edits_cancel_pending_reconciliation_and_require_a_new_confirmation() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    app.on_practice_started(app.request_gen, ok(ready_writing_practice("Draft")));
    if let View::Practice { progress, .. } = &mut app.view {
        progress.conflict = true;
        progress.reconcile_confirmation = true;
        progress.in_flight = Some(17);
    }
    app.on_writing_input('!');
    let id = "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac";
    app.on_practice_reconciled(id.into(), 17, ok(serde_json::json!({
        "sessionId": id, "progressRevision": 9, "submissionResult": null
    })));
    let View::Practice { progress, sections: Some(sections), .. } = &app.view else { panic!("practice") };
    assert_eq!(progress.revision, 2);
    assert!(progress.conflict && progress.dirty && !progress.reconcile_confirmation);
    assert!(progress.in_flight.is_none());
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "Draft!"));
    app.reconcile_practice_progress();
    let View::Practice { progress, .. } = &app.view else { panic!("practice") };
    assert!(progress.reconcile_confirmation && progress.in_flight.is_none());
}

#[tokio::test]
async fn class_edit_and_navigation_preserve_draft_against_an_old_recovery_response() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    let cls = serde_json::from_value(serde_json::json!({
        "id": "class-saved", "courseId": "A", "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "attempt": 4, "progressRevision": 2,
        "taskMaterialRevision": "a".repeat(64),
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY",
            "questions": [], "prompts": [], "writingPrompts": [{ "id": "w0", "order": 1, "task": "Introduce yourself" }] }]
    })).unwrap();
    app.on_class_loaded(app.request_gen, ok(cls));
    for letter in "Draft".chars() { app.on_writing_input(letter); }
    if let View::Class { progress, .. } = &mut app.view {
        progress.conflict = true;
        progress.in_flight = Some(17);
    }
    app.on_writing_input('!');
    if let View::Class { progress, .. } = &mut app.view {
        assert!(progress.in_flight.is_none());
        progress.in_flight = Some(18);
    }
    app.cache_practice();
    app.view = View::class_view(course("A"), "another-class".into());
    app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(serde_json::json!({
        "classId": "class-saved", "status": "IN_PROGRESS", "attempt": 4,
        "progressRevision": 9, "taskMaterialRevision": "a".repeat(64)
    })));
    let View::Class { progress, sections: Some(sections), .. } = app.practice_cache.get("CLASS/class-saved/4").unwrap() else { panic!("cached class") };
    assert_eq!(progress.revision, 2);
    assert_eq!(progress.in_flight, Some(18));
    assert!(progress.conflict && progress.dirty);
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "Draft!"));
}

#[tokio::test]
async fn failed_class_recovery_keeps_the_original_draft_and_conflict() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    let cls = serde_json::from_value(serde_json::json!({
        "id": "class-saved", "courseId": "A", "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "attempt": 4, "progressRevision": 2,
        "taskMaterialRevision": "a".repeat(64),
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY",
            "questions": [], "prompts": [], "writingPrompts": [{ "id": "w0", "order": 1, "task": "Introduce yourself" }] }]
    })).unwrap();
    app.on_class_loaded(app.request_gen, ok(cls));
    for letter in "Draft".chars() { app.on_writing_input(letter); }
    for error in ["Unauthorized", "Class not found", "Progress status timed out", "Invalid response"] {
        if let View::Class { progress, .. } = &mut app.view {
            progress.conflict = true;
            progress.in_flight = Some(17);
        }
        app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, Arc::new(Err(error.into())));
        let View::Class { progress, sections: Some(sections), .. } = &app.view else { panic!("class") };
        assert_eq!(progress.revision, 2);
        assert!(progress.conflict && progress.dirty && progress.in_flight.is_none());
        assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "Draft"));
    }
}

#[tokio::test]
async fn class_recovery_rejects_wrong_identity_status_or_invalid_revision() {
    let valid = serde_json::json!({"classId": "class-saved", "status": "IN_PROGRESS", "attempt": 4,
        "progressRevision": 9, "taskMaterialRevision": "a".repeat(64)});
    for (field, value) in [
        ("classId", serde_json::json!("another-class")),
        ("status", serde_json::json!("PASSED")),
        ("attempt", serde_json::json!(5)),
        ("progressRevision", serde_json::json!(-1)),
        ("progressRevision", serde_json::Value::Null),
    ] {
        let mut app = test_app();
        app.view = View::class_view(course("A"), "class-saved".into());
        if let View::Class { attempt, material_source, progress, .. } = &mut app.view {
            *attempt = 4;
            *material_source = Some("a".repeat(64));
            progress.revision = 2;
            progress.dirty = true;
            progress.conflict = true;
            progress.in_flight = Some(17);
        }
        let mut response = valid.clone();
        response[field] = value;
        app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(response));
        let View::Class { progress, .. } = &app.view else { panic!("class") };
        assert_eq!(progress.revision, 2, "{field}");
        assert!(progress.conflict && progress.dirty, "{field}");
    }
}

#[tokio::test]
async fn class_reconciliation_reads_only_the_progress_recovery_endpoint() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut buffer = [0; 2048];
            let count = socket.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&buffer[..count]);
            if request.windows(4).any(|part| part == b"\r\n\r\n") { break; }
        }
        let body = serde_json::json!({"classId": "class-saved", "status": "IN_PROGRESS", "attempt": 4,
            "progressRevision": 9, "taskMaterialRevision": "a".repeat(64)}).to_string();
        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        socket.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });
    let mut app = test_app();
    app.client = Arc::new(crate::api::SottoClient::new(&format!("http://{address}"), "test-key").unwrap());
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, material_source, progress, .. } = &mut app.view {
        *attempt = 4;
        *material_source = Some("a".repeat(64));
        progress.conflict = true;
    }
    app.reconcile_practice_progress();
    app.reconcile_practice_progress();
    let (id, sequence, result) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let Some(Action::PracticeReconciled(id, sequence, result)) = app.action_rx.recv().await {
                break (id, sequence, result);
            }
        }
    }).await.unwrap();
    app.on_practice_reconciled(id, sequence, result);
    let request = server.await.unwrap();
    assert!(request.starts_with("GET /api/v1/classes/class-saved/progress-recovery "));
    assert!(request.to_ascii_lowercase().contains("authorization: bearer test-key"));
    let View::Class { progress, .. } = &app.view else { panic!("class") };
    assert_eq!(progress.revision, 9);
    assert!(!progress.conflict && progress.dirty);
}

#[tokio::test]
async fn class_save_without_material_identity_preserves_dirty_work() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, progress, .. } = &mut app.view {
        *attempt = 4;
        progress.dirty = true;
    }
    app.save_practice_progress();
    let View::Class { progress, .. } = &app.view else { panic!("class") };
    assert!(progress.dirty && progress.conflict);
    assert!(progress.in_flight.is_none());
}

#[tokio::test]
async fn changed_material_after_reconciliation_keeps_the_rejected_draft() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    let cls = serde_json::from_value(serde_json::json!({
        "id": "class-saved", "courseId": "A", "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "attempt": 4, "progressRevision": 2,
        "taskMaterialRevision": "a".repeat(64),
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY",
            "questions": [], "prompts": [], "writingPrompts": [{ "id": "w0", "order": 1, "task": "Introduce yourself" }] }]
    })).unwrap();
    app.on_class_loaded(app.request_gen, ok(cls));
    for letter in "My draft".chars() { app.on_writing_input(letter); }
    if let View::Class { progress, .. } = &mut app.view {
        progress.conflict = true;
        progress.in_flight = Some(17);
    }
    app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(serde_json::json!({
        "classId": "class-saved", "status": "IN_PROGRESS", "attempt": 4,
        "progressRevision": 9, "taskMaterialRevision": "a".repeat(64)
    })));
    app.save_practice_progress();
    let sequence = match &app.view {
        View::Class { progress, .. } => progress.in_flight.unwrap(),
        _ => panic!("class"),
    };
    app.on_practice_progress_saved("CLASS/class-saved/4".into(), sequence,
        Arc::new(Err("409 material changed".into())));
    let View::Class { progress, material_source, sections: Some(sections), .. } = &app.view else { panic!("class") };
    assert!(progress.dirty && progress.conflict);
    assert_eq!(material_source.as_deref(), Some("a".repeat(64).as_str()));
    assert!(matches!(&sections[0].progress, SectionProgress::Writing { input, .. } if input.text() == "My draft"));
}

#[tokio::test]
async fn class_save_sends_the_original_attempt_and_material_with_the_draft() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let body_start = loop {
            let mut chunk = [0; 4096];
            let count = socket.read(&mut chunk).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&chunk[..count]);
            if let Some(index) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let header = String::from_utf8_lossy(&request[..body_start]);
        let length: usize = header.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse().unwrap())
        }).unwrap();
        while request.len() < body_start + length {
            let mut chunk = [0; 4096];
            let count = socket.read(&mut chunk).await.unwrap();
            assert!(count > 0);
            request.extend_from_slice(&chunk[..count]);
        }
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 35\r\nConnection: close\r\n\r\n{\"saved\":true,\"progressRevision\":3}").await.unwrap();
        request
    });
    let mut app = test_app();
    app.client = Arc::new(crate::api::SottoClient::new(&format!("http://{address}"), "test-key").unwrap());
    app.view = View::class_view(course("A"), "class-saved".into());
    let cls = serde_json::from_value(serde_json::json!({
        "id": "class-saved", "courseId": "A", "status": "IN_PROGRESS", "order": 1,
        "passThreshold": 0.7, "submitted": false, "attempt": 4, "progressRevision": 2,
        "taskMaterialRevision": "a".repeat(64),
        "sections": [{ "id": "writing", "skill": "WRITING", "status": "READY",
            "questions": [], "prompts": [], "writingPrompts": [{ "id": "w0", "order": 1, "task": "Introduce yourself" }] }]
    })).unwrap();
    app.on_class_loaded(app.request_gen, ok(cls));
    for letter in "My draft".chars() { app.on_writing_input(letter); }
    app.save_practice_progress();
    let request = server.await.unwrap();
    let request = String::from_utf8(request).unwrap();
    assert!(request.starts_with("PATCH /api/v1/classes/class-saved "));
    let body: serde_json::Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["expectedAttempt"], 4);
    assert_eq!(body["taskMaterialRevision"], "a".repeat(64));
    assert_eq!(body["expectedRevision"], 2);
    assert_eq!(body["writingDrafts"]["w0"], "My draft");
}

#[tokio::test]
async fn a_lost_upload_acknowledgement_blocks_recording_until_saved_evidence_is_found() {
    let mut app = test_app();
    app.enter_course_home(course("A"));
    let response: types::StartPracticeResponse = serde_json::from_value(serde_json::json!({
        "status": "ready_full", "kind": "FULL", "items": [], "writingPrompts": [], "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "speakingPrompts": [{ "id": "s0", "targetPhrase": "Hallo", "translation": "Hello", "referenceTtsUrl": null,
            "latestRecording": { "recordingId": "old-upload", "status": "SCORED", "overallScore": 0.9, "transcript": "Hallo", "feedback": "Previous attempt" } }]
    })).unwrap();
    app.on_practice_started(app.request_gen, ok(response.clone()));
    app.on_class_speaking_uploaded(app.request_gen, Arc::new(Err("Lost acknowledgement".into())));
    assert!(matches!(app.current_section().map(|section| &section.progress), Some(SectionProgress::Speaking { phase: SpeakingPhase::UnknownUpload { .. }, .. })));
    app.on_back();
    app.on_practice_started(app.request_gen, ok(response));
    assert!(app.view.has_uncertain_upload());
    app.on_back();
    let saved = serde_json::from_value(serde_json::json!({
        "status": "ready_full", "kind": "FULL", "items": [], "writingPrompts": [], "sessionId": "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac",
        "speakingPrompts": [{ "id": "s0", "targetPhrase": "Hallo", "translation": "Hello", "referenceTtsUrl": null,
            "latestRecording": { "recordingId": "saved-upload", "status": "GRADING" } }]
    })).unwrap();
    app.on_practice_started(app.request_gen, ok(saved));
    assert!(matches!(app.current_section().map(|section| &section.progress), Some(SectionProgress::Speaking { phase: SpeakingPhase::UnknownUpload { .. }, .. })));
    assert!(app.view.has_uncertain_upload());
}
