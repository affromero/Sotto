import Foundation

@MainActor
final class SottoAppModel: ObservableObject {
    @Published private(set) var credentials: SottoCredentials?
    @Published private(set) var profiles: [SottoProfile] = []
    @Published private(set) var courses: [SottoCourse] = []
    @Published var selectedClass: SottoClassDetail?
    @Published var pencilWorkbook = false
    var learningSessions: [String: NativeLearningSessionState] = [:]
    var pendingPracticeAdmissions: [String: UUID] = [:]
    @Published var practiceStart: SottoPracticeStart?
    @Published private(set) var practiceOverview: SottoPracticeOverview?
    @Published var classResult: SottoClassSubmitResult?
    @Published var practiceResult: SottoPracticeSubmitResult?
    @Published var workbook: SottoWorksheetResponse?
    @Published var isLoading = false
    @Published var loadingOperation: SottoLoadingOperation?
    @Published private(set) var agentUsage: SottoAgentUsageStatus?
    @Published private(set) var isAgentUsageRefreshing = false
    @Published private(set) var agentUsageFailed = false
    @Published private(set) var classGenerationOperations: [String: SottoLoadingOperation] = [:]
    @Published private(set) var classGenerationErrors: [String: String] = [:]
    @Published var errorMessage: String?
    @Published var courseRefreshError: String?
    var courseRefreshTasks: [SottoLearnerIdentity: SottoCourseRefreshRequest] = [:]
    var practiceCourses: [String: String] = [:]
    var practiceOverviewCourseId: String?

    private let credentialStore: any SottoCredentialPersistence
    private let session: URLSession
    private var work: Task<Void, Never>?
    private var activeClassGenerationCourseId: String?
    private var cancelledClassGenerationCourseIds = Set<String>()
    private var classGenerationTasks: [String: Task<Void, Never>] = [:]

    init(credentials: SottoCredentials? = nil, session: URLSession = .shared,
         credentialStore: any SottoCredentialPersistence = CredentialStore()) {
        self.session = session
        self.credentialStore = credentialStore
        self.credentials = credentials ?? (try? credentialStore.load())
    }

    func persistCredentials(_ next: SottoCredentials) throws {
        try credentialStore.save(next)
        credentials = next
    }

    var isPaired: Bool {
        credentials != nil
    }

    var hasSelectedProfile: Bool {
        credentials?.selectedProfile != nil
    }

    var activeProfile: SottoProfile? {
        credentials?.selectedProfile
    }

    func redeemPairingPayload(_ pairing: PairingPayload) async {
        guard !isLoading else {
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let client = SottoAPIClient(serverURL: pairing.serverURL, apiKey: nil)
            let response = try await client.redeemPairingToken(pairing.token)
            let nextCredentials = SottoCredentials(
                serverURL: pairing.serverURL,
                apiKey: response.token,
                user: response.user,
                selectedProfile: nil
            )
            try credentialStore.save(nextCredentials)
            credentials = nextCredentials
            resetLearnerState()
            await loadProfiles()
        } catch {
            report(error)
        }

        isLoading = false
    }

    /// Runs user-initiated work that raises the loading overlay. The model owns
    /// the task so the overlay's Cancel can abandon it, and starting new work
    /// replaces whatever was still running.
    func run(_ operation: @escaping @MainActor () async -> Void) {
        work?.cancel()
        work = Task { @MainActor [weak self] in
            await operation()
            self?.work = nil
        }
    }

    /// Abandons whatever the overlay is waiting on. A class being generated is
    /// also stopped server-side, so the queue is not left building something
    /// nobody is waiting for.
    func cancelWork() async {
        if let courseId = activeClassGenerationCourseId {
            await cancelClassGeneration(for: courseId)
        }

        work?.cancel()
        work = nil
        isLoading = false
        loadingOperation = nil
    }

    @discardableResult
    func signOut() -> Bool {
        do { try credentialStore.delete() }
        catch { report(error); return false }
        credentials = nil
        profiles = []
        resetLearnerState()
        activeClassGenerationCourseId = nil
        cancelledClassGenerationCourseIds.removeAll()
        classGenerationTasks.values.forEach { $0.cancel() }
        classGenerationTasks.removeAll()
        errorMessage = nil
        return true
    }

