fn placement_batch(status: &str) -> serde_json::Value {
    serde_json::json!({"native":"en","target":"es","placementSessionId":"d1438bc6-a9a6-4c4a-bf12-e7b11c79110a",
        "status":status,"questionsDigest":"d".repeat(64),"analysisId":null,"analysisRevision":null,"resultDigest":null,
        "expiresAt":"2099-01-01T00:00:00.000Z","failureReason":null,
        "questions":if status=="READY" {(0..6).map(|i|serde_json::json!({"id":format!("pq_{i}"),"cefr":"A1","skill":"grammar","prompt":format!("Choose {i}"),"options":["a","b","c","d","I do not know"]})).collect::<Vec<_>>()}else{vec![]}})
}

async fn placement_server(
    replies: Vec<(u16, serde_json::Value)>,
) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let work = tokio::spawn(async move {
        let mut requests = vec![];
        for (status, body) in replies {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            loop {
                let mut bytes = [0; 4096];
                let n = socket.read(&mut bytes).await.unwrap();
                assert!(n > 0, "request ended before its body");
                received.extend_from_slice(&bytes[..n]);
                if let Some(end) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&received[..end]).to_lowercase();
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("content-length:")
                                .and_then(|s| s.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if received.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(received).unwrap());
            let body = body.to_string();
            socket.write_all(format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
        }
        requests
    });
    (url, work)
}

fn request_json(request: &str) -> serde_json::Value {
    assert!(
        request
            .to_lowercase()
            .contains("authorization: bearer test-key")
    );
    serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap()
}

#[tokio::test]
async fn queued_placement_polls_the_saved_session_and_submits_its_exact_digest() {
    let (url,server)=placement_server(vec![(202,placement_batch("QUEUED")),(200,placement_batch("READY")),(200,serde_json::json!({"courseId":"course","level":"A2","assessedLevel":"B1","confirmationReceiptId":"d1438bc6-a9a6-4c4a-bf12-e7b11c79110a","scoreBySkill":{}}))]).await;
    let client = SottoClient::new(&url, "test-key").unwrap();
    let request_id = uuid::Uuid::new_v4();
    let batch = client
        .generate_placement("en", "es", request_id, None, false)
        .await
        .unwrap();
    let answers = batch
        .questions
        .iter()
        .map(|q| types::SubmitPlacementRequestAnswersItem {
            id: q.id.clone().try_into().unwrap(),
            selected_index: 4,
        })
        .collect();
    let submit_id = uuid::Uuid::new_v4();
    let result = client
        .submit_placement(batch, submit_id, answers, false)
        .await
        .unwrap();
    assert_eq!(result.level.to_string(), "A2");
    let requests = server.await.unwrap();
    assert!(requests[0].starts_with("POST /api/v1/placement/generate "));
    assert_eq!(
        request_json(&requests[0])["requestId"],
        request_id.to_string()
    );
    assert!(requests[1].starts_with(
        "GET /api/v1/placement?placementSessionId=d1438bc6-a9a6-4c4a-bf12-e7b11c79110a "
    ));
    assert!(
        requests[1]
            .to_lowercase()
            .contains("authorization: bearer test-key")
    );
    let body = request_json(&requests[2]);
    assert_eq!(body["requestId"], submit_id.to_string());
    assert_eq!(body["questionsDigest"], "d".repeat(64));
    assert_eq!(body["answers"].as_array().unwrap().len(), 6);
}

#[tokio::test]
async fn recovery_and_changed_session_stop_without_another_admission() {
    for changed in [false, true] {
        let mut response = placement_batch(if changed {
            "READY"
        } else {
            "RECOVERY_REQUIRED"
        });
        if changed {
            response["placementSessionId"] = serde_json::json!(uuid::Uuid::new_v4());
        }
        let (url, server) =
            placement_server(vec![(202, placement_batch("QUEUED")), (200, response)]).await;
        let client = SottoClient::new(&url, "test-key").unwrap();
        assert!(
            client
                .generate_placement("en", "es", uuid::Uuid::new_v4(), None, false)
                .await
                .is_err()
        );
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        request_json(&requests[0]);
        assert!(requests[1].starts_with("GET "));
    }
}

#[tokio::test]
async fn source_placement_confirmation_uses_observed_revision_digest_and_explicit_partial_consent()
{
    let analysis_id = uuid::Uuid::new_v4();
    let digest = "e".repeat(64);
    let request_id = uuid::Uuid::new_v4();
    let content = "\u{feff}  exact\0notes 🗣  \n";
    let (url,server)=placement_server(vec![(202,serde_json::json!({"analysisId":analysis_id,"analysisRevision":3})),(200,serde_json::json!({"analysisId":analysis_id,"analysisRevision":3,"identityDigest":"f".repeat(64),"resultDigest":digest,"native":"en","target":"es","status":"PARTIAL","stale":false,"failureReason":null,"summary":{"inference":{"level":"B1","confidence":0.75,"rationale":"Source contains past-tense clauses."}}})),(201,serde_json::json!({"courseId":"course","level":"A2","addedVocabulary":0,"confirmationReceiptId":analysis_id}))]).await;
    let client = SottoClient::new(&url, "test-key").unwrap();
    let result = client
        .deduce_from_notes("en", "es", content, request_id)
        .await
        .unwrap();
    assert_eq!(result.status, "PARTIAL");
    let confirmation_id = uuid::Uuid::new_v4();
    client
        .confirm_from_notes(
            "en",
            "es",
            result.reference().unwrap(),
            confirmation_id,
            true,
        )
        .await
        .unwrap();
    let requests = server.await.unwrap();
    let body = request_json(&requests[0]);
    assert_eq!(body["requestId"], request_id.to_string());
    assert_eq!(body["content"], content);
    assert!(requests[1].starts_with(&format!("GET /api/v1/material-analyses/{analysis_id} ")));
    assert!(
        requests[1]
            .to_lowercase()
            .contains("authorization: bearer test-key")
    );
    let confirmed = request_json(&requests[2]);
    assert_eq!(confirmed["analysisId"], analysis_id.to_string());
    assert_eq!(confirmed["analysisRevision"], 3);
    assert_eq!(confirmed["resultDigest"], digest);
    assert_eq!(confirmed["acceptPartial"], true);
    assert_eq!(confirmed["requestId"], confirmation_id.to_string());
}
