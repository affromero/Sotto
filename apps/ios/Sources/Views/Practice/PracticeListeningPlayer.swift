import SwiftUI

/// Plays a practice session's listening episode. The audio is produced in the
/// background after the session starts, so this polls until a URL appears and
/// says so meanwhile, the way the web runner does. The questions below it are
/// answerable while the audio is still rendering.
struct PracticeListeningPlayer: View {
    let episodeId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Listening", systemImage: "headphones")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            EpisodeListeningPlayer(episodeId: episodeId)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}
