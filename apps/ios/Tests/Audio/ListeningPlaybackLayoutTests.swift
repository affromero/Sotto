import AVFoundation
import SwiftUI
import UIKit
import XCTest

@testable import Sotto

@MainActor
final class ListeningPlaybackLayoutTests: XCTestCase {
    func testSelectingAndPausingTurnsDoesNotMoveTheConversation() async throws {
        let turns = try JSONDecoder().decode([SottoListeningTurn].self, from: Data(#"""
        [{"id":"one","speaker":"Mia","text":"[V1:Gestern] war ich in Berlin.",
          "audioUrl":"/turn.wav","order":0,"startTime":0,"duration":4}]
        """#.utf8))
        for (width, textSize) in [(CGFloat(375), DynamicTypeSize.accessibility3),
                                  (CGFloat(1024), DynamicTypeSize.large)] {
            let playback = LearnerAudioPlayback()
            defer { playback.stop() }
            let view = LearnerAudioPlayer(reference: "/full.wav", turns: turns, playback: playback)
                .environmentObject(LayoutFixtures.model())
                .environment(\.dynamicTypeSize, textSize)
            let host = UIHostingController(rootView: view)
            host.loadViewIfNeeded()
            let constraint = CGSize(width: width, height: 20_000)
            let before = host.sizeThatFits(in: constraint).height

            let turnFile = try audioFile()
            let turnLoad = try XCTUnwrap(playback.toggle(reference: "/turn.wav") { turnFile })
            await turnLoad.value
            try await waitForDuration(playback)
            XCTAssertTrue(playback.isPlaying)
            XCTAssertEqual(host.sizeThatFits(in: constraint).height, before, accuracy: 1)

            playback.toggle(reference: "/turn.wav") { turnFile }
            XCTAssertFalse(playback.isPlaying)
            try await Task.sleep(for: .milliseconds(100))
            XCTAssertEqual(host.sizeThatFits(in: constraint).height, before, accuracy: 1)

            let fullFile = try audioFile()
            let fullLoad = try XCTUnwrap(playback.toggle(reference: "/full.wav") { fullFile })
            await fullLoad.value
            try await waitForDuration(playback)
            XCTAssertTrue(playback.isPlaying)
            XCTAssertEqual(host.sizeThatFits(in: constraint).height, before, accuracy: 1)
        }
    }

    private func waitForDuration(_ playback: LearnerAudioPlayback) async throws {
        let deadline = Date().addingTimeInterval(5)
        while playback.duration <= 0 && Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertGreaterThan(playback.duration, 0, "Audio must be playing for the layout check.")
    }

    private func audioFile() throws -> URL {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 160_000))
        buffer.frameLength = 160_000
        let output = try AVAudioFile(forWriting: file, settings: format.settings)
        try output.write(from: buffer)
        return file
    }
}
