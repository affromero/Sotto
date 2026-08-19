import SwiftUI

struct CourseHeroPanel: View {
    @Environment(\.sottoLayout) private var layout
    let title: String
    let course: SottoCourse
    let isManualPlacement: Bool
    let onPlacement: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            SottoAdaptiveStack(spacing: layout == .compact ? 10 : 18) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(languageName(course.targetLang).uppercased())
                        .font(.caption.bold())
                        .tracking(1.8)
                        .foregroundStyle(SottoTheme.muted)

                    Text(title)
                        .font(.system(size: layout.heroTitleSize, weight: .semibold, design: .serif))
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if layout != .compact {
                    Spacer(minLength: 16)
                }

                VStack(alignment: layout == .compact ? .leading : .trailing, spacing: 10) {
                    Text(course.pedagogy.label)
                        .font(.caption.bold())
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(SottoTheme.primary.opacity(0.09))
                        .foregroundStyle(SottoTheme.primary)
                        .clipShape(Capsule())
                }
            }

            VStack(alignment: .leading, spacing: 8) {
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
                .frame(height: 6)

                if isManualPlacement {
                    HStack(alignment: .center, spacing: 10) {
                        Text("Manual level. Placement can confirm the fit.")
                            .font(.caption)
                            .foregroundStyle(SottoTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        Button(action: onPlacement) {
                            Label("Confirm level", systemImage: "checkmark.seal")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }

            FlowLayout(spacing: 8) {
                Text("\(course.nativeLang.uppercased()) -> \(course.targetLang.uppercased())")
                Text("Placement \(placementLabel(course.placementSource))")
                Text("\(course.classes.count) \(course.classes.count == 1 ? "class" : "classes")")
            }
            .font(.caption)
            .foregroundStyle(SottoTheme.muted)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface.opacity(0.82))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line.opacity(0.65))
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
    let onMemory: () -> Void

    private let secondaryColumns = [
        GridItem(.adaptive(minimum: 116), spacing: 8),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ActionButton(
                title: primaryTitle,
                icon: primaryIcon,
                disabled: generating,
                action: onPrimary
            )

            LazyVGrid(columns: secondaryColumns, alignment: .leading, spacing: 8) {
                Menu {
                    ForEach(practiceOptions) { option in
                        Button(option.label) {
                            onPractice(option.kind)
                        }
                    }
                } label: {
                    SecondaryActionLabel(title: "Practice", icon: "target")
                }
                .buttonStyle(.plain)

                SecondaryAction(title: "Live", icon: "waveform", action: onLive)
                SecondaryAction(title: "Exam", icon: "checklist", action: onExam)
                SecondaryAction(title: "Placement", icon: "checkmark.seal", action: onPlacement)
                SecondaryAction(title: "Workbook", icon: "pencil.and.scribble", action: onWorkbook)
                SecondaryAction(title: "Memory", icon: "brain", action: onMemory)
            }
        }
    }
}

private struct ActionButton: View {
    let title: String
    let icon: String
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.headline.weight(.semibold))
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.84)
                Spacer(minLength: 4)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SottoTheme.primary)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.62 : 1)
    }
}

private struct SecondaryAction: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            SecondaryActionLabel(title: title, icon: icon)
        }
        .buttonStyle(.plain)
    }
}

private struct SecondaryActionLabel: View {
    let title: String
    let icon: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon)
                .font(.callout.weight(.semibold))
                .foregroundStyle(SottoTheme.primary)
            Text(title)
                .font(.callout.weight(.semibold))
                .foregroundStyle(SottoTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.88)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(SottoTheme.line.opacity(0.65))
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
                subtitle: "Use a link or one interest starter.",
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
                Label("Active class waiting. This opens it first.", systemImage: "bolt.circle")
                    .font(.caption)
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
                            .buttonStyle(ChipButtonStyle(tint: SottoTheme.primary))
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
                subtitle: "Used for future generation.",
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
                subtitle: "Save official notes, vocab, or textbook context.",
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
                    subtitle: "Reopen classes and workbooks.",
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
                .font(.callout.weight(.semibold))
                .frame(width: 32, height: 32)
                .background(SottoTheme.primary.opacity(0.08))
                .foregroundStyle(SottoTheme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct PanelStyleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SottoTheme.surface.opacity(0.76))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(SottoTheme.line.opacity(0.7))
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
            .background(tint.opacity(configuration.isPressed ? 0.14 : 0.07))
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
