import SwiftUI

/// Due reviews, resumable sessions, and the outcome of recent generation attempts.
struct PracticeDuePanel: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let overview: SottoPracticeOverview
    let onResume: (String) -> Void
    let onDelete: (String) -> Void

    @State private var pendingDeletion: SottoPracticeSessionSummary?

    var body: some View {
        if overview.totalDue == 0 && overview.unfinished.isEmpty && overview.preparing.isEmpty && overview.unsuccessful.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 12) {
                if overview.totalDue > 0 || !overview.unfinished.isEmpty {
                    Label("Waiting for you", systemImage: "tray.full")
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                }

                if overview.totalDue > 0 {
                    Text(dueSummary)
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(overview.unfinished) { session in
                    sessionRow(session)
                }

                if !overview.preparing.isEmpty || !overview.unsuccessful.isEmpty {
                    Label("Recent attempts", systemImage: "clock.arrow.circlepath")
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                    ForEach(overview.recent.filter { ["GENERATING", "FAILED", "CANCELLED"].contains($0.status) }) { session in
                        sessionRow(session)
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
            // Deleting takes the answers and recordings with it, so ask first.
            .confirmationDialog(
                "Delete this session?",
                isPresented: Binding(
                    get: { pendingDeletion != nil },
                    set: { if !$0 { pendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let session = pendingDeletion {
                        onDelete(session.id)
                    }
                    pendingDeletion = nil
                }
                Button("Keep it", role: .cancel) {
                    pendingDeletion = nil
                }
            } message: {
                Text("Its answers and recordings go with it.")
            }
        }
    }

    private func sessionRow(_ session: SottoPracticeSessionSummary) -> some View {
        SottoAdaptiveStack(verticalAlignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(kindLabel(session.kind))
                    .font(.callout.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text(session.statusLabel)
                    .font(.callout)
                    .foregroundStyle(session.status == "FAILED" ? SottoTheme.rose : SottoTheme.muted)
                Text(startedLabel(session))
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }

            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }

            Button(session.actionLabel) { onResume(session.id) }
                .buttonStyle(SottoSecondaryButtonStyle())

            Button(role: .destructive) {
                pendingDeletion = session
            } label: {
                Image(systemName: "trash")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Delete this \(kindLabel(session.kind)) session")
        }
        .environment(\.sottoLayout, .regular)
    }

    private var dueSummary: String {
        overview.dueSummary
    }

    private func kindLabel(_ kind: String) -> String {
        practiceOptions.first { $0.kind == kind }?.label ?? kind.capitalized
    }

    private func startedLabel(_ session: SottoPracticeSessionSummary) -> String {
        guard
            let startedAt = session.startedAt,
            let date = ISO8601DateFormatter.sottoInternet.date(from: startedAt)
        else {
            return "Started earlier"
        }

        return "Started \(date.formatted(.relative(presentation: .named)))"
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
