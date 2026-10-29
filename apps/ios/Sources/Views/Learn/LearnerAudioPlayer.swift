import AVFoundation
import SwiftUI

struct LearnerAudioPlayer: View {
    @EnvironmentObject private var model: SottoAppModel
    let reference: String
    var turns: [SottoListeningTurn] = []
    @StateObject private var playback: LearnerAudioPlayback

    @MainActor init(reference: String, turns: [SottoListeningTurn] = [], playback: LearnerAudioPlayback? = nil) {
        self.reference = reference
        self.turns = turns
        _playback = StateObject(wrappedValue: playback ?? LearnerAudioPlayback())
    }

    private var orderedTurns: [SottoListeningTurn] { turns.sorted { $0.order < $1.order } }
    private var speakers: [String] {
        orderedTurns.reduce(into: []) { names, turn in
            if !names.contains(turn.speaker) { names.append(turn.speaker) }
        }
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
                ZStack(alignment: .leading) {
                    Label(orderedTurns.isEmpty ? "Play audio" : "Play full conversation", systemImage: "play.fill")
                        .hidden()
                        .accessibilityHidden(true)
                    Label(playback.isLoading && playback.reference == reference ? "Loading audio" : playing ? "Pause audio" : orderedTurns.isEmpty ? "Play audio" : "Play full conversation",
                          systemImage: playing ? "pause.fill" : "play.fill")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(SottoSecondaryButtonStyle())
            .disabled(playback.isLoading && playback.reference == reference)
            .accessibilityIdentifier("lesson-audio-full")
            Slider(value: Binding(get: { playback.currentTime }, set: { playback.seek(to: $0) }),
                in: 0...(playback.duration > 0 ? max(playback.duration, playback.currentTime) : 1))
                .accessibilityLabel("Audio position")
                .disabled(playback.duration <= 0)
            HStack {
                Text(clockTime(playback.currentTime))
                Spacer()
                Text(clockTime(playback.duration))
            }.font(.caption.monospacedDigit()).foregroundStyle(SottoTheme.muted)
            HStack {
                Button("Back 10s") { playback.seek(to: playback.currentTime - 10) }
                Button("Forward 10s") { playback.seek(to: playback.currentTime + 10) }
            }.buttonStyle(.bordered).controlSize(.large)
                .disabled(playback.duration <= 0)
            if !orderedTurns.isEmpty {
                Divider().padding(.top, 12)
                Text("The conversation")
                    .font(.system(.title2, design: .serif)).foregroundStyle(SottoTheme.ink)
                Text("Follow who is speaking. Play any turn on its own.")
                    .font(.callout).foregroundStyle(SottoTheme.muted)
                ForEach(Array(orderedTurns.enumerated()), id: \.element.id) { index, turn in
                    turnRow(turn, index: index)
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

    private func turnRow(_ turn: SottoListeningTurn, index: Int) -> some View {
        let active = isActive(turn)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Text(avatar(for: turn.speaker))
                    .font(.title2).frame(width: 38, height: 38)
                    .background(SottoTheme.surface).clipShape(Circle())
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 8) {
                    Text(turn.speaker.capitalized).font(.subheadline.bold())
                    Text("Turn \(index + 1)")
                        .font(.caption).foregroundStyle(active ? SottoTheme.primary : SottoTheme.muted)
                        .accessibilityLabel("Turn \(index + 1)\(active ? ", speaking" : "")")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    playTurn(at: index)
                } label: {
                    Image(systemName: active && playback.reference == turn.audioUrl ? "pause.fill" : "play.fill")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.bordered)
                .disabled(turn.audioUrl?.isEmpty != false || (playback.isLoading && playback.reference == turn.audioUrl))
                .accessibilityLabel("\(active && playback.reference == turn.audioUrl ? "Pause" : "Play") turn \(index + 1), \(turn.speaker)")
                .accessibilityIdentifier("lesson-audio-turn-\(turn.id)")
            }
            if let text = turn.text, !text.isEmpty {
                Text(ListeningTranscriptText.display(text)).font(.body).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if turn.audioUrl?.isEmpty != false {
                Text("Turn audio unavailable").font(.caption).foregroundStyle(SottoTheme.muted)
            }
        }
        .foregroundStyle(SottoTheme.ink)
        .padding(14)
        .background(active ? SottoTheme.primary.opacity(0.12) : SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(active ? SottoTheme.primary : SottoTheme.line))
    }

    private func avatar(for speaker: String) -> String {
        let avatars = ["🦊", "🐻", "🐼", "🐨", "🦁", "🐰"]
        return avatars[(speakers.firstIndex(of: speaker) ?? 0) % avatars.count]
    }

    private func playTurn(at index: Int) {
        guard orderedTurns.indices.contains(index), let clip = orderedTurns[index].audioUrl else { return }
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