    func clearSelectedProfile() {
        guard var nextCredentials = credentials else { return }
        nextCredentials.selectedProfile = nil
        do { try persistCredentials(nextCredentials) }
        catch { report(error); return }
        resetLearnerState()
        errorMessage = nil
    }

    func loadProfiles() async {
        guard let client = makeClient(usesSelectedProfile: false) else { return }
        isLoading = true
        errorMessage = nil

        do {
            profiles = try await client.listProfiles()
        } catch {
            report(error)
        }

        isLoading = false
    }

    func selectProfile(_ profile: SottoProfile) async {
        guard let credentials else { return }
        let selected = profiles.first { $0.id == profile.id } ?? profile
        var nextCredentials = credentials
        nextCredentials.selectedProfile = selected

        do {
            try persistCredentials(nextCredentials)
            resetLearnerState()
            await loadCourses()
        } catch {
            report(error)
        }
    }

    func createProfile(name: String, avatarSlug: String?) async {
        guard let client = makeClient(usesSelectedProfile: false) else { return }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorMessage = "Enter a profile name."
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let created = try await client.createProfile(name: trimmedName, avatarSlug: avatarSlug)
            if let refreshedProfiles = try? await client.listProfiles() {
                profiles = refreshedProfiles
            } else if !profiles.contains(where: { $0.id == created.id }) {
                profiles.append(created)
            }
            isLoading = false
            await selectProfile(profiles.first { $0.id == created.id } ?? created)
            return
        } catch {
            report(error)
        }

