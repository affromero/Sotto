import SwiftUI

struct CourseListView: View {
    @EnvironmentObject private var model: SottoAppModel
    @State private var selectedCourseId: String?
    @State private var showingNewCourse = false

    private var selectedCourse: SottoCourse? {
        model.courses.first { $0.id == selectedCourseId } ?? model.courses.first
    }

    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sotto")
                            .font(.largeTitle.bold())
                            .foregroundStyle(SottoTheme.ink)
                        if let activeProfile = model.activeProfile {
                            Text(activeProfile.name)
                                .font(.callout.bold())
                                .foregroundStyle(SottoTheme.ink)
                                .lineLimit(1)
                        }
                        Text(model.credentials?.serverURL.host() ?? "Self-hosted")
                            .font(.caption.monospaced())
                            .foregroundStyle(SottoTheme.muted)
                            .lineLimit(1)
                    }

                    Spacer()

                    ProfileToolbarMenu()

                    Button {
                        showingNewCourse = true
                    } label: {
                        Image(systemName: "plus")
                            .frame(width: 42, height: 42)
                    }
                    .buttonStyle(.plain)
                    .background(SottoTheme.surface)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(SottoTheme.line))
                    .accessibilityLabel("Create course")
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)

                AgentUsageStatusCard()
                    .padding(.horizontal, 20)

                List(selection: $selectedCourseId) {
                    ForEach(model.courses) { course in
                        CourseRow(
                            course: course,
                            generation: model.classGenerationOperations[course.id],
                            error: model.classGenerationErrors[course.id]
                        )
                            .tag(course.id)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)

                Button(role: .destructive) {
                    model.signOut()
                } label: {
                    Label("Unpair device", systemImage: "rectangle.portrait.and.arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SottoSecondaryButtonStyle())
                .padding(20)
            }
            .background(SottoTheme.paper)
            .navigationSplitViewColumnWidth(min: 320, ideal: 380, max: 440)
        } detail: {
            if let selectedCourse {
                CourseDetailPane(course: selectedCourse)
            } else {
                EmptyCourseState {
                    showingNewCourse = true
                }
            }
        }
        .task {
            if model.courses.isEmpty {
                await model.loadCourses()
            }
            await model.loadAgentUsage()
        }
        .onChange(of: model.courses) { _, courses in
            guard selectedCourseId == nil else { return }
            selectedCourseId = courses.first?.id
        }
        .sheet(isPresented: $showingNewCourse) {
            NewCourseView()
                .environmentObject(model)
        }
    }
}

private struct AgentUsageStatusCard: View {
    @EnvironmentObject private var model: SottoAppModel

    private var providers: [SottoAgentUsageProvider] {
        model.agentUsage?.providers.filter(shouldShowProvider) ?? []
    }

    var body: some View {
        Group {
            if model.agentUsageFailed || model.isAgentUsageRefreshing || !providers.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Label("Usage", systemImage: "clock")
                            .font(.caption.bold())
                            .foregroundStyle(SottoTheme.ink)

                        Spacer()

                        if model.isAgentUsageRefreshing {
                            ProgressView()
                                .controlSize(.small)
                        }

                        Button {
                            Task {
                                await model.loadAgentUsage()
                            }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(SottoTheme.muted)
                        .accessibilityLabel("Refresh usage")
                    }

                    if model.agentUsageFailed {
                        Label("Usage status is unavailable.", systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(SottoTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    } else if providers.isEmpty {
                        Text("Loading usage")
                            .font(.caption)
                            .foregroundStyle(SottoTheme.muted)
                    } else {
                        ForEach(providers) { provider in
                            ProviderUsageRow(provider: provider)
                        }
                    }
                }
                .padding(14)
                .background(SottoTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(SottoTheme.line)
                )
            }
        }
    }

    private func shouldShowProvider(_ provider: SottoAgentUsageProvider) -> Bool {
        provider.limitReached ||
        provider.status == "ready" ||
        (provider.status == "action_required" && provider.category == "audio") ||
        provider.status == "unavailable" ||
        !provider.windows.isEmpty ||
        provider.credits != nil
    }
}

private struct ProviderUsageRow: View {
    let provider: SottoAgentUsageProvider

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(displayName)
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(SottoTheme.ink)
                    .lineLimit(1)

                Spacer(minLength: 8)

