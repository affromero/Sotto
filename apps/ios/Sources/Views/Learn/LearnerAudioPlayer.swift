import AVFoundation
import SwiftUI

struct LearnerAudioPlayer: View {
    @EnvironmentObject private var model: SottoAppModel
    let reference: String
    @StateObject private var playback = LearnerAudioPlayback()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                playback.toggle { try await model.downloadLearningAudio(from: reference) }
            } label: {
                Label(playback.isLoading ? "Loading audio" : playback.isPlaying ? "Pause audio" : "Play audio",
                      systemImage: playback.isPlaying ? "pause.fill" : "play.fill")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(SottoSecondaryButtonStyle())
            .disabled(playback.isLoading)
            if let error = playback.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
        .onDisappear { playback.stop() }
        .onChange(of: reference) { _, _ in playback.stop() }
        .onChange(of: model.credentials) { _, _ in playback.stop() }
    }
}

@MainActor
final class LearnerAudioPlayback: ObservableObject {
    @Published private(set) var isLoading = false
    @Published private(set) var isPlaying = false
    @Published private(set) var errorMessage: String?
    private var player: AVPlayer?
    private var file: URL?
    private var load: Task<Void, Never>?
    private var requestID: UUID?
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?

    func toggle(download: @escaping @MainActor () async throws -> URL) {
        if let player {
            if isPlaying { player.pause(); isPlaying = false }
            else { player.play(); isPlaying = true }
            return
        }
        guard !isLoading else { return }
        let request = UUID()
        requestID = request
        isLoading = true
        errorMessage = nil
        load = Task { [self] in
            do {
                let local = try await download()
                guard !Task.isCancelled, requestID == request else {
                    try? FileManager.default.removeItem(at: local)
                    return
                }
                file = local
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                let item = AVPlayerItem(url: local)
                let player = AVPlayer(playerItem: item)
                self.player = player
                statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
                    guard item.status == .failed else { return }
                    let message = item.error?.localizedDescription ?? "This audio file could not be played."
                    Task { @MainActor [weak self] in
                        guard let self, self.requestID == request else { return }
                        self.stop()
                        self.errorMessage = message
                    }
                }
                endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
                    Task { @MainActor [weak self] in
                        guard let self, self.requestID == request else { return }
                        self.player?.seek(to: .zero)
                        self.isPlaying = false
                    }
                }
                isLoading = false
                player.play()
                isPlaying = true
            } catch {
                guard requestID == request else { return }
                stop()
                if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
                errorMessage = error.localizedDescription
            }
        }
    }

    func stop() {
        requestID = nil
        load?.cancel()
        load = nil
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        statusObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        if let file { try? FileManager.default.removeItem(at: file) }
        file = nil
        isLoading = false
        isPlaying = false
        errorMessage = nil
    }
}