        isLoading = false
    }

    private func resetLearnerState() {
        courseRefreshTasks.values.forEach { $0.task.cancel() }
        courseRefreshTasks.removeAll()
        courseRefreshError = nil
        practiceCourses = [:]
        practiceOverviewCourseId = nil
        courses = []
        selectedClass = nil
        practiceStart = nil
        pencilWorkbook = false
        classResult = nil
        practiceResult = nil
        workbook = nil
        agentUsage = nil
        isAgentUsageRefreshing = false
        agentUsageFailed = false
        classGenerationOperations = [:]
        classGenerationErrors = [:]
        classGenerationTasks.values.forEach { $0.cancel() }
        classGenerationTasks.removeAll()
    }

    func closeClass() {
        selectedClass = nil
        pencilWorkbook = false
        classResult = nil
        workbook = nil
    }

    func applyCourseRefresh(_ refreshed: [SottoCourse]) {
        let previous = courses
        courses = refreshed
        let ids = Set(refreshed.map(\.id))
        let removedIds = Set(previous.map(\.id)).subtracting(ids)
        if let selectedClass {
            let wasKnown = previous.contains { $0.classes.contains { $0.id == selectedClass.id } }
            let remains = refreshed.contains { $0.classes.contains { $0.id == selectedClass.id } }
            if removedIds.contains(selectedClass.courseId) || (wasKnown && !remains) { closeClass() }
        }
        for id in removedIds {
            cancelledClassGenerationCourseIds.insert(id)
            classGenerationTasks[id]?.cancel()
            classGenerationTasks[id] = nil
            classGenerationOperations[id] = nil
            classGenerationErrors[id] = nil
            if activeClassGenerationCourseId == id { activeClassGenerationCourseId = nil }
        }
        if let sessionId = practiceStart?.sessionId, let courseId = practiceCourses[sessionId], !ids.contains(courseId) {
            practiceStart = nil
            practiceResult = nil
        }
        if let courseId = practiceOverviewCourseId, !ids.contains(courseId) {
            practiceOverview = nil
            practiceOverviewCourseId = nil
        }
        practiceCourses = practiceCourses.filter { ids.contains($0.value) }
    }

    func loadAgentUsage() async {
        guard hasSelectedProfile, let client = makeClient() else { return }
        isAgentUsageRefreshing = true

        do {
            agentUsage = try await client.fetchAgentUsage()
            agentUsageFailed = false
        } catch {
            agentUsageFailed = true
        }

        isAgentUsageRefreshing = false
    }

    func createCourse(native: String, target: String) async {
        guard let client = makeClient() else { return }
        let nativeCode = native.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let targetCode = target.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        guard nativeCode.count == 2, targetCode.count == 2, nativeCode != targetCode else {
            errorMessage = "Use two different ISO language codes, like en and es."
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            _ = try await client.createCourse(native: nativeCode, target: targetCode)
            courses = try await client.listCourses()
        } catch {
            report(error)
        }

        isLoading = false
    }

    func startOrResumeClass(for course: SottoCourse) async {
        if let activeClassId = course.activeClassId {
            await openClass(activeClassId)
            return
        }

        startClassGeneration(for: course)
    }

    func startClassGeneration(
        for course: SottoCourse,
        source: SottoClassGenerationSource = .curriculum
    ) {
        guard let client = makeClient() else { return }
        guard classGenerationTasks[course.id] == nil else { return }

        activeClassGenerationCourseId = course.id
        cancelledClassGenerationCourseIds.remove(course.id)
        classGenerationErrors[course.id] = nil
        let startedAt = Date()
        classGenerationOperations[course.id] = classGenerationOperation(
            progress: nil,
            course: course,
            elapsedSeconds: 0
        )
        errorMessage = nil

        classGenerationTasks[course.id] = Task { [weak self] in
            await self?.runClassGeneration(
                client: client,
                course: course,
                source: source,
                startedAt: startedAt
            )
        }
    }

    private func runClassGeneration(
        client: SottoAPIClient,
        course: SottoCourse,
        source: SottoClassGenerationSource,
        startedAt: Date
    ) async {
        let progressTask = startClassGenerationPolling(client: client, course: course, startedAt: startedAt)
        defer {
            progressTask.cancel()
            classGenerationTasks[course.id] = nil
            if activeClassGenerationCourseId == course.id {
                activeClassGenerationCourseId = nil
            }
        }

        do {
            try await client.startNextClassGeneration(courseId: course.id, source: source)
            if try await waitForGeneratedClassAfterRequestFailure(
                client: client,
                course: course,
                startedAt: startedAt,
                originalError: SottoAPIError.message("Class generation did not finish.")
            ) != nil {
                guard !isClassGenerationCancelled(course.id) else { return }
                await finishBackgroundClassGeneration(courseId: course.id, client: client)
                return
            }

            guard !Task.isCancelled, !isClassGenerationCancelled(course.id), isCurrentLearningClient(client) else { return }
            classGenerationErrors[course.id] = "Class generation did not finish."
            classGenerationOperations[course.id] = nil
        } catch {
            if isClassGenerationCancelled(course.id) {
                return
            }

            do {
                if try await waitForGeneratedClassAfterRequestFailure(
                    client: client,
                    course: course,
                    startedAt: startedAt,
                    originalError: error
                ) != nil {
                    guard !isClassGenerationCancelled(course.id) else { return }
                    await finishBackgroundClassGeneration(courseId: course.id, client: client)
                    return
                }
            } catch {
                if isClassGenerationCancelled(course.id) {
                    return
                }
            }

            guard !Task.isCancelled, !isClassGenerationCancelled(course.id), isCurrentLearningClient(client) else { return }
            classGenerationErrors[course.id] = error.localizedDescription
            classGenerationOperations[course.id] = nil
        }
    }

    private func finishBackgroundClassGeneration(
        courseId: String,
        client: SottoAPIClient
    ) async {
        do {
            let refreshed = try await client.listCourses()
            guard !Task.isCancelled, !isClassGenerationCancelled(courseId), isCurrentLearningClient(client) else { return }
            applyCourseRefresh(refreshed)
            guard !isClassGenerationCancelled(courseId) else { return }
            classGenerationErrors[courseId] = nil
            classGenerationOperations[courseId] = nil
            refreshAgentUsageInBackground()
        } catch {
            guard !Task.isCancelled, !isClassGenerationCancelled(courseId), isCurrentLearningClient(client) else { return }
            classGenerationErrors[courseId] = error.localizedDescription
            classGenerationOperations[courseId] = nil
        }
    }

    func openClass(_ classId: String) async {
        guard let client = makeClient() else { return }
        pencilWorkbook = false
        isLoading = true
        errorMessage = nil

        do {
            var classDetail = try await client.fetchClass(classId: classId)
            if !classDetail.submitted,
               classDetail.status == "GENERATING" || isClassPresentationStillRendering(classDetail) {
                let startedAt = Date()
                loadingOperation = SottoLoadingOperation(
                    title: "Preparing class",
                    detail: "Waiting for the class material to finish rendering.",
                    progress: nil,
                    currentStep: nil,
                    totalSteps: nil,
                    elapsedSeconds: nil,
                    remainingSeconds: nil
                )
                classDetail = try await waitForRefreshedClass(
                    client: client,
                    classId: classId,
                    courseId: classDetail.courseId,
                    startedAt: startedAt,
                    initialIssues: classPresentationIssues(classDetail)
                )
            }

            let remainingIssues = classDetail.submitted ? [] : classPresentationIssues(classDetail)
            if !remainingIssues.isEmpty {
                throw SottoAPIError.message(
                    "This class is missing required presentation material: \(remainingIssues.joined(separator: " "))"
                )
            }

            guard isCurrentLearningClient(client) else { return }
            selectedClass = classDetail
            classResult = nil
        } catch {
            if isCurrentLearningClient(client) {
                if case SottoAPIError.http(404, _) = error {
                    if selectedClass?.id == classId { closeClass() }
                    await loadCourses(showLoading: false)
                    if isCurrentLearningClient(client) {
                        errorMessage = courseRefreshError == nil
                            ? "This class was removed. Your courses have been refreshed."
                            : "This class was removed, but the course list could not be refreshed. Try again."
                    }
                } else { report(error) }
            }
        }

        loadingOperation = nil
        isLoading = false
    }

    private func waitForRefreshedClass(
        client: SottoAPIClient,
        classId: String,
        courseId: String,
        startedAt: Date,
        initialIssues: [String]
    ) async throws -> SottoClassDetail {
        let deadline = startedAt.addingTimeInterval(900)
        var lastIssues = initialIssues

        while !Task.isCancelled {
            let elapsedSeconds = Int(Date().timeIntervalSince(startedAt))
            let progress = try? await client.fetchClassGenerationProgress(courseId: courseId)
            loadingOperation = classRefreshOperation(
                progress: progress,
                elapsedSeconds: elapsedSeconds,
                issues: lastIssues
            )

            let classDetail = try await client.fetchClass(classId: classId)
            let issues = classDetail.submitted ? [] : classPresentationIssues(classDetail)
            lastIssues = issues

            if classDetail.status == "FAILED" {
                let detail = issues.isEmpty ? "generation failed." : issues.joined(separator: " ")
                throw SottoAPIError.message(
                    "Class refresh failed: \(detail)"
                )
            }

            if classDetail.status != "GENERATING", issues.isEmpty {
                return classDetail
            }

            if classDetail.status != "GENERATING",
               !issues.isEmpty,
               !isClassPresentationStillRendering(classDetail) {
                throw SottoAPIError.message(
                    "This class is missing required presentation material: \(issues.joined(separator: " "))"
                )
            }

            if Date() >= deadline {
                let detail: String
                if lastIssues.isEmpty {
                    detail = "class is still incomplete."
                } else {
                    detail = lastIssues.joined(separator: " ")
                }
                throw SottoAPIError.message(
                    "Class refresh timed out before required material was ready: \(detail)"
                )
            }

            try await Task.sleep(nanoseconds: 2_000_000_000)
        }

        throw SottoAPIError.message("Class refresh was cancelled.")
    }

    private func classRefreshOperation(
        progress: SottoGenerationProgress?,
        elapsedSeconds: Int,
        issues: [String]
    ) -> SottoLoadingOperation {
        if let progress {
            return progress.loadingOperation(title: progress.lessonTitle.map { "Preparing \($0)" } ?? "Preparing class", elapsedSeconds: elapsedSeconds)
        }
        if let previous = loadingOperation {
            return previous.progressUnavailable(elapsedSeconds: elapsedSeconds)
        }

        let detail: String
        if issues.isEmpty {
            detail = "Waiting for the class material to finish rendering."
        } else {
            detail = issues.joined(separator: " ")
        }

        return SottoLoadingOperation(
            title: "Preparing class",
            detail: detail,
            progress: nil,
            currentStep: nil,
            totalSteps: nil,
            elapsedSeconds: elapsedSeconds,
            remainingSeconds: nil,
            activity: "Cannot refresh progress. Check your connection to the server."
        )
    }

    func regenerateSelectedClass() async {
        guard let client = makeClient(), let selectedClass else { return }
        isLoading = true
        loadingOperation = SottoLoadingOperation(
            title: "Regenerating class",
            detail: "Building a fresh version of the current class.",
            progress: nil,
            currentStep: nil,
            totalSteps: nil,
            elapsedSeconds: nil,
            remainingSeconds: nil
        )
        errorMessage = nil

        do {
            let startedAt = Date()
            try await client.startClassRegeneration(classId: selectedClass.id, expectedAttempt: selectedClass.attempt ?? 1)
            self.selectedClass = try await waitForRefreshedClass(
                client: client,
                classId: selectedClass.id,
                courseId: selectedClass.courseId,
                startedAt: startedAt,
                initialIssues: []
            )
            classResult = nil
            courses = try await client.listCourses()
            refreshAgentUsageInBackground()
        } catch {
            report(error)
        }

        loadingOperation = nil
        isLoading = false
    }

    func deleteSelectedClass() async {
        guard let client = makeClient(), let selectedClass else { return }
        isLoading = true
        loadingOperation = SottoLoadingOperation(
            title: "Removing class",
            detail: "Clearing the active class so a new one can be generated.",
            progress: nil,
            currentStep: nil,
            totalSteps: nil,
            elapsedSeconds: nil,
            remainingSeconds: nil
        )
        errorMessage = nil

        do {
            try await client.deleteClass(classId: selectedClass.id)
            self.selectedClass = nil
            classResult = nil
            workbook = nil
            courses = try await client.listCourses()
        } catch {
            report(error)
        }

        loadingOperation = nil
        isLoading = false
    }

    func startFullCatchUp(for course: SottoCourse) async {
        await startPractice(courseId: course.id, kind: "FULL")
    }

    /// What is due and what was left unfinished on a course. Quiet on failure:
    /// this decorates the practice menu, it does not gate it.
    func loadPracticeOverview(courseId: String) async {
        guard let client = makeClient() else { return }
        let overview = try? await client.fetchPracticeOverview(courseId: courseId)
        guard isCurrentLearningClient(client), courses.contains(where: { $0.id == courseId }) else { return }
        practiceOverview = overview
        practiceOverviewCourseId = courseId
        for practice in overview?.recent ?? [] { practiceCourses[practice.id] = courseId }
    }

    /// Discards a session the learner is not going to finish, then refreshes
    /// what is waiting so the row disappears.
    func deletePractice(sessionId: String, courseId: String) async {
        guard let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil

        do {
            try await client.deletePractice(sessionId: sessionId)
            await loadPracticeOverview(courseId: courseId)
        } catch {
            report(error)
        }

        isLoading = false
    }

    /// Reopens a session the learner started and never finished.
    func resumePractice(sessionId: String) async {
        guard let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil

        do {
            let resumed = try await client.fetchPractice(sessionId: sessionId)
            guard isCurrentLearningClient(client) else { return }
            practiceStart = resumed
            practiceResult = resumed.submissionResult
        } catch {
            report(error)
        }

        isLoading = false
    }

    func fetchCourseTopics(courseId: String) async throws -> [SottoTopicSuggestion] {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before loading class topics.")
        }
        return try await client.fetchCourseTopics(courseId: courseId)
    }

    func fetchCourseNotes(courseId: String) async throws -> SottoCourseNotesResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before loading course notes.")
        }
        return try await client.fetchCourseNotes(courseId: courseId)
    }

    func saveCourseNotes(courseId: String, body: String) async throws -> SottoCourseNotesResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before saving course notes.")
        }
        return try await client.saveCourseNotes(courseId: courseId, body: body)
    }

    func updateCoursePedagogy(
        courseId: String,
        pedagogy: SottoPedagogyStyle
    ) async throws -> SottoPedagogyStyle {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before changing the teaching approach.")
        }
        let saved = try await client.updateCoursePedagogy(courseId: courseId, pedagogy: pedagogy)
        courses = try await client.listCourses()
        return saved
    }

    func submitClassAnswers(_ answers: [SottoSubmitAnswer]) async {
        guard let client = makeClient(), let selectedClass else { return }
        isLoading = true
        errorMessage = nil

        do {
            classResult = try await client.submitClass(classId: selectedClass.id, answers: answers)
            self.selectedClass = try await client.fetchClass(classId: selectedClass.id)
            await loadCourses()
        } catch {
            report(error)
        }

        isLoading = false
    }

    func submitPracticeAnswers(_ answers: [SottoPracticeAnswer]) async {
        guard let client = makeClient(), let practiceStart else { return }
        isLoading = true
        errorMessage = nil

        do {
            let result = try await client.submitPractice(sessionId: practiceStart.sessionId, answers: answers)
            guard isCurrentLearningClient(client), self.practiceStart?.sessionId == practiceStart.sessionId else { return }
            practiceResult = result
        } catch {
            report(error)
        }

        isLoading = false
    }

    func openWorkbook(for course: SottoCourse, pencil: Bool) async {
        guard let activeClassId = course.activeClassId else {
            errorMessage = "Take class first. Sotto creates the workbook after the class exists."
            return
        }
        await openWorkbook(for: activeClassId, pencil: pencil)
    }

    func fetchSelectionHelp(
        courseId: String,
        text: String,
        contextText: String?
    ) async throws -> SottoSelectionHelpResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before asking for class help.")
        }
        return try await client.fetchSelectionHelp(
            courseId: courseId,
            text: text,
            contextText: contextText
        )
    }

    func uploadClassSpeakingRecording(
        classId: String,
        promptId: String,
        audioURL: URL
    ) async throws -> SottoSpeakingUploadResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before recording speaking feedback.")
        }
        return try await client.uploadClassSpeakingRecording(
            classId: classId,
            promptId: promptId,
            audioURL: audioURL
        )
    }

    func pollClassSpeakingRecording(
        classId: String,
        promptId: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before checking speaking feedback.")
        }
        return try await client.pollClassSpeakingRecording(
            classId: classId,
            promptId: promptId,
            recordingId: recordingId
        )
    }

    func uploadPracticeSpeakingRecording(
        sessionId: String,
        promptId: String,
        audioURL: URL
    ) async throws -> SottoSpeakingUploadResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before recording speaking feedback.")
        }
        return try await client.uploadPracticeSpeakingRecording(
            sessionId: sessionId,
            promptId: promptId,
            audioURL: audioURL
        )
    }

    func pollPracticeSpeakingRecording(
        sessionId: String,
        promptId: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before checking speaking feedback.")
        }
        return try await client.pollPracticeSpeakingRecording(
            sessionId: sessionId,
            promptId: promptId,
            recordingId: recordingId
        )
    }

    func fetchEpisode(episodeId: String) async throws -> SottoEpisode {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before playing episode audio.")
        }
        return try await client.fetchEpisode(episodeId: episodeId)
    }

    func cancelClassGeneration(for courseId: String) async {
        guard let client = makeClient() else { return }

        cancelledClassGenerationCourseIds.insert(courseId)
        classGenerationTasks[courseId]?.cancel()
        classGenerationTasks[courseId] = nil
        classGenerationOperations[courseId] = SottoLoadingOperation(
            title: "Cancelling class generation",
            detail: "Stopping the current class build and clearing the retry state.",
            progress: nil,
            currentStep: nil,
            totalSteps: nil,
            elapsedSeconds: nil,
            remainingSeconds: nil
        )

        do {
            try await client.cancelClassGeneration(courseId: courseId)
            courses = try await client.listCourses()
            classGenerationErrors[courseId] = nil
        } catch {
            classGenerationErrors[courseId] = error.localizedDescription
        }

        if activeClassGenerationCourseId == courseId {
            activeClassGenerationCourseId = nil
        }
        classGenerationOperations[courseId] = nil
    }

    func makeClient(usesSelectedProfile: Bool = true) -> SottoAPIClient? {
        guard let credentials else { return nil }
        return SottoAPIClient(
            serverURL: credentials.serverURL,
            apiKey: credentials.apiKey,
            profileId: usesSelectedProfile ? credentials.selectedProfile?.id : nil,
            session: session
        )
    }

    private func refreshAgentUsageInBackground() {
        Task { [weak self] in
            await self?.loadAgentUsage()
        }
    }

    private func isClassGenerationCancelled(_ courseId: String) -> Bool {
        cancelledClassGenerationCourseIds.contains(courseId)
    }

    private func waitForGeneratedClassAfterRequestFailure(
        client: SottoAPIClient,
        course: SottoCourse,
        startedAt: Date,
        originalError: Error
    ) async throws -> String? {
        let deadline = Date().addingTimeInterval(900)
        let idleGraceDeadline = startedAt.addingTimeInterval(30)

        while !Task.isCancelled && !isClassGenerationCancelled(course.id) {
            let elapsedSeconds = Int(Date().timeIntervalSince(startedAt))
            let progress = try? await client.fetchClassGenerationProgress(courseId: course.id)
            guard !Task.isCancelled, !isClassGenerationCancelled(course.id), isCurrentLearningClient(client) else { return nil }

            classGenerationOperations[course.id] = classGenerationOperation(
                progress: progress,
                course: course,
                elapsedSeconds: elapsedSeconds,
                previous: classGenerationOperations[course.id]
            )

            if let progress, let classId = progress.classId {
                if progress.status != "GENERATING" && progress.status != "IDLE" {
                    return classId
                }
            }

            if Date() >= deadline || (progress?.status == "IDLE" && Date() >= idleGraceDeadline) {
                throw originalError
            }

            try? await Task.sleep(nanoseconds: 1_500_000_000)
        }

        return nil
    }

    private func startClassGenerationPolling(
        client: SottoAPIClient,
        course: SottoCourse,
        startedAt: Date
    ) -> Task<Void, Never> {
        Task { [weak self] in
            while !Task.isCancelled {
                let elapsedSeconds = Int(Date().timeIntervalSince(startedAt))
                do {
                    let progress = try await client.fetchClassGenerationProgress(courseId: course.id)
                    await MainActor.run {
                        guard let self, !Task.isCancelled, !self.isClassGenerationCancelled(course.id), self.isCurrentLearningClient(client) else { return }
                        self.classGenerationOperations[course.id] = self.classGenerationOperation(
                            progress: progress,
                            course: course,
                            elapsedSeconds: elapsedSeconds
                        )
                    }
                } catch {
                    await MainActor.run {
                        guard let self, !Task.isCancelled, !self.isClassGenerationCancelled(course.id), self.isCurrentLearningClient(client) else { return }
                        self.classGenerationOperations[course.id] = self.classGenerationOperation(
                            progress: nil,
                            course: course,
                            elapsedSeconds: elapsedSeconds,
                            previous: self.classGenerationOperations[course.id]
                        )
                    }
                }

                try? await Task.sleep(nanoseconds: 1_500_000_000)
            }
        }
    }

    private func classGenerationOperation(
        progress: SottoGenerationProgress?,
        course: SottoCourse,
        elapsedSeconds: Int,
        previous: SottoLoadingOperation? = nil
    ) -> SottoLoadingOperation {
        if let progress {
            let title = progress.lessonTitle.map { "Generating \($0)" } ?? "Generating class"
            return progress.loadingOperation(title: title, elapsedSeconds: elapsedSeconds)
        }
        if let previous { return previous.progressUnavailable(elapsedSeconds: elapsedSeconds) }
        return SottoLoadingOperation(
            title: "Generating \(course.curriculum?.title ?? "class")",
            detail: "Contacting your Sotto server and preparing the lesson plan.",
            progress: nil,
            currentStep: nil,
            totalSteps: nil,
            elapsedSeconds: elapsedSeconds,
            remainingSeconds: nil,
            activity: "Waiting for a progress report from the server."
        )
    }
}
