import SwiftUI
import UIKit

struct ClassHeroHeader: View {
    let classDetail: SottoClassDetail
    let answeredCount: Int
    let questionCount: Int
    let completionProgress: Double
    let completionPercent: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Text("Class \(classDetail.order)")
                        if let level = classDetail.lesson?.level {
                            Text(level)
                        }
                        Text(classDetail.status.capitalized)
                    }
                    .font(.caption.bold())
                    .foregroundStyle(SottoTheme.primary)
                    .textCase(.uppercase)
                    .tracking(1.2)

                    Text(classDetail.lesson?.title ?? "Sotto class")
                        .font(.system(size: 44, weight: .bold, design: .serif))
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    if let objective = classDetail.lesson?.objective, !objective.isEmpty {
                        Text(objective)
                            .font(.title3)
                            .foregroundStyle(SottoTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: 16)

                ClassProgressDonut(progress: completionProgress, percent: completionPercent)
                    .accessibilityLabel("Class completion \(completionPercent) percent")
            }

            ClassSkillMap(sections: classDetail.sections)

            HStack(spacing: 10) {
                ClassMetricPill(
                    icon: "checklist",
                    label: questionCount == 0 ? "No quiz items" : "\(answeredCount) / \(questionCount) answered"
                )
                if let sourceTitle = classDetail.sourceTitle, !sourceTitle.isEmpty {
                    ClassMetricPill(icon: "link", label: sourceTitle)
                }
                ClassMetricPill(
                    icon: "target",
                    label: "Pass gate \(Int(classDetail.passThreshold * 100))%"
                )
            }
        }
        .padding(26)
        .background(
            LinearGradient(
                colors: [
                    SottoTheme.surface,
                    SottoTheme.primary.opacity(0.07),
                    Color(red: 0.96, green: 0.98, blue: 0.95)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

struct ClassProgressDonut: View {
    let progress: Double
    let percent: Int

    var body: some View {
        ZStack {
            Circle()
                .stroke(SottoTheme.line, lineWidth: 10)
            Circle()
                .trim(from: 0, to: max(0, min(1, progress)))
                .stroke(
                    SottoTheme.primary,
                    style: StrokeStyle(lineWidth: 10, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text("\(percent)%")
                    .font(.title2.bold())
                    .monospacedDigit()
                    .foregroundStyle(SottoTheme.ink)
                Text("done")
                    .font(.caption.bold())
                    .foregroundStyle(SottoTheme.muted)
            }
        }
        .frame(width: 112, height: 112)
    }
}

struct ClassSkillMap: View {
    let sections: [SottoClassSection]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                HStack(spacing: 0) {
                    SkillNode(section: section)
                    if index < sections.count - 1 {
                        Rectangle()
                            .fill(SottoTheme.line)
                            .frame(height: 2)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 8)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(14)
        .background(SottoTheme.surface.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct SkillNode: View {
    let section: SottoClassSection

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(classSkillColor(section.skill).opacity(0.16))
                Image(systemName: classSkillIcon(section.skill))
                    .font(.headline)
                    .foregroundStyle(classSkillColor(section.skill))
            }
            .frame(width: 44, height: 44)
            Text(classSkillLabel(section.skill))
                .font(.caption.bold())
                .foregroundStyle(SottoTheme.ink)
                .lineLimit(1)
            Text(sectionStatusLabel(section))
                .font(.caption2)
                .foregroundStyle(SottoTheme.muted)
                .lineLimit(1)
        }
        .frame(minWidth: 84)
    }
}

struct ClassMetricPill: View {
    let icon: String
    let label: String

    var body: some View {
        Label(label, systemImage: icon)
            .font(.callout.weight(.semibold))
            .foregroundStyle(SottoTheme.muted)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(SottoTheme.surface.opacity(0.78))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(SottoTheme.line))
    }
}

struct TimelineFigure: View {
    let timeline: SottoClassTimeline
    let onSelectionHelp: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(timeline.title)
                .font(.caption.bold())
                .foregroundStyle(SottoTheme.muted)
                .textCase(.uppercase)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(timeline.steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .center, spacing: 10) {
                        Text(String(format: "%02d", index + 1))
                            .font(.caption.bold().monospacedDigit())
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(Color(red: 0.165, green: 0.549, blue: 0.471))
                            .clipShape(Circle())
                        SelectableLearnerText(
                            step,
                            font: LearnerTextFonts.callout,
                            color: UIColor(SottoTheme.ink),
                            onExamples: onSelectionHelp
                        )
                    }
                }
            }
        }
        .padding(16)
        .background(Color(red: 0.165, green: 0.549, blue: 0.471).opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(red: 0.165, green: 0.549, blue: 0.471).opacity(0.26))
        )
    }
}

