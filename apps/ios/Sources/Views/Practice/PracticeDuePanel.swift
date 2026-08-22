import SwiftUI

/// What is waiting on this course: how much is due for review, and the
/// sessions that were started and never finished. The web practice panel has
/// shown this all along; the iPad had no way to see it.
struct PracticeDuePanel: View {
    @EnvironmentObject private var model: SottoAppModel

    let overview: SottoPracticeOverview
    let onResume: (String) -> Void

    var body: some View {
        if overview.totalDue == 0 && overview.unfinished.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Label("Waiting for you", systemImage: "tray.full")
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)

                if overview.totalDue > 0 {
                    Text(dueSummary)
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(overview.unfinished) { session in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(kindLabel(session.kind))
                                .font(.callout.bold())
                                .foregroundStyle(SottoTheme.ink)
                            Text(startedLabel(session))
                                .font(.caption)
                                .foregroundStyle(SottoTheme.muted)
                        }

                        Spacer(minLength: 8)

                        Button("Resume") {
                            onResume(session.id)
                        }
                        .buttonStyle(SottoSecondaryButtonStyle())
                    }
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
        }
    }

    private var dueSummary: String {
        var parts: [String] = []
        if overview.due.vocab > 0 {
            parts.append("\(overview.due.vocab) word\(overview.due.vocab == 1 ? "" : "s")")
        }
        if overview.due.grammar > 0 {
            parts.append("\(overview.due.grammar) grammar point\(overview.due.grammar == 1 ? "" : "s")")
        }
        return parts.isEmpty ? "" : "\(parts.joined(separator: " and ")) due for review."
    }

    private func kindLabel(_ kind: String) -> String {
        practiceOptions.first { $0.kind == kind }?.label ?? kind.capitalized
    }

    private func startedLabel(_ session: SottoPracticeSessionSummary) -> String {
        guard
            let startedAt = session.startedAt,
            let date = ISO8601DateFormatter.sottoInternet.date(from: startedAt)
        else {
            return "Started earlier, not finished"
        }

        return "Started \(date.formatted(.relative(presentation: .named))), not finished"
    }
}

extension ISO8601DateFormatter {
    /// Prisma sends fractional seconds; the default formatter rejects them.
    static let sottoInternet: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
