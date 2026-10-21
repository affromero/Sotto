import SwiftUI
import UIKit

struct ClassTeachingView: View {
    let teaching: SottoClassTeaching
    let onSelectionHelp: (String, String) -> Void
    @State private var exampleIndex = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(teaching.title)
                .font(.system(.title, design: .serif).bold())
                .foregroundStyle(SottoTheme.ink)
            learnerText(teaching.explanation)
                .accessibilityIdentifier("class-teaching-explanation")
            Divider()
            if teaching.workedExamples.indices.contains(exampleIndex) {
                let example = teaching.workedExamples[exampleIndex]
                VStack(alignment: .leading, spacing: 12) {
                    Text("Worked example \(exampleIndex + 1) of \(teaching.workedExamples.count)")
                        .font(.headline)
                    learnerText(example.prompt)
                    learnerText(example.answer, emphasized: true)
                    learnerText(example.explanation)
                    HStack {
                        Button("Previous example") { exampleIndex -= 1 }
                            .disabled(exampleIndex == 0)
                        Spacer()
                        Button("Next example") { exampleIndex += 1 }
                            .disabled(exampleIndex + 1 == teaching.workedExamples.count)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
            }
            DisclosureGroup("Common mistake") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Incorrect").font(.caption.bold()).foregroundStyle(SottoTheme.muted)
                    learnerText(teaching.commonMistake.incorrect)
                    Text("Correction").font(.caption.bold()).foregroundStyle(SottoTheme.muted)
                    learnerText(teaching.commonMistake.correction, emphasized: true)
                    learnerText(teaching.commonMistake.explanation)
                }.padding(.vertical, 12)
            }
            Divider()
            VStack(alignment: .leading, spacing: 12) {
                Text("Try it first").font(.headline)
                learnerText(teaching.guidedPractice.prompt)
                DisclosureGroup("Hint") {
                    learnerText(teaching.guidedPractice.hint).padding(.vertical, 8)
                }
                DisclosureGroup("Show the worked answer") {
                    VStack(alignment: .leading, spacing: 12) {
                        learnerText(teaching.guidedPractice.answer, emphasized: true)
                        learnerText(teaching.guidedPractice.explanation)
                    }.padding(.vertical, 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(SottoTheme.primary)
    }

    private func learnerText(_ text: String, emphasized: Bool = false) -> some View {
        SelectableLearnerText(text,
            font: emphasized ? LearnerTextFonts.headline : LearnerTextFonts.body,
            color: UIColor(emphasized ? SottoTheme.primary : SottoTheme.ink),
            onExamples: onSelectionHelp)
    }
}
