import SwiftUI

private struct StatPill: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.caption2.bold())
                .foregroundStyle(SottoTheme.muted)
            Text(value)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

struct CourseHeroPanel: View {
    let title: String
    let course: SottoCourse
    let isManualPlacement: Bool
    let onPlacement: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(languageName(course.targetLang).uppercased())
                        .font(.caption.bold())
                        .tracking(2.4)
                        .foregroundStyle(SottoTheme.muted)

                    Text(title)
                        .font(.system(size: 46, weight: .bold, design: .serif))
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 16)

                VStack(alignment: .trailing, spacing: 10) {
                    Text(course.pedagogy.label)
                        .font(.callout.bold())
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(SottoTheme.primary.opacity(0.12))
                        .foregroundStyle(SottoTheme.primary)
                        .clipShape(Capsule())

                    Text("\(languageName(course.nativeLang)) -> \(languageName(course.targetLang))")
                        .font(.caption)
                        .foregroundStyle(SottoTheme.muted)
                }
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Level")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.muted)
                    Spacer()
                    Text("\(course.currentLevel) · \(levelLabel(course.currentLevel))")
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                }

                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(SottoTheme.line)
                        Capsule()
                            .fill(SottoTheme.primary)
                            .frame(width: proxy.size.width * levelFraction(course.currentLevel))
                    }
                }
                .frame(height: 9)

                if isManualPlacement {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("You set this level yourself. Confirm it with placement when you want Sotto to check the fit.")
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 12)
                        Button(action: onPlacement) {
                            Label("Confirm level", systemImage: "checkmark.seal")
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }

            HStack(spacing: 12) {
                StatPill(title: "From", value: course.nativeLang.uppercased())
                StatPill(title: "To", value: course.targetLang.uppercased())
                StatPill(title: "Placement", value: placementLabel(course.placementSource))
                StatPill(title: "Classes", value: "\(course.classes.count)")
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

struct CourseActionGrid: View {
    let primaryTitle: String
    let primaryIcon: String
    let generating: Bool
    let onPrimary: () -> Void
    let onPractice: (String) -> Void
    let onLive: () -> Void
    let onExam: () -> Void
    let onPlacement: () -> Void
    let onWorkbook: () -> Void

    private let columns = [
        GridItem(.adaptive(minimum: 155), spacing: 12),
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
            ActionTile(
                title: primaryTitle,
                subtitle: generating ? "Building" : "Class",
                icon: primaryIcon,
                tint: SottoTheme.primary,
                filled: true,
                disabled: generating,
                action: onPrimary
            )

            Menu {
                ForEach(practiceOptions) { option in
                    Button(option.label) {
                        onPractice(option.kind)
                    }
                }
            } label: {
                ActionTileLabel(
                    title: "Practice",
                    subtitle: "Skill drills",
                    icon: "target",
                    tint: SottoTheme.success,
                    filled: false
                )
            }
            .buttonStyle(.plain)

            ActionTile(
                title: "Live",
                subtitle: "Conversation",
                icon: "waveform",
                tint: Color(red: 0.08, green: 0.42, blue: 0.48),
                filled: false,
                action: onLive
            )

            ActionTile(
                title: "Exam",
                subtitle: "Mock test",
                icon: "checklist",
                tint: Color(red: 0.60, green: 0.30, blue: 0.10),
                filled: false,
                action: onExam
            )

            ActionTile(
                title: "Placement",
                subtitle: "Level fit",
                icon: "checkmark.seal",
                tint: Color(red: 0.40, green: 0.28, blue: 0.58),
                filled: false,
                action: onPlacement
            )

            ActionTile(
                title: "Workbook",
                subtitle: "Pencil notes",
                icon: "pencil.and.scribble",
                tint: SottoTheme.primary,
                filled: false,
                action: onWorkbook
            )
        }
    }
}

private struct ActionTile: View {
    let title: String
    let subtitle: String
    let icon: String
    let tint: Color
    let filled: Bool
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ActionTileLabel(
                title: title,
                subtitle: subtitle,
                icon: icon,
                tint: tint,
                filled: filled
            )
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.62 : 1)
    }
}

private struct ActionTileLabel: View {
    let title: String
    let subtitle: String
    let icon: String
    let tint: Color
    let filled: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .frame(width: 38, height: 38)
                .background(filled ? Color.white.opacity(0.18) : tint.opacity(0.12))
                .foregroundStyle(filled ? .white : tint)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(filled ? .white : SottoTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(filled ? .white.opacity(0.78) : SottoTheme.muted)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)
        }
        .padding(14)
        .frame(minHeight: 74)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(filled ? tint : SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(filled ? Color.clear : SottoTheme.line)
        )
    }
}

