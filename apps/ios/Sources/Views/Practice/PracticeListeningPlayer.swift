import AVFoundation
import SwiftUI

/// Plays a practice session's listening episode. The audio is produced in the
/// background after the session starts, so this polls until a URL appears and
/// says so meanwhile, the way the web runner does. The questions below it are
/// answerable while the audio is still rendering.
struct PracticeListeningPlayer: View {
    @EnvironmentObject private var model: SottoAppModel

    let episodeId: String

    @State private var audioURL: URL?
    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var failed = false

    private static let pollInterval: Duration = .seconds(3)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Listening", systemImage: "headphones")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            if let audioURL {
                Button {
                    toggle(url: audioURL)
                } label: {
                    Label(
                        isPlaying ? "Pause audio" : "Play audio",
                        systemImage: isPlaying ? "pause.fill" : "play.fill"
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(SottoSecondaryButtonStyle())
            } else {
                Text(failed
                    ? "This session's audio could not be produced."
                    : "Audio is generating. The questions below are ready while you wait.")
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
        .task(id: episodeId) {
            await waitForAudio()
        }
        .onDisappear {
            player?.pause()
            isPlaying = false
        }
    }

    /// Polls until the worker publishes a URL. Ends on cancellation, which is
    /// what closing the sheet does.
    private func waitForAudio() async {
        while !Task.isCancelled && audioURL == nil {
            do {
                let episode = try await model.fetchEpisode(episodeId: episodeId)
                if let urlString = episode.audioUrl, let url = URL(string: urlString) {
                    audioURL = url
                    return
                }
                if episode.status == "FAILED" {
                    failed = true
                    return
                }
            } catch {
                // A failed poll is not fatal; the next one may succeed.
            }

            try? await Task.sleep(for: Self.pollInterval)
        }
    }

    private func toggle(url: URL) {
        if player == nil {
            player = AVPlayer(url: url)
        }
        if isPlaying {
            player?.pause()
        } else {
            player?.play()
        }
        isPlaying.toggle()
    }
}
