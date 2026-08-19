import AVFoundation
import XCTest

@testable import Sotto

final class LiveTranslateTests: XCTestCase {
    private func token(
        value: String = "auth_tokens/abc123",
        model: String = "gemini-live-2.5-flash-preview",
        apiVersion: String = "v1alpha"
    ) -> LiveTranslateSession.Token {
        LiveTranslateSession.Token(
            token: value,
            model: model,
            apiVersion: apiVersion,
            targetLanguageCode: "de",
            nativeLanguageCode: "en",
            direction: "native_to_target",
            expiresAt: "2026-08-18T23:00:00.000Z"
        )
    }

    /// Ephemeral tokens use a different method name and query parameter than a
    /// plain API key. Getting either wrong fails the handshake, not the build.
    func testEphemeralTokenUsesConstrainedEndpoint() throws {
        let url = try XCTUnwrap(LiveTranslateSession.endpoint(for: token()))

        XCTAssertTrue(url.absoluteString.contains("BidiGenerateContentConstrained"))
        XCTAssertTrue(url.absoluteString.contains("access_token=auth_tokens/abc123"))
        XCTAssertFalse(url.absoluteString.contains("key=auth_tokens"))
        XCTAssertEqual(url.scheme, "wss")
    }

    func testPlainKeyUsesTheUnconstrainedEndpoint() throws {
        let url = try XCTUnwrap(LiveTranslateSession.endpoint(for: token(value: "AIzaSyPlainKey")))

        XCTAssertTrue(url.absoluteString.contains("GenerativeService.BidiGenerateContent?"))
        XCTAssertTrue(url.absoluteString.contains("key=AIzaSyPlainKey"))
    }

    func testApiVersionIsCarriedIntoThePath() throws {
        let url = try XCTUnwrap(LiveTranslateSession.endpoint(for: token(apiVersion: "v1alpha")))

        XCTAssertTrue(url.absoluteString.contains("google.ai.generativelanguage.v1alpha."))
    }

    func testBareModelIdsAreQualified() {
        XCTAssertEqual(
            LiveTranslateSession.qualifiedModel("gemini-live-2.5-flash-preview"),
            "models/gemini-live-2.5-flash-preview"
        )
        XCTAssertEqual(LiveTranslateSession.qualifiedModel("models/x"), "models/x")
        XCTAssertEqual(LiveTranslateSession.qualifiedModel("tunedModels/y"), "tunedModels/y")
    }

    /// translationConfig lives under generationConfig, and the transcription
    /// blocks sit at the top of setup. This mirrors the JS SDK's wire format.
    func testSetupFramePlacesTranslationUnderGenerationConfig() throws {
        let frame = LiveTranslateSession.setupFrame(for: token())
        let setup = try XCTUnwrap(frame["setup"] as? [String: Any])
        let generation = try XCTUnwrap(setup["generationConfig"] as? [String: Any])
        let translation = try XCTUnwrap(generation["translationConfig"] as? [String: Any])

        XCTAssertEqual(setup["model"] as? String, "models/gemini-live-2.5-flash-preview")
        XCTAssertEqual(generation["responseModalities"] as? [String], ["AUDIO"])
        XCTAssertEqual(translation["targetLanguageCode"] as? String, "de")
        XCTAssertNotNil(setup["inputAudioTranscription"])
        XCTAssertNotNil(setup["outputAudioTranscription"])
    }

    func testSetupFrameIsSerializable() throws {
        let data = try JSONSerialization.data(
            withJSONObject: LiveTranslateSession.setupFrame(for: token())
        )

        XCTAssertFalse(data.isEmpty)
    }

    func testAudioFrameDeclaresSixteenKilohertzPcm() throws {
        let frame = LiveTranslateSession.audioFrame(base64Pcm16k: "AAAB")
        let realtime = try XCTUnwrap(frame["realtimeInput"] as? [String: Any])
        let audio = try XCTUnwrap(realtime["audio"] as? [String: Any])

        XCTAssertEqual(audio["data"] as? String, "AAAB")
        XCTAssertEqual(audio["mimeType"] as? String, "audio/pcm;rate=16000")
    }

    func testServerAudioBecomesAnAudioEvent() {
        let events = LiveTranslateSession.events(from: [
            "serverContent": [
                "modelTurn": ["parts": [["inlineData": ["data": "QUJD", "mimeType": "audio/pcm"]]]]
            ]
        ])

        XCTAssertEqual(events, [.audio("QUJD")])
    }

    func testTranscriptsCarryTheirFinishedFlag() {
        let events = LiveTranslateSession.events(from: [
            "serverContent": [
                "inputTranscription": ["text": "hallo", "finished": true],
                "outputTranscription": ["text": "hello"],
            ]
        ])

        XCTAssertEqual(
            events,
            [.inputTranscript("hallo", finished: true), .outputTranscript("hello", finished: false)]
        )
    }

    func testInterruptionIsReported() {
        let events = LiveTranslateSession.events(from: ["serverContent": ["interrupted": true]])

        XCTAssertEqual(events, [.interrupted])
    }

    /// setupComplete, goAway and friends carry no serverContent; they must not
    /// produce spurious events.
    func testFramesWithoutServerContentAreIgnored() {
        XCTAssertTrue(LiveTranslateSession.events(from: ["setupComplete": [:]]).isEmpty)
        XCTAssertTrue(LiveTranslateSession.events(from: [:]).isEmpty)
    }

    func testEmptyTranscriptTextIsIgnored() {
        let events = LiveTranslateSession.events(from: [
            "serverContent": ["inputTranscription": ["text": ""]]
        ])

        XCTAssertTrue(events.isEmpty)
    }

    /// Playback buffers come back as raw Int16 at 24 kHz; a round trip must
    /// preserve the sample count.
    func testPcmRoundTripsThroughABuffer() throws {
        let format = try XCTUnwrap(
            AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: true)
        )
        let samples: [Int16] = [0, 1000, -1000, 32_767, -32_768]
        let data = samples.withUnsafeBufferPointer { Data(buffer: $0) }

        let buffer = try XCTUnwrap(LiveAudioEngine.buffer(from: data, format: format))

        XCTAssertEqual(Int(buffer.frameLength), samples.count)
        XCTAssertEqual(buffer.int16ChannelData?[0][3], 32_767)
        XCTAssertEqual(LiveAudioEngine.base64(from: buffer), data.base64EncodedString())
    }

    func testEmptyAudioDataProducesNoBuffer() throws {
        let format = try XCTUnwrap(
            AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: true)
        )

        XCTAssertNil(LiveAudioEngine.buffer(from: Data(), format: format))
    }

    func testMissingGoogleKeyIsRewrittenForALearner() {
        let shown = SottoLiveFailure.message(
            for: SottoAPIError.message("Could not start a live session. Your Google key may not have access to the Gemini Live model.")
        )

        XCTAssertTrue(shown.contains("web app"))
    }

    func testOrdinaryLiveFailurePassesThrough() {
        XCTAssertEqual(
            SottoLiveFailure.message(for: SottoAPIError.message("Course not found")),
            "Course not found"
        )
    }
}
