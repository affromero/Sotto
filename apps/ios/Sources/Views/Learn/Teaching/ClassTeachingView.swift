import SwiftUI
import UIKit

struct ClassTeachingView: View {
    @Environment(\.sottoLayout) private var layout
    let teaching: SottoClassTeaching
    var intro: SottoClassIntro? = nil
    let onSelectionHelp: (String, String) -> Void

    private var paragraphs: [String] {
        teaching.explanation.components(separatedBy: "\n\n")
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            SottoAdaptiveStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    lessonLabel("The lesson")
                    Text(teaching.title)
                        .font(.system(.title, design: .serif).bold())
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let intro { learnerText(intro.purpose) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                Image("ClassConversation").resizable().scaledToFit()
                    .frame(maxWidth: 220, maxHeight: 160)
                    .accessibilityHidden(true)
            }
            Divider()
            VStack(alignment: .leading, spacing: 18) {
                Text("How it works").font(.headline).foregroundStyle(SottoTheme.primary)
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { index, paragraph in
                    learnerText(paragraph)
                        .accessibilityIdentifier("class-teaching-explanation-\(index)")
                }
            }
            if let timeline = intro?.visuals?.timeline, timeline.steps.count >= 2 {
                TimelineFigure(timeline: timeline, onSelectionHelp: onSelectionHelp)
            }
            if let contrast = intro?.visuals?.contrast {
                ContrastFigure(contrast: contrast, onSelectionHelp: onSelectionHelp)
            }
            correction
            VStack(alignment: .leading, spacing: 20) {
                Text("Worked examples").font(.headline).foregroundStyle(SottoTheme.primary)
                ForEach(Array(teaching.workedExamples.enumerated()), id: \.offset) { index, example in
                    VStack(alignment: .leading, spacing: 14) {
                        Divider()
                        lessonLabel("Example \(String(format: "%02d", index + 1))")
                        learnerText(example.prompt)
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Say it").font(.caption.bold()).foregroundStyle(SottoTheme.muted)
                            learnerText(example.answer, emphasized: true)
                        }
                        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SottoTheme.primary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        Text("Why it works").font(.caption.bold()).foregroundStyle(SottoTheme.muted)
                        learnerText(example.explanation)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 14) {
                Text("Try it first").font(.headline).foregroundStyle(SottoTheme.primary)
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
            .padding(layout == .compact ? 18 : 24)
            .background(SottoTheme.surface)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SottoTheme.line))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tint(SottoTheme.primary)
    }

    private var correction: some View {
        VStack(alignment: .leading, spacing: 16) {
            lessonLabel("Notice the difference")
            Text("Compare the sentences")
                .font(.system(.title2, design: .serif))
                .foregroundStyle(SottoTheme.ink)
            comparison(teaching.commonMistake.incorrect, label: "Incorrect", color: SottoTheme.rose)
            Image(systemName: "arrow.down").foregroundStyle(SottoTheme.primary).accessibilityHidden(true)
            comparison(teaching.commonMistake.correction, label: "Correction", color: SottoTheme.success)
            learnerText(teaching.commonMistake.explanation)
        }
        .padding(layout == .compact ? 18 : 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.primary.opacity(0.05))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(SottoTheme.line))
    }

    private func comparison(_ text: String, label: String, color: Color) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle().fill(color).frame(width: 3)
            VStack(alignment: .leading, spacing: 8) {
                Text(label).font(.caption.bold()).foregroundStyle(SottoTheme.muted)
                learnerText(text, emphasized: true)
            }
        }.fixedSize(horizontal: false, vertical: true)
    }

    private func lessonLabel(_ label: String) -> some View {
        Text(label.uppercased()).font(.caption.monospaced().weight(.medium))
            .tracking(1).foregroundStyle(SottoTheme.primary)
    }

    private func learnerText(_ text: String, emphasized: Bool = false) -> some View {
        SelectableLearnerText(text,
            font: emphasized ? LearnerTextFonts.headline : LearnerTextFonts.body,
            color: UIColor(emphasized ? SottoTheme.primary : SottoTheme.ink),
            onExamples: onSelectionHelp)
    }
}
