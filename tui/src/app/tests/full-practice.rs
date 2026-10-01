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
        "submitted": false, "attempt": 4, "progressRevision": 2, "writingDrafts": { "w0": "My draft" },
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
async fn class_conflict_reconciliation_cannot_apply_a_new_attempt_revision_to_old_material() {
    let mut app = test_app();
    app.view = View::class_view(course("A"), "class-saved".into());
    if let View::Class { attempt, progress, .. } = &mut app.view {
        *attempt = 4; progress.revision = 2; progress.conflict = true; progress.in_flight = Some(17);
    }
    app.on_practice_reconciled("CLASS/class-saved/4".into(), 17, ok(serde_json::json!({
        "id": "class-saved", "status": "IN_PROGRESS", "attempt": 5, "progressRevision": 9
    })));
    let View::Class { progress, .. } = &app.view else { panic!("class") };
    assert_eq!(progress.revision, 2);
    assert!(progress.conflict);
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
    assert!(matches!(app.current_section().map(|section| &section.progress), Some(SectionProgress::Speaking { phase: SpeakingPhase::Polling { recording_id }, .. }) if recording_id == "saved-upload"));
    assert!(!app.view.has_uncertain_upload());
}