struct SourcedClassPanel: View {
    @EnvironmentObject private var model: SottoAppModel
    let course: SottoCourse
    let activeClassId: String?

    @State private var link = ""
    @State private var topics: [SottoTopicSuggestion] = []
    @State private var isLoadingTopics = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PanelHeader(
                title: "Class about...",
                subtitle: "Build the next class from an article, paper, video link, or a learner interest.",
                icon: "link"
            )

            HStack(spacing: 10) {
                TextField("Paste a source link", text: $link)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textFieldStyle(.roundedBorder)

                Button {
                    startFromLink()
                } label: {
                    Image(systemName: "arrow.right")
                        .font(.headline)
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .background(SottoTheme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .disabled(link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Build class from link")
            }

            if activeClassId != nil {
                Label("An active class is already waiting. Opening a source now resumes that class first.", systemImage: "bolt.circle")
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }

            if isLoadingTopics {
                ProgressView("Loading topic ideas")
                    .controlSize(.small)
            } else if !topics.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Interest starters")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.muted)
                    FlowLayout(spacing: 8) {
                        ForEach(topics) { topic in
                            Button(topic.label) {
                                start(source: .topic(topic.query))
                            }
                            .buttonStyle(ChipButtonStyle(tint: SottoTheme.success))
                        }
                    }
                }
            }

            if let error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.red)
            }
        }
        .panelStyle()
        .task(id: course.id) {
            await loadTopics()
        }
    }

    private func loadTopics() async {
        guard topics.isEmpty else { return }
        isLoadingTopics = true
        defer { isLoadingTopics = false }
        do {
            topics = try await model.fetchCourseTopics(courseId: course.id)
        } catch {
            topics = []
        }
    }

    private func startFromLink() {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else {
            error = "Use a full http or https link."
            return
        }
        start(source: .sourceUrl(trimmed))
    }

    private func start(source: SottoClassGenerationSource) {
        error = nil
        if let activeClassId {
            Task {
                await model.openClass(activeClassId)
            }
            return
        }
        link = ""
        model.startClassGeneration(for: course, source: source)
    }
}

struct TeachingApproachPanel: View {
    @EnvironmentObject private var model: SottoAppModel
    let course: SottoCourse

    @State private var selected: SottoPedagogyStyle
    @State private var status = ""

    init(course: SottoCourse) {
        self.course = course
        _selected = State(initialValue: course.pedagogy)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(
                title: "Teaching approach",
                subtitle: "Applies to the next class, practice, listening, speaking, and exam generation.",
                icon: "slider.horizontal.3"
            )

            Picker("Teaching approach", selection: $selected) {
                ForEach(SottoPedagogyStyle.allCases) { style in
                    Text(style.label).tag(style)
                }
            }
            .pickerStyle(.menu)
            .onChange(of: selected) { _, next in
                save(next)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(selected.summary)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.ink)
                Text("Based on: \(selected.basis)")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !status.isEmpty {
                Text(status)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
        .panelStyle()
        .onChange(of: course.pedagogy) { _, next in
            selected = next
        }
    }

    private func save(_ next: SottoPedagogyStyle) {
        guard next != course.pedagogy else { return }
        status = "Saving..."
        Task {
            do {
                let saved = try await model.updateCoursePedagogy(courseId: course.id, pedagogy: next)
                await MainActor.run {
                    selected = saved
                    status = "Saved for future generation."
                }
            } catch {
                await MainActor.run {
                    selected = course.pedagogy
                    status = "Could not save. Try again."
                }
            }
        }
    }
}

struct CourseNotesEditor: View {
    @EnvironmentObject private var model: SottoAppModel
    let course: SottoCourse

    @State private var bodyText = ""
    @State private var isLoaded = false
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var message = ""
    @State private var error = ""

    private let maxLength = 12_000

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PanelHeader(
                title: "Course notes",
                subtitle: "Paste official notes, vocab lists, or textbook context. Saved vocabulary is added to the learner memory.",
                icon: "note.text"
            )

