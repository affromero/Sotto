    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Accept one connection, read the raw HTTP request, reply 201 with a JSON
    /// body, and return the captured request bytes. A loopback stand-in for the
    /// route — no real backend — so the multipart form construction is verified
    /// deterministically.
    async fn capture_one_request(listener: TcpListener) -> String {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = vec![0u8; 64 * 1024];
        // A single read captures the small request (headers + tiny WAV body).
        let n = socket.read(&mut buf).await.expect("read request");
        let request = String::from_utf8_lossy(&buf[..n]).to_string();

        let body = br#"{"recordingId":"rec-42","status":"PENDING"}"#;
        let response = format!(
            "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write head");
        socket.write_all(body).await.expect("write body");
        let _ = socket.flush().await;
        request
    }

    #[tokio::test]
    async fn upload_speaking_builds_an_audio_multipart_part() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_one_request(listener));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let wav = b"RIFF....WAVEfake".to_vec();
        let resp = client
            .upload_speaking("sess-1", "prompt-1", wav)
            .await
            .expect("upload ok");

        // Parsed the canned 201 body.
        assert_eq!(resp.recording_id, "rec-42");
        assert_eq!(resp.status, "PENDING");

        // The captured request carries the right multipart part + auth + path.
        // HTTP header-name case is not normative (reqwest emits request headers
        // lowercase but multipart part headers capitalized), so match case-
        // insensitively on header keywords while keeping field values exact.
        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/practice/sess-1/speaking/prompt-1"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("content-type: multipart/form-data"),
            "must be multipart"
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "bearer header must ride along"
        );
        assert!(
            request.contains(r#"name="audio""#),
            "form field must be `audio`"
        );
        assert!(
            request.contains(r#"filename="attempt.wav""#),
            "filename must be attempt.wav"
        );
        assert!(
            lower.contains("content-type: audio/wav"),
            "part mime must be audio/wav"
        );
        assert!(
            request.contains("RIFF....WAVEfake"),
            "wav bytes in the body"
        );
    }

    #[tokio::test]
    async fn download_does_not_send_the_sotto_api_key() {
        // A presigned/CDN URL is self-authenticating; the Sotto bearer key must
        // never be attached, or it leaks to the third-party host. The download
        // client has no default Authorization header.
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_one_request(listener));

        let client = SottoClient::new("http://sotto.invalid", "secret-key").expect("client");
        // Point at the loopback "CDN"; the response body is irrelevant here.
        let _ = client
            .download(&format!("http://{addr}/presigned/seg1.mp3?sig=abc"))
            .await
            .expect("download ok");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /presigned/seg1.mp3"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            !lower.contains("authorization:"),
            "download must NOT carry any Authorization header; request was:\n{request}"
        );
        assert!(
            !request.contains("secret-key"),
            "the Sotto API key must never appear in a download request"
        );
    }

    #[tokio::test]
    async fn saved_class_audio_uses_the_authenticated_server_and_encoded_identifiers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![0; 8192];
            let count = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).to_string();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: 4\r\nConnection: close\r\n\r\nRIFF").await.unwrap();
            request
        });
        let client = SottoClient::new(&format!("http://{addr}"), "secret-key").unwrap();
        assert_eq!(client.class_history_audio("class", "prompt/other", "recording").await.unwrap(), b"RIFF");
        let request = server.await.unwrap();
        assert!(request.starts_with("GET /api/v1/classes/class/speaking/prompt%2Fother/recordings/recording/audio "));
        assert!(request.to_ascii_lowercase().contains("authorization: bearer secret-key"));
    }

    #[tokio::test]
    async fn saved_class_audio_never_follows_redirects_with_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let target_addr = target.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 8192];
            let _ = socket.read(&mut bytes).await.unwrap();
            let response = format!("HTTP/1.1 302 Found\r\nLocation: http://{target_addr}/audio\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        let client = SottoClient::new(&format!("http://{addr}"), "secret-key").unwrap();
        assert!(client.class_history_audio("class", "prompt", "recording").await.is_err());
        server.await.unwrap();
        assert!(tokio::time::timeout(std::time::Duration::from_millis(100), target.accept()).await.is_err());
    }

    #[tokio::test]
    async fn saved_class_audio_rejects_oversized_responses_before_buffering() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 8192];
            let _ = socket.read(&mut bytes).await.unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: 67108865\r\nConnection: close\r\n\r\n").await.unwrap();
        });
        let client = SottoClient::new(&format!("http://{addr}"), "secret-key").unwrap();
        assert!(client.class_history_audio("class", "prompt", "recording").await.unwrap_err().to_string().contains("too large"));
        server.await.unwrap();
    }

    /// Accept one connection, read the raw HTTP request, and reply with the given
    /// `status_line` (e.g. "200 OK") + JSON `body`. Returns the captured request.
    /// A flexible loopback stand-in for any route, used to verify each
    /// hand-rolled method's path/method/query/body/auth + response parse.
    async fn capture_with_response(
        listener: TcpListener,
        status_line: &'static str,
        body: &'static str,
    ) -> String {
        let (mut socket, _) = listener.accept().await.expect("accept");
        let mut buf = vec![0u8; 64 * 1024];
        let n = socket.read(&mut buf).await.expect("read request");
        let request = String::from_utf8_lossy(&buf[..n]).to_string();
        let response = format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .await
            .expect("write head");
        socket.write_all(body.as_bytes()).await.expect("write body");
        let _ = socket.flush().await;
        request
    }

    #[tokio::test]
    async fn submit_class_writing_posts_text_json_with_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"overallScore":0.75,"feedback":"Nice work."}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let grade = client
            .submit_class_writing("cls-1", "w0", "mi respuesta".to_string())
            .await
            .expect("writing graded");
        assert_eq!(grade.overall_score, 0.75);
        assert_eq!(grade.feedback, "Nice work.");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/classes/cls-1/writing/w0"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(lower.contains("authorization: bearer test-key"), "bearer");
        assert!(
            lower.contains("content-type: application/json"),
            "json content-type"
        );
        assert!(
            request.contains(r#"{"text":"mi respuesta"}"#),
            "body must be {{text}}; got:\n{request}"
        );
    }

    #[tokio::test]
    async fn submit_exam_writing_posts_to_the_exam_writing_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"overallScore":0.5,"feedback":"ok"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let grade = client
            .submit_exam_writing("exam-9", "w1", "essay".to_string())
            .await
            .expect("writing graded");
        assert_eq!(grade.overall_score, 0.5);

        let request = server.await.expect("server task");
        assert!(
            request.starts_with("POST /api/v1/exams/exam-9/writing/w1"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            request
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key"),
            "bearer"
        );
        assert!(
            request.contains(r#"{"text":"essay"}"#),
            "body must be {{text}}"
        );
    }

    #[tokio::test]
    async fn poll_class_speaking_gets_with_recording_id_query_and_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"status":"SCORED","overallScore":0.9,"transcript":"hola","feedback":"great"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let poll = client
            .poll_class_speaking("cls-1", "p0", "rec-7")
            .await
            .expect("poll ok");
        assert_eq!(poll.overall_score, Some(0.9));
        assert_eq!(poll.transcript.as_deref(), Some("hola"));

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /api/v1/classes/cls-1/speaking/p0?recordingId=rec-7"),
            "request line (path + query): {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(lower.contains("authorization: bearer test-key"), "bearer");
    }

    #[tokio::test]
    async fn poll_exam_speaking_gets_with_recording_id_query() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"status":"PENDING","overallScore":null,"transcript":null,"feedback":null}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let poll = client
            .poll_exam_speaking("exam-9", "p1", "rec-8")
            .await
            .expect("poll ok");
        assert_eq!(poll.overall_score, None);

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /api/v1/exams/exam-9/speaking/p1?recordingId=rec-8"),
            "request line (path + query): {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "the exam-speaking poll must carry the bearer key"
        );
    }

    #[tokio::test]
    async fn upload_class_speaking_posts_multipart_to_the_class_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "201 Created",
            r#"{"recordingId":"rec-1","status":"PENDING"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let resp = client
            .upload_class_speaking("cls-2", "p3", &ClassSpeakingBinding { attempt: 4, material_revision: "a".repeat(64) }, b"RIFF....WAVEx".to_vec())
            .await
            .expect("upload ok");
        assert_eq!(resp.recording_id, "rec-1");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/classes/cls-2/speaking/p3"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("content-type: multipart/form-data"),
            "multipart"
        );
        assert!(lower.contains("authorization: bearer test-key"), "bearer");
        assert!(request.contains(r#"name="audio""#), "audio field");
        assert!(request.contains("name=\"expectedAttempt\"\r\n\r\n4"));
        assert!(request.contains(&format!("name=\"taskMaterialRevision\"\r\n\r\n{}", "a".repeat(64))));
    }

    #[tokio::test]
    async fn only_typed_prepublication_class_conflicts_are_definite_rejections() {
        for (status, definite) in [("409 Conflict", true), ("500 Internal Server Error", false)] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(capture_with_response(listener, status,
                r#"{"error":"class changed","code":"CLASS_MATERIAL_CHANGED"}"#));
            let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
            let error = client.upload_class_speaking("cls", "prompt", &ClassSpeakingBinding {
                attempt: 1, material_revision: "a".repeat(64),
            }, b"RIFF".to_vec()).await.unwrap_err();
            assert_eq!(error.downcast_ref::<ClassRecordingRejected>().is_some(), definite);
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn incomplete_upload_receipts_do_not_confirm_the_recording() {
        for body in [r#"{"recordingId":"","status":"PENDING"}"#, r#"{"recordingId":"rec","status":""}"#] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(capture_with_response(listener, "201 Created", body));
            let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
            let error = client.upload_class_speaking("cls", "prompt", &ClassSpeakingBinding {
                attempt: 1, material_revision: "a".repeat(64),
            }, b"RIFF".to_vec()).await.unwrap_err();
            assert!(error.to_string().contains("outcome is unknown"));
            assert!(error.downcast_ref::<ClassRecordingRejected>().is_none());
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn upload_exam_speaking_posts_multipart_to_the_exam_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "201 Created",
            r#"{"recordingId":"rec-2","status":"PENDING"}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let resp = client
            .upload_exam_speaking("exam-3", "p4", b"RIFF....WAVEy".to_vec())
            .await
            .expect("upload ok");
        assert_eq!(resp.recording_id, "rec-2");

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /api/v1/exams/exam-3/speaking/p4"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("content-type: multipart/form-data"),
            "multipart"
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "the exam-speaking upload must carry the bearer key"
        );
        assert!(
            request.contains(r#"name="audio""#),
            "form field must be `audio`"
        );
        assert!(
            request.contains(r#"filename="attempt.wav""#),
            "filename must be attempt.wav"
        );
        assert!(
            lower.contains("content-type: audio/wav"),
            "part mime must be audio/wav"
        );
        assert!(
            request.contains("RIFF....WAVEy"),
            "the uploaded wav bytes must be in the multipart body"
        );
    }

    #[tokio::test]
    async fn me_gets_users_me_with_bearer_and_parses_identity() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        let server = tokio::spawn(capture_with_response(
            listener,
            "200 OK",
            r#"{"id":"u_1","name":"Ada","email":"ada@example.com","image":null,"episodeCount":3}"#,
        ));

        let client = SottoClient::new(&format!("http://{addr}"), "test-key").expect("client");
        let me = client.me().await.expect("me ok");
        // Parses the identity subset; tolerates the extra `episodeCount` field.
        assert_eq!(me.id, "u_1");
        assert_eq!(me.name.as_deref(), Some("Ada"));
        assert_eq!(me.email.as_deref(), Some("ada@example.com"));

        let request = server.await.expect("server task");
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("GET /api/v1/users/me"),
            "request line: {}",
            request.lines().next().unwrap_or_default()
        );
        assert!(
            lower.contains("authorization: bearer test-key"),
            "the live identity call must carry the bearer key"
        );
    }

    #[tokio::test]
    async fn class_prelude_transport_preserves_recovery_and_receipt() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(capture_with_response(listener, "200 OK", r#"{"kind":"NOT_REQUIRED"}"#));
        let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
        client.class_prelude("class-1").await.unwrap();
        let captured = server.await.unwrap();
        assert!(captured.starts_with("GET /api/v1/classes/class-1/teaching-prelude "));
        assert!(captured.to_lowercase().contains("authorization: bearer test-key"));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let body = r#"{"kind":"ADDENDUM","nativeLang":"es","targetLang":"ru","status":"PENDING","request":{"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","snapshotHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}"#;
        let server = tokio::spawn(capture_with_response(listener, "202 Accepted", body));
        let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
        let request = serde_json::from_str(r#"{"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","snapshotHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#).unwrap();
        client.prepare_class_prelude("class-1", request, true).await.unwrap();
        let captured = server.await.unwrap();
        assert!(captured.starts_with("POST /api/v1/classes/class-1/teaching-prelude/prepare?recover=1 "));
        assert!(captured.to_lowercase().contains("authorization: bearer test-key"));
        let sent: serde_json::Value = serde_json::from_str(captured.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(sent["sourceHash"], "a".repeat(64));
        assert_eq!(sent["snapshotHash"], "b".repeat(64));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(capture_with_response(listener, "200 OK", r#"{"kind":"BASE","receiptId":"00000000-0000-4000-a000-000000000001","acknowledged":true}"#));
        let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
        let request = serde_json::from_value(serde_json::json!({"kind":"BASE","receiptId":"00000000-0000-4000-a000-000000000001"})).unwrap();
        client.acknowledge_class_prelude("class-1", request).await.unwrap();
        let captured = server.await.unwrap();
        assert!(captured.starts_with("POST /api/v1/classes/class-1/teaching-prelude/acknowledge "));
        assert!(captured.to_lowercase().contains("authorization: bearer test-key"));
        let sent: serde_json::Value = serde_json::from_str(captured.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(sent, serde_json::json!({"kind":"BASE","receiptId":"00000000-0000-4000-a000-000000000001"}));
    }

    #[tokio::test]
    async fn practice_admission_retries_keep_the_request_identity_and_accept_queued_work() {
        let request_id: uuid::Uuid = "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac".parse().unwrap();
        for _ in 0..2 {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(capture_with_response(listener, "202 Accepted", r#"{"status":"preparing","sessionId":"9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac","preparationStatus":"QUEUED","message":"Waiting for worker","canRecover":false}"#));
            let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
            let response = client.start_practice("course-1", types::PracticeKind::Full, request_id).await.unwrap();
            assert!(matches!(response, types::StartPracticeResponse::Preparing(saved) if saved.session_id == request_id.to_string()));
            let request = server.await.unwrap();
            assert!(request.starts_with("POST /api/v1/courses/course-1/practice "));
            assert!(request.to_lowercase().contains("authorization: bearer test-key"));
            let body: serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
            assert_eq!(body["requestId"], request_id.to_string());
            assert_eq!(body["kind"], "FULL");
        }
    }

    #[tokio::test]
    async fn practice_progress_sends_revision_and_all_local_work_with_bearer() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(capture_with_response(listener, "200 OK", r#"{"saved":true,"progressRevision":8}"#));
        let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
        let body = serde_json::from_value(serde_json::json!({ "expectedRevision": 7, "answers": { "g0": 1, "f0": 2 }, "writingDrafts": { "w0": "My unfinished draft" } })).unwrap();
        let response = client.save_learning_progress(false, "session-1", body).await.unwrap();
        assert_eq!(response.progress_revision.get(), 8);
        let request = server.await.unwrap();
        assert!(request.starts_with("PATCH /api/v1/practice/session-1 "));
        assert!(request.to_lowercase().contains("authorization: bearer test-key"));
        let body: serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["expectedRevision"], 7);
        assert_eq!(body["answers"]["f0"], 2);
        assert_eq!(body["writingDrafts"]["w0"], "My unfinished draft");
    }

    #[tokio::test]
    async fn practice_writing_returns_inline_corrections() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(capture_with_response(listener, "200 OK", r#"{"overallScore":0.7,"feedback":"Check agreement","corrections":[{"old":"Yo es","new":"Yo soy","why":"First person of ser"}]}"#));
        let client = SottoClient::new(&format!("http://{address}"), "test-key").unwrap();
        let grade = client.submit_practice_writing("session-1", "w0", "Yo es estudiante".into()).await.unwrap();
        assert_eq!(grade.corrections[0].new, "Yo soy");
        assert!(grade.corrections[0].why.contains("First person"));
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /api/v1/practice/session-1/writing/w0 "));
        assert!(request.to_lowercase().contains("authorization: bearer test-key"));
        let body: serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["text"], "Yo es estudiante");
    }

    #[tokio::test]
    async fn class_repair_accepts_queued_work_and_pins_the_observed_attempt() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(capture_with_response(listener, "202 Accepted",
            r#"{"started":true,"scope":"sections","status":"GENERATING","operationId":"9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac","courseId":"course1"}"#));
        let client = SottoClient::new(&format!("http://{addr}"), "class-key").unwrap();
        assert_eq!(client.repair_class("class-saved", 4).await.unwrap(),
            NextClassOutcome::Created { class_id: "class-saved".into() });
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /api/v1/classes/class-saved "));
        assert!(request.to_lowercase().contains("authorization: bearer class-key"));
        let body: serde_json::Value = serde_json::from_str(request.split("\r\n\r\n").last().unwrap()).unwrap();
        assert_eq!(body["expectedAttempt"], 4);
        assert_eq!(body["scope"], "sections");
    }

    #[tokio::test]
    async fn a_gated_class_can_be_resumed_from_the_next_class_action() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(capture_with_response(listener, "409 Conflict",
            r#"{"activeClassId":"class-existing","status":"IN_PROGRESS"}"#));
        let client = SottoClient::new(&format!("http://{addr}"), "class-key").unwrap();
        assert_eq!(client.next_class("course1").await.unwrap(),
            NextClassOutcome::Created { class_id: "class-existing".into() });
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /api/v1/courses/course1/next-class "));
        assert!(request.to_lowercase().contains("authorization: bearer class-key"));
    }
