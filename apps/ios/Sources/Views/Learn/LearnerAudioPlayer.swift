import AVFoundation
import SwiftUI

struct LearnerAudioPlayer: View {
    @EnvironmentObject private var model: SottoAppModel
    let reference: String
    var turns: [SottoListeningTurn] = []
    @StateObject private var playback = LearnerAudioPlayback()
    @State private var selectedTurnIndex = 0

    private var orderedTurns: [SottoListeningTurn] { turns.sorted { $0.order < $1.order } }
    private var activeTurnIndex: Int {
        orderedTurns.firstIndex { turn in
            guard let playingReference = playback.reference else { return false }
            return playingReference == reference ? turn.contains(time: playback.currentTime) : playingReference == turn.audioUrl
        } ?? min(selectedTurnIndex, max(0, orderedTurns.count - 1))
    }

    private func isActive(_ turn: SottoListeningTurn) -> Bool {
        guard playback.isPlaying else { return false }
        if playback.reference == reference { return turn.contains(time: playback.currentTime) }
        return playback.reference == turn.audioUrl
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                playback.toggle(reference: reference) { try await model.downloadLearningAudio(from: reference) }
            } label: {
                let playing = playback.isPlaying && playback.reference == reference
                Label(playback.isLoading && playback.reference == reference ? "Loading audio" : playing ? "Pause audio" : "Play audio",
                      systemImage: playing ? "pause.fill" : "play.fill")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(SottoSecondaryButtonStyle())
            .disabled(playback.isLoading && playback.reference == reference)
            if playback.duration > 0 {
                Slider(value: Binding(get: { playback.currentTime }, set: { playback.seek(to: $0) }),
                    in: 0...max(playback.duration, playback.currentTime))
                    .accessibilityLabel("Audio position")
                HStack {
                    Text(clockTime(playback.currentTime))
                    Spacer()
                    Text(clockTime(playback.duration))
                }.font(.caption.monospacedDigit()).foregroundStyle(SottoTheme.muted)
                HStack {
                    Button("Back 10s") { playback.seek(to: playback.currentTime - 10) }
                    Button("Forward 10s") { playback.seek(to: playback.currentTime + 10) }
                }.buttonStyle(.bordered).controlSize(.large)
            }
            if !orderedTurns.isEmpty {
                let turn = orderedTurns[activeTurnIndex]
                Text("Turn \(activeTurnIndex + 1) of \(orderedTurns.count) · \(turn.speaker.capitalized)")
                    .font(.callout.bold()).foregroundStyle(SottoTheme.ink)
                ViewThatFits(in: .horizontal) {
                    HStack { turnActions }
                    VStack(alignment: .leading, spacing: 12) { turnActions }
                }.buttonStyle(.bordered).controlSize(.large)
                DisclosureGroup("All speaker turns") {
                    ForEach(orderedTurns) { turn in
                    if let clip = turn.audioUrl, !clip.isEmpty {
                        Button {
                            playback.toggle(reference: clip) { try await model.downloadLearningAudio(from: clip) }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: isActive(turn) ? "waveform" : "play.fill")
                                    .frame(width: 20)
                                Text("Turn \(turn.order + 1) · \(turn.speaker)")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if isActive(turn) { Text("Speaking").font(.caption) }
                            }
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .foregroundStyle(SottoTheme.ink)
                            .background(isActive(turn) ? SottoTheme.primary.opacity(0.14) : SottoTheme.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                        .disabled(playback.isLoading && playback.reference == clip)
                        .accessibilityLabel("\(playback.isPlaying && playback.reference == clip ? "Pause" : "Play") turn \(turn.order + 1), \(turn.speaker)")
                    }
                    }
                }
            }
            if let error = playback.errorMessage {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
        .onDisappear { playback.stop() }
        .onChange(of: reference) { _, _ in playback.stop() }
        .onChange(of: model.credentials) { _, _ in playback.stop() }
    }

    @ViewBuilder
    private var turnActions: some View {
        Button("Previous turn") { playTurn(at: activeTurnIndex - 1) }
            .disabled(activeTurnIndex == 0 || playback.isLoading)
        Button(playback.isPlaying && playback.reference == orderedTurns[activeTurnIndex].audioUrl
            ? "Pause turn" : "Play turn") { playTurn(at: activeTurnIndex) }
            .disabled(orderedTurns[activeTurnIndex].audioUrl == nil || playback.isLoading)
        Button("Next turn") { playTurn(at: activeTurnIndex + 1) }
            .disabled(activeTurnIndex + 1 >= orderedTurns.count || playback.isLoading)
    }

    private func playTurn(at index: Int) {
        guard orderedTurns.indices.contains(index), let clip = orderedTurns[index].audioUrl else { return }
        selectedTurnIndex = index
        playback.toggle(reference: clip) { try await model.downloadLearningAudio(from: clip) }
    }

    private func clockTime(_ time: Double) -> String {
        let seconds = time.isFinite ? max(0, Int(time)) : 0
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

@MainActor
final class LearnerAudioPlayback: ObservableObject {
    @Published private(set) var isLoading = false
    @Published private(set) var isPlaying = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var reference: String?
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double = 0
    private var player: AVPlayer?
    private var file: URL?
    private var load: Task<Void, Never>?
    private var requestID: UUID?
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var timeObserver: Any?

    @discardableResult
    func toggle(reference: String? = nil, download: @escaping @MainActor () async throws -> URL) -> Task<Void, Never>? {
        if self.reference != reference {
            stop()
            self.reference = reference
        }
        if let player {
            if isPlaying { player.pause(); isPlaying = false }
            else { player.play(); isPlaying = true }
            return nil
        }
        guard !isLoading else { return load }
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
                timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.2, preferredTimescale: 600), queue: .main) { [weak self] time in
                    Task { @MainActor [weak self] in
                        guard let self, self.requestID == request, time.seconds.isFinite else { return }
                        self.currentTime = time.seconds
                        if let duration = self.player?.currentItem?.duration.seconds, duration.isFinite {
                            self.duration = max(0, duration)
                        }
                    }
                }
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
                        self.currentTime = 0
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
        return load
    }

    func seek(to seconds: Double) {
        guard seconds.isFinite, duration > 0 else { return }
        let target = max(0, min(duration, seconds))
        player?.seek(to: CMTime(seconds: target, preferredTimescale: 600))
        currentTime = target
    }

    func stop() {
        requestID = nil
        load?.cancel()
        load = nil
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        timeObserver = nil
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
        reference = nil
        currentTime = 0
        duration = 0
    }
}