            TextEditor(text: $bodyText)
                .font(.body)
                .frame(minHeight: 150)
                .scrollContentBackground(.hidden)
                .padding(10)
                .background(SottoTheme.paper)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(SottoTheme.line)
                )
                .disabled(isLoading)
                .onChange(of: bodyText) { _, next in
                    if next.count > maxLength {
                        bodyText = String(next.prefix(maxLength))
                    }
                }

            HStack {
                Text(isLoading ? "Loading notes..." : "\(max(0, maxLength - bodyText.count)) chars left")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)

                Spacer()

                Button {
                    saveNotes()
                } label: {
                    Label(isSaving ? "Saving" : "Save notes", systemImage: "tray.and.arrow.down")
                }
                .buttonStyle(.borderedProminent)
                .disabled(isLoading || isSaving)
            }

            if !message.isEmpty {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.success)
            }
            if !error.isEmpty {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .panelStyle()
        .task(id: course.id) {
            await loadNotes()
        }
    }

    private func loadNotes() async {
        guard !isLoaded else { return }
        isLoading = true
        error = ""
        defer { isLoading = false }
        do {
            let response = try await model.fetchCourseNotes(courseId: course.id)
            bodyText = response.body ?? ""
            isLoaded = true
        } catch {
            self.error = "Could not load course notes."
        }
    }

    private func saveNotes() {
        isSaving = true
        error = ""
        message = ""
        Task {
            do {
                let response = try await model.saveCourseNotes(courseId: course.id, body: bodyText)
                await MainActor.run {
                    bodyText = response.body ?? ""
                    message = notesStatus(response)
                    isSaving = false
                }
            } catch {
                await MainActor.run {
                    self.error = "Could not save course notes."
                    isSaving = false
                }
            }
        }
    }

    private func notesStatus(_ response: SottoCourseNotesResponse) -> String {
        let added = response.addedVocabulary ?? 0
        if added > 0 {
            return "Saved. \(added) vocabulary item\(added == 1 ? "" : "s") added."
        }
        return "Saved."
    }
}

struct CourseClassHistoryPanel: View {
    @EnvironmentObject private var model: SottoAppModel
    let course: SottoCourse

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                PanelHeader(
                    title: "Class history",
                    subtitle: "Reopen a class, review feedback, or open its workbook.",
                    icon: "clock.arrow.circlepath"
                )
                Spacer()
                Text("\(course.classes.count) \(course.classes.count == 1 ? "class" : "classes")")
                    .font(.caption.bold())
                    .tracking(1.8)
                    .foregroundStyle(SottoTheme.muted)
            }

            if course.classes.isEmpty {
                Text("Classes you start or complete will appear here.")
                    .foregroundStyle(SottoTheme.muted)
            } else {
                VStack(spacing: 10) {
                    ForEach(course.classes) { item in
                        CourseClassHistoryRow(item: item)
                            .environmentObject(model)
                    }
                }
            }
        }
        .panelStyle()
    }
}

private struct CourseClassHistoryRow: View {
    @EnvironmentObject private var model: SottoAppModel
    let item: SottoCourseClassSummary

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text(statusLabel(item.status))
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(statusTint(item.status).opacity(0.12))
                        .foregroundStyle(statusTint(item.status))
                        .clipShape(Capsule())

                    Text("Class \(item.order) · \(item.lesson.level) · \(dateLabel(item))")
                        .font(.caption)
                        .foregroundStyle(SottoTheme.muted)
                        .lineLimit(1)
                }

                Text(classDisplayTitle(item))
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 10) {
                    Text(classDisplayTitle(item) == item.lesson.title ? "Course class" : "Source class")
                    if item.attempt > 1 {
                        Text("attempt \(item.attempt)")
                    }
                    if let score = scoreLabel(item) {
                        Text(score)
                    }
                }
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)
            }

            Spacer(minLength: 12)

            HStack(spacing: 8) {
                Button {
                    Task {
                        await model.openClass(item.id)
                    }
                } label: {
                    Label(primaryActionLabel(item.status), systemImage: "book.pages")
                }
                .buttonStyle(.borderedProminent)

                Button {
                    Task {
                        await model.openWorkbook(for: item.id)
                    }
                } label: {
                    Label("Workbook", systemImage: "pencil.and.scribble")
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(14)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

private struct PanelHeader: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.headline)
                .frame(width: 36, height: 36)
                .background(SottoTheme.primary.opacity(0.1))
                .foregroundStyle(SottoTheme.primary)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.title3.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct PanelStyleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SottoTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(SottoTheme.line)
            )
    }
}

