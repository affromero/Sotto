import SwiftUI

/// The CEFR placement test, and the "I already know my level" shortcut.
/// Replaces the hand-off that used to open /learn/placement in the browser.
///
/// Both paths create or raise the course on the server. Neither lowers a
/// level: the server keeps the higher of the two, so retaking is safe.
struct PlacementView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout

    let nativeLang: String
    let targetLang: String

    @State private var batch: SottoPlacementBatch?
    @State private var answers: [String: Int] = [:]
    @State private var outcome: String?
    @State private var errorMessage: String?
    @State private var isWorking = false
    @State private var manualLevel = "A1"

    private static let levels = ["A1", "A2", "B1", "B2", "C1", "C2"]

    private var questions: [SottoPlacementQuestion] {
        batch?.questions ?? []
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let outcome {
                        ExamNoticeCard(
                            title: "Level set",
                            message: outcome,
                            systemImage: "checkmark.seal"
                        )
                    } else if let batch, !batch.questions.isEmpty {
                        questionList
                        submitRow
                    } else if isWorking {
                        ProgressView("Writing your placement test")
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    } else {
                        startCard
                    }

                    if let errorMessage {
                        ExamNoticeCard(
                            title: "Placement did not run",
                            message: errorMessage,
                            systemImage: "exclamationmark.triangle"
                        )
                    }

                    if outcome == nil {
                        manualCard
                    }
                }
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Placement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(outcome == nil ? "Cancel" : "Done") { dismiss() }
                }
            }
        }
    }

    private var startCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Find your level")
                .font(.system(size: layout.heroTitleSize, weight: .semibold, design: .serif))
                .foregroundStyle(SottoTheme.ink)

            Text("A short adaptive test across the CEFR bands. Answer honestly; \"I'm not sure\" is a real answer and scores better than a guess.")
                .font(.callout)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                Task { await loadBatch() }
            } label: {
                Label("Start placement test", systemImage: "checkmark.seal")
            }
            .buttonStyle(SottoPrimaryButtonStyle())
            .disabled(isWorking)
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

    private var questionList: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(questions) { question in
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(question.cefr) · \(question.skill.capitalized)")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.muted)
                        .textCase(.uppercase)

                    Text(question.prompt)
                        .font(.body)
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        placementOption(
                            question: question,
                            index: index,
                            label: option
                        )
                    }

                    placementOption(
                        question: question,
                        index: SottoPlacementAnswer.dontKnowIndex,
                        label: "I'm not sure"
                    )
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
    }

    private func placementOption(
        question: SottoPlacementQuestion,
        index: Int,
        label: String
    ) -> some View {
        Button {
            answers[question.id] = index
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: answers[question.id] == index ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(answers[question.id] == index ? SottoTheme.primary : SottoTheme.muted)
                Text(label)
                    .font(.callout)
                    .foregroundStyle(index == SottoPlacementAnswer.dontKnowIndex ? SottoTheme.muted : SottoTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SottoTheme.paper)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var submitRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await submit() }
            } label: {
                Label(isWorking ? "Scoring" : "Finish placement", systemImage: "checkmark.circle")
            }
            .buttonStyle(SottoPrimaryButtonStyle())
            .disabled(isWorking || answers.count < questions.count)

            if answers.count < questions.count {
                Text("\(answers.count) of \(questions.count) answered.")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(SottoTheme.muted)
            }
        }
    }

    private var manualCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Already know your level?")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            Picker("Level", selection: $manualLevel) {
                ForEach(Self.levels, id: \.self) { level in
                    Text(level).tag(level)
                }
            }
            .pickerStyle(.segmented)

            Button {
                Task { await submitManual() }
            } label: {
                Label("Set level to \(manualLevel)", systemImage: "arrow.right.circle")
            }
            .buttonStyle(SottoSecondaryButtonStyle())
            .disabled(isWorking)

            Text("Setting a level never lowers an existing course; Sotto keeps the higher of the two so progress is not lost.")
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
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

    private func loadBatch() async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            batch = try await model.fetchPlacement(native: nativeLang, target: targetLang)
        } catch {
            errorMessage = SottoPlacementFailure.message(for: error)
        }
    }

    private func submit() async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await model.submitPlacement(
                native: nativeLang,
                target: targetLang,
                answers: answers.map { SottoPlacementAnswer(id: $0.key, selectedIndex: $0.value) }
            )
            outcome = "Sotto placed you at \(result.level)."
        } catch {
            errorMessage = SottoPlacementFailure.message(for: error)
        }
    }

    private func submitManual() async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await model.submitManualPlacement(
                native: nativeLang,
                target: targetLang,
                level: manualLevel
            )
            outcome = "Your course is set to \(result.level)."
        } catch {
            errorMessage = SottoPlacementFailure.message(for: error)
        }
    }
}

/// Placement answers a failed run with the raw resolver message, and manual
/// placement with a bare "Manual placement failed" even when the real cause is
/// a server with no language model configured. Neither is actionable from a
/// device that only pairs with a server.
enum SottoPlacementFailure {
    static func message(for error: Error) -> String {
        let raw = error.localizedDescription
        if raw == "Manual placement failed" || isServerConfiguration(raw) {
            return "Your Sotto server could not set a level. Its language model needs to be set up on the web app."
        }
        return raw
    }

    private static func isServerConfiguration(_ message: String) -> Bool {
        let lowered = message.lowercased()
        return ["api key", "api_key", "byok", "not configured", "no provider", "env"]
            .contains { lowered.contains($0) }
    }
}
