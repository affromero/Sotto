import SwiftUI

struct EpisodeListeningPlayer: View {
    @EnvironmentObject private var model: SottoAppModel
    let episodeId: String
    @State private var episode: SottoEpisode?
    @State private var loadError: String?
    @State private var retry = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let loadError {
                Text(loadError).font(.callout).foregroundStyle(.red)
                Button("Retry audio status") { retry += 1 }.buttonStyle(.bordered)
            } else if let reference = episode?.audioUrl {
                LearnerAudioPlayer(reference: reference, turns: episode?.segments ?? [])
            } else if episode?.status == "FAILED" {
                Text("This session's audio could not be produced.")
                    .font(.callout).foregroundStyle(SottoTheme.muted)
            } else {
                Text("Audio is generating. The questions below are ready while you wait.")
                    .font(.callout).foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .task(id: EpisodeAudioRequest(episodeId: episodeId, retry: retry, credentials: model.credentials)) {
            episode = nil
            loadError = nil
            await waitForAudio()
        }
    }

    private func waitForAudio() async {
        while !Task.isCancelled {
            do {
                let fetched = try await model.fetchEpisode(episodeId: episodeId)
                try Task.checkCancellation()
                episode = fetched
                if fetched.audioUrl != nil || fetched.status == "FAILED" { return }
                try await Task.sleep(for: .seconds(3))
            } catch {
                if error is CancellationError || (error as? URLError)?.code == .cancelled { return }
                loadError = error.localizedDescription
                return
            }
        }
    }
}

private struct EpisodeAudioRequest: Equatable {
    let episodeId: String
    let retry: Int
    let credentials: SottoCredentials?
}