private extension View {
    func panelStyle() -> some View {
        modifier(PanelStyleModifier())
    }
}

private struct ChipButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.callout.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(tint.opacity(configuration.isPressed ? 0.18 : 0.10))
            .clipShape(Capsule())
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout Void
    ) -> CGSize {
        let maxWidth = proposal.width ?? 0
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentX > 0, currentX + size.width > maxWidth {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            currentX += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }

        return CGSize(width: maxWidth, height: currentY + lineHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout Void
    ) {
        var currentX = bounds.minX
        var currentY = bounds.minY
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if currentX > bounds.minX, currentX + size.width > bounds.maxX {
                currentX = bounds.minX
                currentY += lineHeight + spacing
                lineHeight = 0
            }
            subview.place(
                at: CGPoint(x: currentX, y: currentY),
                proposal: ProposedViewSize(size)
            )
            currentX += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}

private struct PracticeKindOption: Identifiable {
    var id: String { kind }

    let kind: String
    let label: String
}

private let practiceOptions: [PracticeKindOption] = [
    PracticeKindOption(kind: "FULL", label: "Full catch-up"),
    PracticeKindOption(kind: "GRAMMAR", label: "Grammar"),
    PracticeKindOption(kind: "READING", label: "Reading"),
    PracticeKindOption(kind: "LISTENING", label: "Listening"),
    PracticeKindOption(kind: "SPEAKING", label: "Speaking"),
    PracticeKindOption(kind: "WRITING", label: "Writing"),
    PracticeKindOption(kind: "VOCAB", label: "Vocabulary"),
]

func languageName(_ code: String) -> String {
    Locale.current.localizedString(forLanguageCode: code) ?? code.uppercased()
}

private func placementLabel(_ placement: String) -> String {
    switch placement {
    case "MANUAL":
        return "Manual"
    case "PLACEMENT":
        return "Placement"
    default:
        return placement.capitalized
    }
}

private func levelLabel(_ level: String) -> String {
    switch level {
    case "A1":
        return "Beginner"
    case "A2":
        return "Elementary"
    case "B1":
        return "Intermediate"
    case "B2":
        return "Upper-intermediate"
    case "C1":
        return "Advanced"
    case "C2":
        return "Mastery"
    default:
        return level
    }
}

private func levelFraction(_ level: String) -> CGFloat {
    let order = ["A1", "A2", "B1", "B2", "C1", "C2"]
    guard let index = order.firstIndex(of: level) else { return 0.0 }
    return CGFloat(index + 1) / CGFloat(order.count)
}

private func statusLabel(_ status: String) -> String {
    switch status {
    case "LOCKED":
        return "Locked"
    case "GENERATING":
        return "Building"
    case "AVAILABLE":
        return "Ready"
    case "IN_PROGRESS":
        return "In progress"
    case "SUBMITTED":
        return "Submitted"
    case "PASSED":
        return "Passed"
    case "FAILED":
        return "Retry"
    default:
        return status.capitalized
    }
}

private func statusTint(_ status: String) -> Color {
    switch status {
    case "PASSED":
        return SottoTheme.success
    case "FAILED":
        return .red
    case "GENERATING", "LOCKED":
        return SottoTheme.muted
    default:
        return SottoTheme.primary
    }
}

private func primaryActionLabel(_ status: String) -> String {
    if status == "PASSED" { return "Review" }
    if status == "FAILED" { return "Retry" }
    if status == "AVAILABLE" { return "Start" }
    return "Resume"
}

private func scoreLabel(_ item: SottoCourseClassSummary) -> String? {
    guard let score = item.submission?.overallScore else { return nil }
    return "\(Int((score * 100).rounded()))%"
}

private func classDisplayTitle(_ item: SottoCourseClassSummary) -> String {
    let title = item.sourceTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return title.isEmpty ? item.lesson.title : title
}

private func dateLabel(_ item: SottoCourseClassSummary) -> String {
    let raw = item.passedAt ?? item.failedAt ?? item.submittedAt ?? item.createdAt
    guard let raw else { return "recent" }
    let formatter = ISO8601DateFormatter()
    let date = ISO8601DateFormatter.fractional.date(from: raw) ?? formatter.date(from: raw)
    guard let date else { return "recent" }
    return DateFormatter.shortMonthDay.string(from: date)
}

private extension ISO8601DateFormatter {
    static var fractional: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}

private extension DateFormatter {
    static var shortMonthDay: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter
    }
}
