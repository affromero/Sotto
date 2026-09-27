import AVFoundation
import XCTest

@testable import Sotto

final class AudioDownloadTests: XCTestCase {
    func testRelativeAudioDownloadsWithLearnerCredentialsToALocalFile() async throws {
        let file = try await client().downloadLearningAudio(from: "/api/v1/storage/lesson.mp3")
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertTrue(file.isFileURL)
        XCTAssertEqual(try Data(contentsOf: file), Data("audio fixture".utf8))
    }

    func testExternalAudioDownloadsWithoutLearnerCredentials() async throws {
        let file = try await client().downloadLearningAudio(from: "https://cdn.example/lesson.mp3")
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertEqual(try Data(contentsOf: file), Data("audio fixture".utf8))
    }

    func testMissingAndLoginPageResponsesAreVisibleErrors() async {
        for path in ["/missing.mp3", "/login.mp3"] {
            do {
                let file = try await client().downloadLearningAudio(from: path)
                try? FileManager.default.removeItem(at: file)
                XCTFail("An error response must never become playable audio.")
            } catch {
                XCTAssertTrue(error.localizedDescription.contains(path.contains("missing") ? "404" : "instead of listening audio"))
            }
        }
    }

    func testUnsupportedAudioReferenceIsRejected() async {
        do {
            _ = try await client().downloadLearningAudio(from: "file:///etc/passwd")
            XCTFail("Device files are not server media.")
        } catch { XCTAssertTrue(error.localizedDescription.contains("not supported")) }
    }

    private func client() -> SottoAPIClient { AudioDownloadTestProtocol.client() }
}

final class AudioDownloadTestProtocol: URLProtocol {
    static func client() -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AudioDownloadTestProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "audio-key", profileId: "learner", session: URLSession(configuration: configuration))
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let local = request.url?.host == "school.example"
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), local ? "Bearer audio-key" : nil)
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), local ? "learner" : nil)
        XCTAssertFalse(request.httpShouldHandleCookies)
        let status = request.url?.path == "/missing.mp3" ? 404 : 200
        let mime = request.url?.path == "/login.mp3" ? "text/html" : "audio/mpeg"
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": mime])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("audio fixture".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
final class AudioPlaybackTests: XCTestCase {
    func testStoppingPlaybackRemovesDownloadedAudio() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: file) }
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 160))
        buffer.frameLength = 160
        for index in 0..<160 { buffer.floatChannelData?[0][index] = 0 }
        let output = try AVAudioFile(forWriting: file, settings: format.settings)
        try output.write(from: buffer)
        let playback = LearnerAudioPlayback()
        playback.toggle { file }
        let deadline = Date().addingTimeInterval(2)
        while playback.isLoading, Date() < deadline { await Task.yield() }
        XCTAssertNil(playback.errorMessage)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
        playback.stop()
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertFalse(playback.isPlaying)
    }

    func testClosingDuringDownloadDeletesTheLateFileWithoutPlaying() async throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("audio fixture".utf8).write(to: file)
        defer { try? FileManager.default.removeItem(at: file) }
        let playback = LearnerAudioPlayback()
        let started = expectation(description: "Download is pending")
        var pending: CheckedContinuation<URL, Error>?
        playback.toggle {
            try await withCheckedThrowingContinuation { continuation in
                pending = continuation
                started.fulfill()
            }
        }
        await fulfillment(of: [started], timeout: 2)
        playback.stop()
        try XCTUnwrap(pending).resume(returning: file)
        let deleted = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !FileManager.default.fileExists(atPath: file.path)
        }, object: nil)
        await fulfillment(of: [deleted], timeout: 2)
        XCTAssertFalse(playback.isPlaying)
        XCTAssertFalse(playback.isLoading)
    }

    func testDownloadFailureIsShownWithoutStartingPlayback() async {
        let playback = LearnerAudioPlayback()
        playback.toggle { throw SottoAPIError.message("Audio unavailable") }
        let deadline = Date().addingTimeInterval(2)
        while playback.errorMessage == nil, Date() < deadline { await Task.yield() }
        XCTAssertEqual(playback.errorMessage, "Audio unavailable")
        XCTAssertFalse(playback.isPlaying)
        XCTAssertFalse(playback.isLoading)
    }
}
