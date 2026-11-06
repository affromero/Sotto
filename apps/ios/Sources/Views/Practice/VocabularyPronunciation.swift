import AVFoundation
import SwiftUI

struct VocabularyPronunciation: View {
    @EnvironmentObject private var model: SottoAppModel
    let path: String
    @State private var busy = false
    @State private var failed = false
    @State private var player: AVAudioPlayer?
    @State private var task: Task<Void, Never>?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading) {
            Button(busy ? "Preparing local audio…" : failed ? "Retry pronunciation" : "Hear pronunciation", systemImage: "speaker.wave.2") {
                task = Task { await play() }
            }.buttonStyle(.borderless).disabled(busy)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .onDisappear { task?.cancel(); player?.stop() }
    }

    private func play() async {
        guard let client = model.makeClient() else { error = "Pair this device to play audio."; return }
        busy = true
        defer { busy = false }
        do {
            for attempt in 0..<60 {
                let result = try await client.prepareVocabularyAudio(path: path, retry: attempt == 0 && failed)
                if result.status == "FAILED" || result.status == "UNRESOLVED" {
                    throw SottoAPIError.message(result.error ?? "Local pronunciation is unavailable.")
                }
                if result.status == "READY" {
                    let file = try await client.downloadLearningAudio(from: path)
                    defer { try? FileManager.default.removeItem(at: file) }
                    guard model.isCurrentLearningClient(client), !Task.isCancelled else { return }
                    let audio = try AVAudioPlayer(data: Data(contentsOf: file))
                    player = audio
                    guard audio.play() else { throw SottoAPIError.message("Pronunciation could not play.") }
                    failed = false
                    error = nil
                    return
                }
                try await Task.sleep(for: .milliseconds(1500))
            }
            throw SottoAPIError.message("Pronunciation is still preparing. Try again.")
        } catch { if !Task.isCancelled { failed = true; self.error = error.localizedDescription } }
    }
}