struct ContrastFigure: View {
    let contrast: SottoClassContrast
    let onSelectionHelp: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(contrast.title)
                .font(.caption.bold())
                .foregroundStyle(SottoTheme.muted)
                .textCase(.uppercase)

            HStack(alignment: .top, spacing: 0) {
                ContrastSide(
                    title: contrast.leftLabel,
                    items: contrast.leftItems,
                    color: SottoTheme.primary,
                    onSelectionHelp: onSelectionHelp
                )
                ContrastSide(
                    title: contrast.rightLabel,
                    items: contrast.rightItems,
                    color: Color(red: 0.72, green: 0.39, blue: 0.18),
                    onSelectionHelp: onSelectionHelp
                )
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(SottoTheme.line)
            )
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

struct ContrastSide: View {
    let title: String
    let items: [String]
    let color: Color
    let onSelectionHelp: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.callout.bold())
                .foregroundStyle(SottoTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(items, id: \.self) { item in
                HStack(alignment: .top, spacing: 7) {
                    Circle()
                        .fill(color)
                        .frame(width: 7, height: 7)
                        .padding(.top, 7)
                    SelectableLearnerText(
                        item,
                        font: LearnerTextFonts.caption,
                        color: UIColor(SottoTheme.muted),
                        onExamples: onSelectionHelp
                    )
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.1))
    }
}

struct ClassIntroBlock: View {
    let intro: SottoClassIntro
    let onSelectionHelp: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 10) {
                SelectableLearnerText(
                    intro.purpose,
                    font: LearnerTextFonts.title2Bold,
                    color: UIColor(SottoTheme.ink),
                    onExamples: onSelectionHelp
                )

                SelectableLearnerText(
                    intro.about,
                    font: LearnerTextFonts.body,
                    color: UIColor(SottoTheme.muted),
                    onExamples: onSelectionHelp
                )
            }

            if intro.visuals?.timeline != nil || intro.visuals?.contrast != nil {
                HStack(alignment: .top, spacing: 14) {
                    if let timeline = intro.visuals?.timeline, timeline.steps.count >= 2 {
                        TimelineFigure(timeline: timeline, onSelectionHelp: onSelectionHelp)
                            .frame(maxWidth: .infinity)
                    }
                    if let contrast = intro.visuals?.contrast {
                        ContrastFigure(contrast: contrast, onSelectionHelp: onSelectionHelp)
                            .frame(maxWidth: .infinity)
                    }
                }
            }

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Focus")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.muted)
                    ForEach(intro.focus, id: \.self) { item in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "checkmark.circle")
                                .font(.callout)
                                .foregroundStyle(SottoTheme.ink)
                            SelectableLearnerText(
                                item,
                                font: LearnerTextFonts.callout,
                                color: UIColor(SottoTheme.ink),
                                onExamples: onSelectionHelp
                            )
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 10) {
                    Text("Examples")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.muted)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(intro.examples, id: \.target) { example in
                                VStack(alignment: .leading, spacing: 5) {
                                    SelectableLearnerText(
                                        example.target,
                                        font: LearnerTextFonts.headline,
                                        color: UIColor(SottoTheme.ink),
                                        onExamples: onSelectionHelp
                                    )
                                    SelectableLearnerText(
                                        example.meaning,
                                        font: LearnerTextFonts.callout,
                                        color: UIColor(SottoTheme.muted),
                                        onExamples: onSelectionHelp
                                    )
                                    SelectableLearnerText(
                                        example.note,
                                        font: LearnerTextFonts.caption,
                                        color: UIColor(SottoTheme.muted),
                                        onExamples: onSelectionHelp
                                    )
                                }
                                .padding(14)
                                .frame(width: 280, alignment: .leading)
                                .background(SottoTheme.paper)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(SottoTheme.line)
                                )
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            let callouts = intro.visuals?.callouts.isEmpty == false
                ? intro.visuals?.callouts ?? []
                : intro.tips.enumerated().map { index, tip in
                    SottoClassCallout(label: "Tip \(index + 1)", text: tip, tone: "blue")
                }

            if !callouts.isEmpty {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    alignment: .leading,
                    spacing: 10
                ) {
                    ForEach(callouts, id: \.text) { callout in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(callout.label)
                                .font(.caption.bold())
                                .foregroundStyle(SottoTheme.ink)
                                .textCase(.uppercase)
                            SelectableLearnerText(
                                callout.text,
                                font: LearnerTextFonts.callout,
                                color: UIColor(SottoTheme.muted),
                                onExamples: onSelectionHelp
                            )
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(calloutToneColor(callout.tone).opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(calloutToneColor(callout.tone).opacity(0.36))
                        )
                    }
                }
            }
        }
        .padding(22)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}
