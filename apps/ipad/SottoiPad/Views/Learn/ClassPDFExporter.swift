import SwiftUI
import UIKit

struct ClassPDFExport: Identifiable {
    let id = UUID()
    let url: URL
}

struct ClassShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

enum ClassPDFExporter {
    static func export(classDetail: SottoClassDetail, answers: [String: Int]) throws -> URL {
        let title = classDetail.lesson?.title ?? "Sotto class"
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(safeFilename(title))-class-\(UUID().uuidString).pdf")
        let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)

        try renderer.writePDF(to: outputURL) { context in
            let writer = ClassPDFPageWriter(context: context, bounds: bounds)
            writer.beginPage()
            writer.writeTitle(title)

            if let lesson = classDetail.lesson {
                writer.writeLine("Class \(classDetail.order) · \(lesson.level)", style: .meta)
                if let objective = lesson.objective, !objective.isEmpty {
                    writer.writeLine(objective, style: .body)
                }
            }

            if let intro = classDetail.intro {
                writer.writeSection("Brief")
                writer.writeLine(intro.purpose, style: .lead)
                writer.writeLine(intro.about, style: .body)

                if let timeline = intro.visuals?.timeline, timeline.steps.count >= 2 {
                    writer.writeSubsection(timeline.title)
                    for (index, step) in timeline.steps.enumerated() {
                        writer.writeLine("\(index + 1). \(step)", style: .body)
                    }
                }

                if let contrast = intro.visuals?.contrast {
                    writer.writeSubsection(contrast.title)
                    writer.writeLine(contrast.leftLabel, style: .label)
                    contrast.leftItems.forEach { writer.writeLine("• \($0)", style: .small) }
                    writer.writeLine(contrast.rightLabel, style: .label)
                    contrast.rightItems.forEach { writer.writeLine("• \($0)", style: .small) }
                }

                if !intro.examples.isEmpty {
                    writer.writeSubsection("Examples")
                    intro.examples.forEach { example in
                        writer.writeLine(example.target, style: .label)
                        writer.writeLine(example.meaning, style: .small)
                        writer.writeLine(example.note, style: .smallMuted)
                    }
                }
            }

            for section in classDetail.sections {
                writer.writeSection(classSkillLabel(section.skill))
                for question in section.questions.sorted(by: { $0.order < $1.order }) {
                    writer.writeLine(question.question, style: .label)
                    for (index, option) in question.options.enumerated() {
                        let marker = answers[question.id] == index ? "☑" : "☐"
                        writer.writeLine("\(marker) \(option)", style: .small)
                    }
                    if let explanation = question.explanation, !explanation.isEmpty {
                        writer.writeLine(explanation, style: .smallMuted)
                    }
                }

                for prompt in section.prompts {
                    writer.writeLine(prompt.targetPhrase, style: .label)
                    writer.writeLine(prompt.translation, style: .small)
                    if let ipa = prompt.ipa, !ipa.isEmpty {
                        writer.writeLine(ipa, style: .smallMuted)
                    }
                }

                for prompt in section.writingPrompts {
                    writer.writeLine(prompt.task, style: .label)
                    if let guidance = prompt.guidance, !guidance.isEmpty {
                        writer.writeLine(guidance, style: .small)
                    }
                }
            }
        }

        return outputURL
    }

    private static func safeFilename(_ title: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let scalars = title.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        let cleaned = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Sotto-class" : cleaned
    }
}

final class ClassPDFPageWriter {
    enum TextStyle {
        case title
        case section
        case subsection
        case lead
        case label
        case body
        case small
        case smallMuted
        case meta
    }

    private let context: UIGraphicsPDFRendererContext
    private let bounds: CGRect
    private let margin: CGFloat = 48
    private var y: CGFloat = 48

    init(context: UIGraphicsPDFRendererContext, bounds: CGRect) {
        self.context = context
        self.bounds = bounds
    }

    func beginPage() {
        context.beginPage()
        y = margin
    }

    func writeTitle(_ text: String) {
        writeLine(text, style: .title)
    }

    func writeSection(_ text: String) {
        y += 14
        writeLine(text, style: .section)
    }

    func writeSubsection(_ text: String) {
        y += 7
        writeLine(text, style: .subsection)
    }

    func writeLine(_ text: String, style: TextStyle) {
        let cleaned = cleanLearnerSelection(text)
        guard !cleaned.isEmpty else { return }

        let attrs = attributes(for: style)
        let width = bounds.width - margin * 2
        let size = (cleaned as NSString).boundingRect(
            with: CGSize(width: width, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attrs,
            context: nil
        ).integral.size

        if y + size.height > bounds.height - margin {
            beginPage()
        }

        (cleaned as NSString).draw(
            in: CGRect(x: margin, y: y, width: width, height: size.height),
            withAttributes: attrs
        )
        y += size.height + spacing(after: style)
    }

    private func attributes(for style: TextStyle) -> [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineSpacing = style == .title ? 1.5 : 2

        return [
            .font: font(for: style),
            .foregroundColor: color(for: style),
            .paragraphStyle: paragraph
        ]
    }

    private func font(for style: TextStyle) -> UIFont {
        switch style {
        case .title:
            return .systemFont(ofSize: 28, weight: .bold)
        case .section:
            return .systemFont(ofSize: 18, weight: .bold)
        case .subsection, .label:
            return .systemFont(ofSize: 13, weight: .semibold)
        case .lead:
            return .systemFont(ofSize: 15, weight: .semibold)
        case .body:
            return .systemFont(ofSize: 12, weight: .regular)
        case .small, .smallMuted:
            return .systemFont(ofSize: 10.5, weight: .regular)
        case .meta:
            return .monospacedSystemFont(ofSize: 10, weight: .semibold)
        }
    }

    private func color(for style: TextStyle) -> UIColor {
        switch style {
        case .title, .section, .subsection, .lead, .label:
            return UIColor(red: 0.118, green: 0.129, blue: 0.157, alpha: 1)
        case .meta:
            return UIColor(red: 0.247, green: 0.310, blue: 0.690, alpha: 1)
        case .body, .small, .smallMuted:
            return UIColor(red: 0.337, green: 0.357, blue: 0.408, alpha: 1)
        }
    }

    private func spacing(after style: TextStyle) -> CGFloat {
        switch style {
        case .title:
            return 12
        case .section:
            return 8
        case .subsection:
            return 5
        case .lead:
            return 8
        case .label:
            return 4
        case .body:
            return 6
        case .small, .smallMuted, .meta:
            return 4
        }
    }
}
