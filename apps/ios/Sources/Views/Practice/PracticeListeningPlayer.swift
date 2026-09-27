import SwiftUI

/// Plays a practice session's listening episode. The audio is produced in the
/// background after the session starts, so this polls until a URL appears and
/// says so meanwhile, the way the web runner does. The questions below it are
/// answerable while the audio is still rendering.
struct PracticeListeningPlayer: View {
    @EnvironmentObject private var model: SottoAppModel

    let episodeId: String

    @State private var audioReference: String?
    @State private var failed = false
    @State private var loadError: String?
    @State private var retry = 0

    private static let pollInterval: Duration = .seconds(3)

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Listening", systemImage: "headphones")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            if let audioReference {
                LearnerAudioPlayer(reference: audioReference)
            } else if let loadError {
                Text(loadError).font(.callout).foregroundStyle(.red)
                Button("Retry audio status") { retry += 1 }.buttonStyle(.bordered)
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
        .task(id: "\(episodeId)/\(retry)") {
            audioReference = nil
            failed = false
            loadError = nil
            await waitForAudio()
        }
    }

    /// Polls until the worker publishes a URL. Ends on cancellation, which is
    /// what closing the sheet does.
    private func waitForAudio() async {
        while !Task.isCancelled && audioReference == nil {
            do {
                let episode = try await model.fetchEpisode(episodeId: episodeId)
                try Task.checkCancellation()
                if let urlString = episode.audioUrl {
                    audioReference = urlString
                    return
                }
                if episode.status == "FAILED" {
                    failed = true
                    return
                }
            } catch {
                if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
                loadError = error.localizedDescription
                return
            }

            try? await Task.sleep(for: Self.pollInterval)
        }
    }

}
