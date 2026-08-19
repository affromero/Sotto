import SwiftUI
import UIKit

struct LearnerSelectionHelpRequest: Identifiable, Equatable {
    let id = UUID()
    let courseId: String
    let text: String
    let contextText: String
}

enum LearnerTextFonts {
    static let title2Bold = scaledFont(size: 22, weight: .bold, textStyle: .title2)
    static let headline = scaledFont(size: 17, weight: .semibold, textStyle: .headline)
    static let body = scaledFont(size: 17, weight: .regular, textStyle: .body)
    static let callout = scaledFont(size: 16, weight: .regular, textStyle: .callout)
    static let caption = scaledFont(size: 12, weight: .regular, textStyle: .caption1)

    private static func scaledFont(
        size: CGFloat,
        weight: UIFont.Weight,
        textStyle: UIFont.TextStyle
    ) -> UIFont {
        UIFontMetrics(forTextStyle: textStyle).scaledFont(
            for: UIFont.systemFont(ofSize: size, weight: weight)
        )
    }
}

func cleanLearnerSelection(_ value: String) -> String {
    value
        .components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .prefix(500)
        .description
}

func percent(_ value: Double) -> String {
    "\(Int((value * 100).rounded()))%"
}

func focusText(_ token: SottoSpeakingAlignmentToken) -> String {
    if let expected = token.expected, let actual = token.actual {
        return "\(expected) -> \(actual)"
    }
    return token.expected ?? token.actual ?? "sound"
}

func classSkillLabel(_ skill: String) -> String {
    switch skill.uppercased() {
    case "GRAMMAR":
        return "Grammar"
    case "READING":
        return "Reading"
    case "LISTENING":
        return "Listening"
    case "SPEAKING":
        return "Speaking"
    case "WRITING":
        return "Writing"
    default:
        return skill.capitalized
    }
}

func classSkillIcon(_ skill: String) -> String {
    switch skill.uppercased() {
    case "GRAMMAR":
        return "function"
    case "READING":
        return "book"
    case "LISTENING":
        return "waveform"
    case "SPEAKING":
        return "mic"
    case "WRITING":
        return "square.and.pencil"
    default:
        return "sparkle"
    }
}

func classSkillColor(_ skill: String) -> Color {
    switch skill.uppercased() {
    case "GRAMMAR":
        return SottoTheme.primary
    case "READING":
        return Color(red: 0.165, green: 0.549, blue: 0.471)
    case "LISTENING":
        return Color(red: 0.071, green: 0.478, blue: 0.231)
    case "SPEAKING":
        return Color(red: 0.72, green: 0.31, blue: 0.45)
    case "WRITING":
        return Color(red: 0.72, green: 0.39, blue: 0.18)
    default:
        return SottoTheme.muted
    }
}

func calloutToneColor(_ tone: String) -> Color {
    switch tone.lowercased() {
    case "teal":
        return Color(red: 0.165, green: 0.549, blue: 0.471)
    case "rose":
        return Color(red: 0.72, green: 0.31, blue: 0.45)
    case "amber":
        return Color(red: 0.72, green: 0.39, blue: 0.18)
    default:
        return SottoTheme.primary
    }
}

func sectionStatusLabel(_ section: SottoClassSection) -> String {
    if let score = section.score {
        return "\(Int(score * 100))%"
    }
    let count = section.questions.count + section.prompts.count + section.writingPrompts.count
    return count == 1 ? "1 item" : "\(count) items"
}

struct SelectableLearnerText: UIViewRepresentable {
    let text: String
    let font: UIFont
    let color: UIColor
    let onExamples: (String, String) -> Void