                if provider.limitReached {
                    Text("Limited")
                        .font(.caption.bold())
                        .foregroundStyle(.red)
                }
            }

            if provider.windows.isEmpty {
                Label(provider.detail, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 5) {
                    ForEach(provider.windows, id: \.label) { window in
                        HStack(spacing: 6) {
                            Text(window.label)
                                .font(.caption.bold())
                                .foregroundStyle(SottoTheme.ink)
                                .frame(width: 32, alignment: .leading)

                            ProgressView(value: clampedPercent(window.usedPercent), total: 100)
                                .tint(provider.limitReached ? .red : SottoTheme.success)

                            Text(windowSummary(window))
                                .font(.caption)
                                .foregroundStyle(SottoTheme.muted)
                                .lineLimit(1)
                                .monospacedDigit()
                        }
                    }
                }
            }

            if let credits = creditsLabel {
                Text(credits)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .lineLimit(1)
            }
        }
        .padding(.top, 10)
        .overlay(Rectangle().fill(SottoTheme.line).frame(height: 1), alignment: .top)
    }

    private var displayName: String {
        if let planLabel = provider.planLabel, !planLabel.isEmpty {
            return "\(planLabel) \(provider.shortLabel)"
        }
        return provider.shortLabel
    }

    private var creditsLabel: String? {
        if let label = provider.credits?.label, !label.isEmpty {
            return label
        }
        if provider.credits?.unlimited == true {
            return "Credits unlimited"
        }
        if let balance = provider.credits?.balance, !balance.isEmpty {
            return "Credits $\(balance)"
        }
        return nil
    }

    private func windowSummary(_ window: SottoAgentUsageWindow) -> String {
        let value = window.valueLabel ?? "\(Int(clampedPercent(window.usedPercent).rounded()))%"
        if let resetIn = window.resetIn {
            return "\(value) (\(resetIn))"
        }
        return value
    }

    private func clampedPercent(_ value: Double) -> Double {
        min(100, max(0, value))
    }
}

private struct CourseRow: View {
    let course: SottoCourse
    let generation: SottoLoadingOperation?
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(course.curriculum?.title ?? "\(course.nativeLang.uppercased()) to \(course.targetLang.uppercased())")
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                    .lineLimit(2)
                Spacer()
                Text(course.currentLevel)
                    .font(.caption.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(SottoTheme.primary.opacity(0.12))
                    .foregroundStyle(SottoTheme.primary)
                    .clipShape(Capsule())
            }

            HStack(spacing: 8) {
                if generation != nil {
                    SottoBrandMark(progress: generation?.progress)
                        .frame(width: 18, height: 18)
                    Text("Generating")
                        .foregroundStyle(SottoTheme.primary)
                } else if error != nil {
                    Label("Needs retry", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                } else {
                    Label(course.activeClassId == nil ? "Ready" : "Class open", systemImage: course.activeClassId == nil ? "checkmark.circle" : "bolt.circle")
                        .foregroundStyle(course.activeClassId == nil ? SottoTheme.success : SottoTheme.primary)
                }
                Text("\(course.nativeLang.uppercased()) -> \(course.targetLang.uppercased())")
                    .foregroundStyle(SottoTheme.muted)
            }
            .font(.caption)
        }
        .padding(.vertical, 12)
    }
}

