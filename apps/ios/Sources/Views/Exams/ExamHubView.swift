import SwiftUI

/// The exam a course can sit, plus past attempts. Replaces the hand-off that
/// used to open /learn/exams in the browser.
struct ExamHubView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout

    let course: SottoCourse

    @State private var exams: SottoCourseExams?
    @State private var loadError: String?
    @State private var isStarting = false
    @State private var openExamId: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let exams {
                        availableCard(exams.available)
                        historyList(exams.history)
                    } else if let loadError {
                        ExamNoticeCard(
                            title: "Could not load exams",
                            message: loadError,
                            systemImage: "exclamationmark.triangle"
                        )
                    } else {
                        ProgressView("Loading exams")
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }
                }
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Exams")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .navigationDestination(item: $openExamId) { examId in
                ExamRunnerView(examId: examId)
                    .environmentObject(model)
            }
            .task { await load() }
        }
    }

    private func availableCard(_ available: SottoExamAvailable) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(available.institutionLabel.uppercased())
                .font(.caption.bold())
                .tracking(1.6)
                .foregroundStyle(SottoTheme.muted)

            Text(available.examName)
                .font(.system(size: layout.heroTitleSize, weight: .semibold, design: .serif))
                .foregroundStyle(SottoTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            Text("Level \(available.level) · \(available.sectionCount) sections")
                .font(.callout)
                .foregroundStyle(SottoTheme.muted)

            Button {
                Task { await start(level: available.level) }
            } label: {
                Label(isStarting ? "Building exam" : "Start exam", systemImage: "checklist")
            }
            .buttonStyle(SottoPrimaryButtonStyle())
            .disabled(isStarting)

            if isStarting {
                Text("Sotto is writing every section. This takes a couple of minutes.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    @ViewBuilder
    private func historyList(_ history: [SottoExamHistoryEntry]) -> some View {
        if history.isEmpty {
            Text("No exams sat yet.")
                .font(.callout)
                .foregroundStyle(SottoTheme.muted)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Past attempts")
                    .font(.caption.bold())
                    .textCase(.uppercase)
                    .foregroundStyle(SottoTheme.muted)

                ForEach(history) { entry in
                    Button {
                        openExamId = entry.id
                    } label: {
                        HStack(alignment: .center, spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(entry.examName)
                                    .font(.headline)
                                    .foregroundStyle(SottoTheme.ink)
                                Text("\(entry.level) · \(entry.status.capitalized)")
                                    .font(.caption)
                                    .foregroundStyle(SottoTheme.muted)
                            }

                            Spacer()

                            if let band = entry.band {
                                Text(band)
                                    .font(.headline.monospaced())
                                    .foregroundStyle(SottoTheme.primary)
                            } else if let score = entry.overallScore {
                                Text(examPercent(score))
                                    .font(.headline.monospacedDigit())
                                    .foregroundStyle(SottoTheme.primary)
                            }

                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(SottoTheme.muted)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SottoTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(SottoTheme.line)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func load() async {
        do {
            exams = try await model.fetchCourseExams(courseId: course.id)
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func start(level: String?) async {
        isStarting = true
        defer { isStarting = false }
        do {
            openExamId = try await model.startExam(courseId: course.id, level: level)
            await load()
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ExamNoticeCard: View {
    let title: String
    let message: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)
            Text(message)
                .font(.callout)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

func examPercent(_ score: Double) -> String {
    "\(Int((max(0, min(1, score)) * 100).rounded()))%"
}
