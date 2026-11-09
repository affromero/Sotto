import AVFoundation
import CryptoKit
import XCTest
@testable import Sotto

@MainActor
final class ClassAssessmentTests: XCTestCase {
    func testLocalRecordingCanBeDiscardedOnlyAfterAnotherResponseCompletes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "learner")
        let store = try AssessmentSpeakingStore(client: client, classId: "class", classAttempt: 1,
            assessmentId: "assessment", revision: String(repeating: "a", count: 64), promptId: "prompt", directory: root)
        let saved = try store.retain(audio: Data([1, 2, 3]))
        let decoder = JSONDecoder()
        let running = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data(#"{"status":"RUNNING","requestId":"10000000-0000-4000-8000-000000000001"}"#.utf8))
        let own = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data("{\"status\":\"COMPLETED\",\"requestId\":\"\(saved.requestId.uuidString)\"}".utf8))
        let other = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data(#"{"status":"COMPLETED","requestId":"10000000-0000-4000-8000-000000000001"}"#.utf8))
        XCTAssertThrowsError(try store.discardSuperseded(saved, status: running))
        XCTAssertThrowsError(try store.discardSuperseded(saved, status: own))
        XCTAssertEqual(try store.load(), saved)
        try store.discardSuperseded(saved, status: other)
        XCTAssertNil(try store.load())
    }

    func testInterruptedSpeakingCaptureCanBeRecoveredAndConfirmed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "learner")
        func store() throws -> AssessmentSpeakingStore {
            try AssessmentSpeakingStore(client: client, classId: "class", classAttempt: 1,
                assessmentId: "assessment", revision: String(repeating: "a", count: 64), promptId: "prompt", directory: root)
        }
        let file = try store().beginCapture()
        let active = try XCTUnwrap(AssessmentSpeakingStore.pendingCaptures(client: client, classId: "class", classAttempt: 1, directory: root).first)
        XCTAssertThrowsError(try store().discardUnsentCapture(requestId: active.requestId))
        XCTAssertTrue(try AssessmentSpeakingStore.hasCapture(client: client, classId: "class", classAttempt: 1, directory: root))
        XCTAssertFalse(try AssessmentSpeakingStore.hasCapture(client: client, classId: "class", classAttempt: 2, directory: root))
        try store().endCapture()
        XCTAssertThrowsError(try store().finishCapture())
        func writeRecording() throws {
            let settings: [String: Any] = [AVFormatIDKey: Int(kAudioFormatLinearPCM), AVSampleRateKey: 16_000,
                                           AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16]
            let audioFile = try AVAudioFile(forWriting: file, settings: settings)
            let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: audioFile.processingFormat, frameCapacity: 160))
            buffer.frameLength = 160
            try audioFile.write(from: buffer)
        }
        try writeRecording()
        let audio = try Data(contentsOf: file)
        let captures = try AssessmentSpeakingStore.pendingCaptures(client: client, classId: "class", classAttempt: 1, directory: root)
        XCTAssertEqual(captures.first?.assessmentId, "assessment")
        XCTAssertEqual(captures.first?.audioURL, file)
        XCTAssertThrowsError(try store().beginCapture())
        XCTAssertEqual(try store().recoverCapture(), file)
        let saved = try store().finishCapture()
        XCTAssertEqual(saved.audio, audio)
        XCTAssertEqual(try store().finishCapture(), saved)
        let completed = try JSONDecoder().decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data("{\"status\":\"COMPLETED\",\"requestId\":\"\(saved.requestId.uuidString)\"}".utf8))
        try store().clearConfirmed(saved, status: completed)
        XCTAssertNil(try store().recoverCapture())
        XCTAssertNil(try store().load())
        XCTAssertFalse(try AssessmentSpeakingStore.hasCapture(client: client, classId: "class", classAttempt: 1, directory: root))
    }

    func testUnsentCaptureCanBeDiscardedAfterInterruption() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "learner")
        let store = try AssessmentSpeakingStore(client: client, classId: "class", classAttempt: 1,
            assessmentId: "old-assessment", revision: String(repeating: "a", count: 64), promptId: "prompt", directory: root)
        let file = try store.beginCapture()
        store.endCapture()
        try FileManager.default.removeItem(at: file)
        let pending = try AssessmentSpeakingStore.pendingCaptures(client: client, classId: "class", classAttempt: 1, directory: root)
        XCTAssertEqual(pending.first?.assessmentId, "old-assessment")
        XCTAssertNil(pending.first?.audioURL)
        XCTAssertThrowsError(try store.discardUnsentCapture(requestId: UUID()))
        try store.discardUnsentCapture(requestId: try XCTUnwrap(pending.first).requestId)
        XCTAssertTrue(try AssessmentSpeakingStore.pendingCaptures(client: client, classId: "class", classAttempt: 1, directory: root).isEmpty)
    }

    func testAssessmentRequiresEverySpeakingResponseToBeCompleted() throws {
        let decoder = JSONDecoder()
        let material = try decoder.decode(SottoClassAssessmentMaterial.self, from: Data(#"{"id":"assessment","classAttempt":1,"assessmentAttempt":1,"sections":[{"id":"speaking","skill":"SPEAKING","items":[{"id":"first"},{"id":"second"}]}]}"#.utf8))
        let complete = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data(#"{"status":"COMPLETED","requestId":"10000000-0000-4000-8000-000000000001"}"#.utf8))
        let running = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data(#"{"status":"RUNNING","requestId":"10000000-0000-4000-8000-000000000002"}"#.utf8))
        XCTAssertFalse(material.speakingIsComplete([:]))
        XCTAssertFalse(material.speakingIsComplete(["first": complete]))
        XCTAssertFalse(material.speakingIsComplete(["first": complete, "second": running]))
        XCTAssertTrue(material.speakingIsComplete(["first": complete, "second": complete]))
    }

    func testSpeakingRecordingSurvivesReloadAndClearsOnlyForItsCompletedRequest() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "learner")
        let other = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "other")
        func store(_ client: SottoAPIClient) throws -> AssessmentSpeakingStore {
            try AssessmentSpeakingStore(client: client, classId: "class", classAttempt: 1,
                assessmentId: "assessment", revision: String(repeating: "a", count: 64), promptId: "prompt", directory: root)
        }
        let original = try store(client)
        let saved = try original.retain(audio: Data([0x52, 0x49, 0x46, 0x46]))
        XCTAssertEqual(try store(client).load(), saved)
        XCTAssertNil(try store(other).load())
        XCTAssertEqual(try AssessmentSpeakingStore.pending(client: client, classId: "class", classAttempt: 1, directory: root).first?.recording, saved)
        XCTAssertTrue(try AssessmentSpeakingStore.pending(client: other, classId: "class", classAttempt: 1, directory: root).isEmpty)
        XCTAssertThrowsError(try original.retain(audio: Data([1])))
        let decoder = JSONDecoder()
        let wrong = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data(#"{"status":"COMPLETED","requestId":"10000000-0000-4000-8000-000000000001"}"#.utf8))
        XCTAssertThrowsError(try original.clearConfirmed(saved, status: wrong))
        let running = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data("{\"status\":\"RUNNING\",\"requestId\":\"\(saved.requestId.uuidString)\"}".utf8))
        XCTAssertThrowsError(try original.clearConfirmed(saved, status: running))
        XCTAssertEqual(try original.load(), saved)
        XCTAssertThrowsError(try original.discardConfirmedFailure(saved, status: running))
        let completed = try decoder.decode(SottoClassAssessmentSpeakingStatus.self,
            from: Data("{\"status\":\"COMPLETED\",\"requestId\":\"\(saved.requestId.uuidString)\"}".utf8))
        try original.clearConfirmed(saved, status: completed)
        XCTAssertNil(try original.load())
    }

    func testSpeakingRecordingRejectsChangedProtectedFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "learner")
        let store = try AssessmentSpeakingStore(client: client, classId: "class", classAttempt: 1,
            assessmentId: "assessment", revision: String(repeating: "a", count: 64), promptId: "prompt", directory: root)
        _ = try store.retain(audio: Data([1, 2, 3]))
        let owner = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first)
        let folder = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: owner, includingPropertiesForKeys: nil).first)
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).first)
        try Data("changed".utf8).write(to: file)
        XCTAssertThrowsError(try store.load())
        XCTAssertThrowsError(try store.retain(audio: Data([4])))
    }
    func testAssessmentSpeakingUploadsExactRequestIdentityAndReadsStatus() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AssessmentHTTP.self]
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key",
                                    profileId: "learner", session: URLSession(configuration: configuration))
        let audio = Data([0x52, 0x49, 0x46, 0x46])
        let id = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
        let recording = RetainedAssessmentSpeaking(requestId: id, audio: audio,
            sha256: SHA256.hash(data: audio).map { String(format: "%02x", $0) }.joined())
        let uploaded = try await client.uploadAssessmentSpeaking(classId: "class", assessmentId: "assessment",
                                                                  promptId: "prompt", recording: recording)
        XCTAssertEqual(uploaded.status, .running)
        XCTAssertEqual(uploaded.requestId, id.uuidString.lowercased())
        let fetched = try await client.fetchAssessmentSpeaking(classId: "class", assessmentId: "assessment", promptId: "prompt")
        XCTAssertEqual(fetched, uploaded)
        let different = RetainedAssessmentSpeaking(requestId: UUID(uuidString: "10000000-0000-4000-8000-000000000002")!, audio: audio, sha256: recording.sha256)
        do {
            _ = try await client.uploadAssessmentSpeaking(classId: "class", assessmentId: "assessment", promptId: "prompt", recording: different)
            XCTFail("A different server recording must not confirm this upload")
        } catch {
            XCTAssertTrue(error is SottoAPIError)
        }
        do {
            _ = try await client.fetchAssessmentSpeaking(classId: "class", assessmentId: "..", promptId: "prompt")
            XCTFail("Dot segments must not change the request path")
        } catch {
            XCTAssertTrue(error is SottoAPIError)
        }
    }

    func testAssessmentSpeakingRejectsMissingOrInvalidRequestIdentity() throws {
        for value in [#"{"status":"RUNNING"}"#, #"{"status":"COMPLETED","requestId":"bad"}"#,
                      #"{"status":"NOT_STARTED","requestId":"10000000-0000-4000-8000-000000000001"}"#] {
            let status = try JSONDecoder().decode(SottoClassAssessmentSpeakingStatus.self, from: Data(value.utf8))
            XCTAssertThrowsError(try status.validate())
        }
    }
    func testReadsOwnedAssessmentStatusAndMaterial() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AssessmentHTTP.self]
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key",
                                    profileId: "learner", session: URLSession(configuration: configuration))
        let status = try await client.fetchClassAssessmentStatus(classId: "class", attempt: 1)
        XCTAssertEqual(status.status, .ready)
        let material = try await client.fetchClassAssessment(classId: "class", assessmentId: "assessment", attempt: 1)
        XCTAssertEqual(material.sections.first?.items.first?.question, "Choose a greeting")
    }

    func testRejectsMismatchedAttemptsAndMalformedQuestions() throws {
        let status = try JSONDecoder().decode(SottoClassAssessmentStatus.self, from: Data(AssessmentHTTP.status.utf8))
        XCTAssertThrowsError(try status.validate(expectedAttempt: 2))
        let bad = AssessmentHTTP.material.replacingOccurrences(of: #"["Hello","Bye","Yes","No"]"#,
                                                                 with: #"["Hello","Bye"]"#)
        let material = try JSONDecoder().decode(SottoClassAssessmentMaterial.self, from: Data(bad.utf8))
        XCTAssertThrowsError(try material.validate(assessmentId: "assessment", classAttempt: 1))
    }

    func testAnswerCorrectionRequiresTheSameUnsubmittedAssessment() throws {
        let decoder = JSONDecoder()
        let status = try decoder.decode(SottoClassAssessmentStatus.self, from: Data(AssessmentHTTP.status.utf8))
        let raw = #"{"id":"class","courseId":"course","status":"IN_PROGRESS","order":1,"passThreshold":0.7,"submitted":false,"attempt":1,"sections":[]}"#
        let detail = try decoder.decode(SottoClassDetail.self, from: Data(raw.utf8))
        let revision = String(repeating: "a", count: 64)
        XCTAssertNoThrow(try status.validateUnlock(classDetail: detail, classId: "class", attempt: 1,
                                                   assessmentId: "assessment", revision: revision))
        let submitted = try decoder.decode(SottoClassDetail.self, from: Data(raw.replacingOccurrences(of: #""submitted":false"#, with: #""submitted":true"#).utf8))
        XCTAssertThrowsError(try status.validateUnlock(classDetail: submitted, classId: "class", attempt: 1,
                                                       assessmentId: "assessment", revision: revision))
        XCTAssertThrowsError(try status.validateUnlock(classDetail: detail, classId: "class", attempt: 1,
                                                       assessmentId: "other", revision: revision))
        XCTAssertThrowsError(try status.validateUnlock(classDetail: detail, classId: "class", attempt: 1,
                                                       assessmentId: "assessment", revision: String(repeating: "b", count: 64)))
        let noAttempt = try decoder.decode(SottoClassDetail.self, from: Data(raw.replacingOccurrences(of: ",\"attempt\":1", with: "").utf8))
        XCTAssertThrowsError(try status.validateUnlock(classDetail: noAttempt, classId: "class", attempt: 1,
                                                       assessmentId: "assessment", revision: revision))
    }

    func testPreparesSavesWritingAndSubmitsExactChoices() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AssessmentHTTP.self]
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key",
                                    profileId: "learner", session: URLSession(configuration: configuration))
        let revision = String(repeating: "a", count: 64)
        let prepared = try await client.prepareClassAssessment(classId: "class", attempt: 1, revision: revision)
        XCTAssertEqual(prepared.status, .pending)
        let saved = try await client.saveAssessmentWriting(classId: "class", assessmentId: "assessment",
                                                           promptId: "writing", text: "Привет")
        XCTAssertEqual(saved.status, .running)
        let receipt = try await client.submitClassAssessment(classId: "class", assessmentId: "assessment",
                                                              choices: [SottoPracticeAnswer(itemId: "q1", selectedIndex: 1)])
        XCTAssertEqual(receipt.source, "ASSESSMENT")
        XCTAssertFalse(receipt.passed)
    }

    func testRetainsExactSubmissionAndScopesItToTheLearner() throws {
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "learner")
        let other = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: "other")
        let classId = UUID().uuidString
        let revision = String(repeating: "a", count: 64)
        let saved = ClassAssessmentWorkStore(client: client, classId: classId, classAttempt: 1,
                                             assessmentId: "assessment", revision: revision)
        let separate = ClassAssessmentWorkStore(client: other, classId: classId, classAttempt: 1,
                                                assessmentId: "assessment", revision: revision)
        try saved.saveDrafts(choices: ["q2": 2, "q1": 1], drafts: ["writing": "Привет"])
        XCTAssertTrue(try separate.load().choices.isEmpty)
        let pending = try saved.lockSubmission()
        XCTAssertEqual(try ClassAssessmentWorkStore.pending(client: client, classId: classId, classAttempt: 1)
            .map(\.assessmentId), ["assessment"])
        XCTAssertTrue(try ClassAssessmentWorkStore.pending(client: other, classId: classId, classAttempt: 1).isEmpty)
        XCTAssertEqual(pending.map(\.itemId), ["q1", "q2"])
        XCTAssertEqual(try saved.lockSubmission(), pending)
        XCTAssertThrowsError(try saved.saveDrafts(choices: ["q1": 0], drafts: [:]))
        XCTAssertThrowsError(try saved.unlockRejected(choices: pending))
        XCTAssertThrowsError(try saved.markRejected(choices: []))
        try saved.markRejected(choices: pending)
        XCTAssertThrowsError(try saved.unlockRejected(choices: []))
        XCTAssertEqual(try saved.load().pending, pending)
        try saved.unlockRejected(choices: pending)
        XCTAssertEqual(try saved.load().choices, ["q1": 1, "q2": 2])
        XCTAssertEqual(try saved.lockSubmission(), pending)
        let receipt = try JSONDecoder().decode(SottoClassSubmitResult.self, from: Data(AssessmentHTTP.receipt.utf8))
        XCTAssertThrowsError(try saved.clearConfirmed(choices: pending, receipt: receipt, confirmedWriting: [:]))
        XCTAssertEqual(try saved.load().drafts["writing"], "Привет")
        try saved.clearConfirmed(choices: pending, receipt: receipt, confirmedWriting: ["writing": "Привет"])
        XCTAssertTrue(try saved.load().choices.isEmpty)
    }
}