private struct CourseDetailPane: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.openURL) private var openURL
    let course: SottoCourse

    private var generation: SottoLoadingOperation? {
        model.classGenerationOperations[course.id]
    }

    private var generationError: String? {
        model.classGenerationErrors[course.id]
    }

    private var courseTitle: String {
        course.curriculum?.title ?? "\(languageName(course.targetLang)) for \(languageName(course.nativeLang)) speakers"
    }

    private var isManualPlacement: Bool {
        course.placementSource == "MANUAL"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                CourseHeroPanel(
                    title: courseTitle,
                    course: course,
                    isManualPlacement: isManualPlacement,
                    onPlacement: openPlacement
                )

                if let generation {
                    ClassGenerationStatusPanel(operation: generation) {
                        Task {
                            await model.cancelClassGeneration(for: course.id)
                        }
                    }
                } else if let generationError {
                    ClassGenerationErrorPanel(message: generationError) {
                        model.startClassGeneration(for: course)
                    }
                }

                CourseActionGrid(
                    primaryTitle: primaryActionTitle,
                    primaryIcon: primaryActionIcon,
                    generating: generation != nil,
                    onPrimary: startOrResumeClass,
                    onPractice: startPractice,
                    onLive: openLive,
                    onExam: openExam,
                    onPlacement: openPlacement,
                    onWorkbook: openWorkbook
                )

                SourcedClassPanel(course: course, activeClassId: course.activeClassId)

                TeachingApproachPanel(course: course)

                CourseNotesEditor(course: course)

                CourseClassHistoryPanel(course: course)

                VStack(alignment: .leading, spacing: 14) {
                    Text(statusTitle)
                        .font(.title2.bold())
                        .foregroundStyle(SottoTheme.ink)
                    Text(statusDetail)
                        .font(.body)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SottoTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(SottoTheme.line)
                )
            }
            .padding(44)
            .frame(maxWidth: 1060, alignment: .leading)
        }
        .background(SottoTheme.paper)
    }

    private var primaryActionTitle: String {
        if generation != nil { return "Generating class" }
        return course.activeClassId == nil ? "Take class" : "Resume class"
    }

    private var primaryActionIcon: String {
        generation == nil ? "play.fill" : "clock"
    }

    private var statusTitle: String {
        if generation != nil { return "Class is being generated" }
        if generationError != nil { return "Class generation needs attention" }
        return course.activeClassId == nil ? "Next class is ready" : "Current class is waiting"
    }

    private var statusDetail: String {
        if generation != nil {
            return "You can keep using this device while Sotto builds the class. When it is ready, this action changes to Resume class."
        }
        if generationError != nil {
            return "The background class build did not finish cleanly. Retry when the server is reachable."
        }
        return course.activeClassId == nil ? "Use Take class to generate the first class. The workbook becomes available as soon as that class exists." : "Resume the active class before Sotto creates another one. The workbook button opens the current worksheet with Apple Pencil notes."
    }

    private func startOrResumeClass() {
        Task {
            if let activeClassId = course.activeClassId {
                await model.openClass(activeClassId)
            } else {
                await model.startOrResumeClass(for: course)
            }
        }
    }

    private func startPractice(_ kind: String) {
        Task {
            await model.startPractice(courseId: course.id, kind: kind)
        }
    }

    private func openWorkbook() {
        Task {
            await model.openWorkbook(for: course)
        }
    }

    private func openLive() {
        openWeb(path: "/learn/live", queryItems: [URLQueryItem(name: "course", value: course.id)])
    }

    private func openExam() {
        openWeb(path: "/learn/exams", queryItems: [URLQueryItem(name: "course", value: course.id)])
    }

    private func openPlacement() {
        openWeb(
            path: "/learn/placement",
            queryItems: [
                URLQueryItem(name: "native", value: course.nativeLang),
                URLQueryItem(name: "target", value: course.targetLang),
            ]
        )
    }

    private func openWeb(path: String, queryItems: [URLQueryItem] = []) {
        guard let base = model.credentials?.serverURL,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { return }
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else { return }
        openURL(url)
    }
}

private struct ClassGenerationStatusPanel: View {
    let operation: SottoLoadingOperation
    let onCancel: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            SottoBrandMark(progress: operation.progress)
                .frame(width: 58, height: 58)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(operation.title)
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                    Spacer()
                    if let progress = operation.progress {
                        Text("\(Int(max(0, min(1, progress)) * 100))%")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(SottoTheme.muted)
                    }
                }

                Text(operation.detail)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                ProgressView(value: operation.progress ?? 0.04)
                    .tint(SottoTheme.primary)

                HStack {
                    if let elapsedSeconds = operation.elapsedSeconds {
                        Text("Elapsed \(formatDuration(elapsedSeconds))")
                            .font(.caption)
                            .foregroundStyle(SottoTheme.muted)
                    }
                    Spacer()
                    Button(role: .destructive, action: onCancel) {
                        Label("Cancel", systemImage: "xmark.circle")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
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
    }

    private func formatDuration(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        if minutes > 0 {
            return "\(minutes)m \(remainingSeconds)s"
        }
        return "\(remainingSeconds)s"
    }
}

private struct ClassGenerationErrorPanel: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(.red)
            VStack(alignment: .leading, spacing: 6) {
                Text("Class generation failed")
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button("Retry", action: onRetry)
                .buttonStyle(.bordered)
        }
        .padding(18)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

private struct EmptyCourseState: View {
    let onCreate: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "books.vertical")
                .font(.system(size: 62))
                .foregroundStyle(SottoTheme.primary)
            Text("Create your first course")
                .font(.largeTitle.bold())
                .foregroundStyle(SottoTheme.ink)
            Text("Choose the native and target language codes. Sotto will create the curriculum on your self-hosted server.")
                .font(.title3)
                .multilineTextAlignment(.center)
                .foregroundStyle(SottoTheme.muted)
                .frame(maxWidth: 520)
            Button {
                onCreate()
            } label: {
                Label("Create course", systemImage: "plus")
            }
            .buttonStyle(SottoPrimaryButtonStyle())
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SottoTheme.paper)
    }
}

private struct NewCourseView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var native = "en"
    @State private var target = "es"

    var body: some View {
        NavigationStack {
            Form {
                Section("Languages") {
                    TextField("Native language", text: $native)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Target language", text: $target)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("New course")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await model.createCourse(native: native, target: target)
                            if model.errorMessage == nil {
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