    init(
        _ text: String,
        font: UIFont,
        color: UIColor,
        onExamples: @escaping (String, String) -> Void
    ) {
        self.text = text
        self.font = font
        self.color = color
        self.onExamples = onExamples
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.delegate = context.coordinator
        textView.isEditable = false
        textView.isSelectable = true
        textView.isScrollEnabled = false
        textView.backgroundColor = .clear
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.adjustsFontForContentSizeCategory = true
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.setContentCompressionResistancePriority(.required, for: .vertical)
        textView.dataDetectorTypes = []
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        if textView.text != text {
            textView.text = text
        }
        textView.font = font
        textView.textColor = color
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func sizeThatFits(
        _ proposal: ProposedViewSize,
        uiView: UITextView,
        context _: Context
    ) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        guard width > 0 else { return nil }
        let fittingSize = uiView.sizeThatFits(
            CGSize(width: width, height: CGFloat.greatestFiniteMagnitude)
        )
        return CGSize(width: width, height: ceil(fittingSize.height))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: SelectableLearnerText

        init(parent: SelectableLearnerText) {
            self.parent = parent
        }

        func textView(
            _ textView: UITextView,
            editMenuForTextIn range: NSRange,
            suggestedActions: [UIMenuElement]
        ) -> UIMenu? {
            guard let selected = selectedText(from: textView, range: range) else {
                return UIMenu(children: suggestedActions)
            }

            let examples = UIAction(
                title: "Examples",
                image: UIImage(systemName: "text.bubble")
            ) { [parent] _ in
                parent.onExamples(selected, parent.text)
            }

            return UIMenu(children: [examples] + suggestedActions)
        }

        private func selectedText(from textView: UITextView, range: NSRange) -> String? {
            guard range.location != NSNotFound,
                  range.length > 0,
                  let swiftRange = Range(range, in: textView.text)
            else {
                return nil
            }

            let selected = cleanLearnerSelection(String(textView.text[swiftRange]))
            return selected.isEmpty ? nil : selected
        }
    }
}

struct SelectionHelpSheet: View {
    let request: LearnerSelectionHelpRequest
    let help: SottoSelectionHelpResponse?
    let isLoading: Bool
    let errorMessage: String?
    let onRetry: () -> Void

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(request.text)
                        .font(.title2.bold())
                        .foregroundStyle(SottoTheme.ink)
                        .textSelection(.enabled)
                    Text("Three easy contexts")
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                }

                if isLoading {
                    HStack(spacing: 12) {
                        ProgressView()
                        Text("Building examples")
                            .foregroundStyle(SottoTheme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 24)
                } else if let errorMessage {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(errorMessage)
                            .font(.body)
                            .foregroundStyle(SottoTheme.muted)
                        Button(action: onRetry) {
                            Label("Try again", systemImage: "arrow.clockwise")
                        }
                        .buttonStyle(SottoSecondaryButtonStyle())
                    }
                } else if let help {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(help.examples.enumerated()), id: \.offset) { index, example in
                            VStack(alignment: .leading, spacing: 6) {
                                Text("\(index + 1)")
                                    .font(.caption.bold())
                                    .foregroundStyle(SottoTheme.primary)
                                Text(example.sentence)
                                    .font(.title3.weight(.semibold))
                                    .foregroundStyle(SottoTheme.ink)
                                    .textSelection(.enabled)
                                Text(example.note)
                                    .font(.callout)
                                    .foregroundStyle(SottoTheme.muted)
                                    .textSelection(.enabled)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(SottoTheme.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(24)
            .background(SottoTheme.surface)
            .navigationTitle("Examples")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct ClassResultBanner: View {
    let result: SottoClassSubmitResult

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: result.passed ? "checkmark.seal.fill" : "exclamationmark.arrow.triangle.2.circlepath")
                .font(.system(size: 42))
                .foregroundStyle(result.passed ? SottoTheme.success : SottoTheme.primary)

            VStack(alignment: .leading, spacing: 4) {
                Text(result.passed ? "Class passed" : "Review needed")
                    .font(.title2.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text("\(Int(result.overallScore * 100))% overall, \(result.passedSections) of \(result.totalSections) sections passed.")
                    .font(.body)
                    .foregroundStyle(SottoTheme.muted)
            }

            Spacer()
        }
        .padding(20)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}