private final class AssessmentHTTP: URLProtocol {
    static let status = #"{"status":"READY","classAttempt":1,"assessmentId":"assessment","revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#
    static let material = #"{"id":"assessment","classAttempt":1,"assessmentAttempt":1,"sections":[{"id":"grammar","skill":"GRAMMAR","passageText":null,"audioAvailable":false,"items":[{"id":"q1","question":"Choose a greeting","options":["Hello","Bye","Yes","No"]}]}]}"#
    static let receipt = #"{"source":"ASSESSMENT","passed":false,"overallScore":0.5,"passedSections":0,"totalSections":1,"sections":[{"id":"grammar","skill":"GRAMMAR","score":0.5,"passed":false}]}"#
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
        XCTAssertFalse(request.httpShouldHandleCookies)
        let path = request.url!.path
        let method = request.httpMethod ?? "GET"
        var requestBody = request.httpBody
        if requestBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
            stream.close()
            requestBody = data
        }
        let body: String
        if path.hasSuffix("/speaking/prompt") {
            if method == "POST" {
                let multipart = String(decoding: requestBody ?? Data(), as: UTF8.self)
                XCTAssertTrue(multipart.contains("name=\"requestId\""))
                XCTAssertTrue(multipart.contains("10000000-0000-4000-8000-000000000001") ||
                              multipart.contains("10000000-0000-4000-8000-000000000002"))
                XCTAssertTrue(multipart.contains("RIFF"))
            }
            body = #"{"status":"RUNNING","requestId":"10000000-0000-4000-8000-000000000001"}"#
        } else if method == "POST" && path.hasSuffix("/status") {
            let payload = try? JSONSerialization.jsonObject(with: requestBody ?? Data()) as? [String: Any]
            XCTAssertEqual(payload?["revision"] as? String, String(repeating: "a", count: 64))
            body = #"{"status":"PENDING","classAttempt":1,"revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#
        } else if path.hasSuffix("/writing/writing") {
            if method == "POST" {
                let payload = try? JSONSerialization.jsonObject(with: requestBody ?? Data()) as? [String: Any]
                XCTAssertEqual(payload?["text"] as? String, "Привет")
            }
            body = #"{"status":"RUNNING","text":"Привет"}"#
        } else if method == "POST" {
            let payload = try? JSONSerialization.jsonObject(with: requestBody ?? Data()) as? [String: Any]
            let choices = payload?["choices"] as? [[String: Any]]
            XCTAssertEqual(choices?.first?["itemId"] as? String, "q1")
            XCTAssertEqual(choices?.first?["selectedIndex"] as? Int, 1)
            body = Self.receipt
        } else {
            body = path.hasSuffix("/status") ? Self.status : Self.material
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
