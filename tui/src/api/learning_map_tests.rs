#[tokio::test]
async fn canonical_map_transport_preserves_level_selection_and_transition_identity() {
    use super::learning_map_fixtures::{completion, map, preview};
    let practice_id = uuid::Uuid::new_v4();
    let advance_id = uuid::Uuid::new_v4();
    let (url, server) = placement_server(vec![
        (200, map("course-1", "A2", "A2", false)),
        (200, map("course-1", "A1", "A2", false)),
        (200, preview("A1")),
        (202, serde_json::json!({"status":"preparing","sessionId":practice_id,"preparationStatus":"QUEUED","canRecover":false,"message":"Saved exact practice."})),
        (200, completion("course-1", "A2")),
    ]).await;
    let client = SottoClient::new(&url, "test-key").unwrap();
    client.learning_map("course-1", None).await.unwrap();
    client.learning_map("course-1", Some("A1")).await.unwrap();
    let selected: types::LearningSelectionRequest = serde_json::from_value(serde_json::json!({
        "catalogVersion":1,"level":"A1","nodeIds":["es.g.perfect"]
    }))
    .unwrap();
    client
        .preview_learning_selection("course-1", selected.clone())
        .await
        .unwrap();
    client
        .start_selected_practice(
            "course-1",
            types::PracticeKind::Grammar,
            practice_id,
            selected,
        )
        .await
        .unwrap();
    client
        .advance_learning_level(
            "course-1",
            serde_json::from_value(serde_json::json!({
                "requestId":advance_id,"expectedLevel":"A2","catalogHash":"a".repeat(64)
            }))
            .unwrap(),
        )
        .await
        .unwrap();
    let requests = server.await.unwrap();
    assert!(requests[0].starts_with("GET /api/v1/courses/course-1/learning-map "));
    assert!(requests[1].starts_with("GET /api/v1/courses/course-1/learning-map/levels/A1 "));
    assert!(requests[2].starts_with("POST /api/v1/courses/course-1/learning-map/selection "));
    assert!(requests[3].starts_with("POST /api/v1/courses/course-1/practice "));
    assert!(requests[4].starts_with("POST /api/v1/courses/course-1/learning-map/advance "));
    for request in &requests {
        assert!(
            request
                .to_lowercase()
                .contains("authorization: bearer test-key")
        );
    }
    let practice = request_json(&requests[3]);
    assert_eq!(practice["requestId"], practice_id.to_string());
    assert_eq!(practice["learningSelection"]["level"], "A1");
    assert_eq!(
        practice["learningSelection"]["nodeIds"],
        serde_json::json!(["es.g.perfect"])
    );
    assert_eq!(
        request_json(&requests[4])["requestId"],
        advance_id.to_string()
    );
    assert_eq!(request_json(&requests[4])["expectedLevel"], "A2");
}

#[tokio::test]
async fn map_rejection_surfaces_without_another_language_or_endpoint() {
    let (url, server) = placement_server(vec![(
        422,
        serde_json::json!({"error":"Catalog unavailable"}),
    )])
    .await;
    let client = SottoClient::new(&url, "test-key").unwrap();
    assert!(client.learning_map("owned", None).await.is_err());
    let requests = server.await.unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /api/v1/courses/owned/learning-map "));
}

#[tokio::test]
async fn generated_optional_queries_preserve_unpaginated_analysis_polling() {
    let analysis_id = uuid::Uuid::new_v4().to_string();
    let (url, server) = placement_server(vec![
        (404, serde_json::json!({"error":"Analysis not found"})),
        (404, serde_json::json!({"error":"Analysis not found"})),
    ])
    .await;
    let client = SottoClient::new(&url, "test-key").unwrap();
    assert!(client.inner.get_material_analysis(&analysis_id, None).await.is_err());
    assert!(client.inner.get_material_analysis(&analysis_id, Some("12")).await.is_err());
    let requests = server.await.unwrap();
    assert!(requests[0].starts_with(&format!("GET /api/v1/material-analyses/{analysis_id} ")));
    assert!(requests[1].starts_with(&format!("GET /api/v1/material-analyses/{analysis_id}?afterOrder=12 ")));
    for request in requests {
        assert!(request.to_lowercase().contains("authorization: bearer test-key"));
    }
}
