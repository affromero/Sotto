import Foundation

@MainActor
final class SottoAppModel: ObservableObject {
    @Published private(set) var credentials: SottoCredentials?
    @Published private(set) var profiles: [SottoProfile] = []
    @Published private(set) var courses: [SottoCourse] = []
    @Published var selectedClass: SottoClassDetail?
    @Published var practiceStart: SottoPracticeStart?
    @Published var classResult: SottoClassSubmitResult?
    @Published var practiceResult: SottoPracticeSubmitResult?
    @Published var workbook: SottoWorksheetResponse?
    @Published var isLoading = false
    @Published var loadingOperation: SottoLoadingOperation?
    @Published var errorMessage: String?

    private let credentialStore = CredentialStore()

    init() {
        credentials = try? credentialStore.load()
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

    func pair(with scannedValue: String) async {
        switch PairingScan(scannedValue: scannedValue) {
        case let .pairing(pairing):
            await redeemPairingPayload(pairing)
        case let .serverURL(url):
            errorMessage = "That QR opens \(url.host() ?? "your Sotto server") in a browser. In Settings > Devices, scroll to Step 2: Pair the app, tap Show pairing code, then scan that QR."
        case .invalid:
            errorMessage = "That is not a Sotto pairing QR. In Settings > Devices, use Step 2: Pair the app."
        }
    }

    private func redeemPairingPayload(_ pairing: PairingPayload) async {
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
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func signOut() {
        try? credentialStore.delete()
        credentials = nil
        profiles = []
        resetLearnerState()
        errorMessage = nil
    }

    func clearSelectedProfile() {
        guard let credentials else { return }
        let nextCredentials = SottoCredentials(
            serverURL: credentials.serverURL,
            apiKey: credentials.apiKey,
            user: credentials.user,
            selectedProfile: nil
        )
        try? credentialStore.save(nextCredentials)
        self.credentials = nextCredentials
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
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func selectProfile(_ profile: SottoProfile) async {
        guard let credentials else { return }
        let selected = profiles.first { $0.id == profile.id } ?? profile
        let nextCredentials = SottoCredentials(
            serverURL: credentials.serverURL,
            apiKey: credentials.apiKey,
            user: credentials.user,
            selectedProfile: selected
        )

        do {
            try credentialStore.save(nextCredentials)
            self.credentials = nextCredentials
            resetLearnerState()
            await loadCourses()
        } catch {
            errorMessage = error.localizedDescription
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
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func resetLearnerState() {
        courses = []
        selectedClass = nil
        practiceStart = nil
        classResult = nil
        practiceResult = nil
        workbook = nil
    }

    func loadCourses() async {
        guard hasSelectedProfile, let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil

        do {
            courses = try await client.listCourses()
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
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
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func startOrResumeClass(for course: SottoCourse) async {
        guard let client = makeClient() else { return }
        isLoading = true
        let startedAt = Date()
        loadingOperation = classGenerationOperation(
            progress: nil,
            course: course,
            elapsedSeconds: 0
        )
        errorMessage = nil
        let progressTask = startClassGenerationPolling(client: client, course: course, startedAt: startedAt)
        defer {
            progressTask.cancel()
            loadingOperation = nil
            isLoading = false
        }

        do {
            let classId = try await client.startNextClass(courseId: course.id)
            selectedClass = try await client.fetchClass(classId: classId)
            classResult = nil
        } catch {
            errorMessage = error.localizedDescription
        }

    }

    func openClass(_ classId: String) async {
        guard let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil

        do {
            selectedClass = try await client.fetchClass(classId: classId)
            classResult = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func startFullCatchUp(for course: SottoCourse) async {
        guard let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil

        do {
            practiceStart = try await client.startPractice(courseId: course.id, kind: "FULL")
            practiceResult = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
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
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func submitPracticeAnswers(_ answers: [SottoPracticeAnswer]) async {
        guard let client = makeClient(), let practiceStart else { return }
        isLoading = true
        errorMessage = nil

        do {
            practiceResult = try await client.submitPractice(sessionId: practiceStart.sessionId, answers: answers)
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func openWorkbook(for classId: String) async {
        guard let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil

        do {
            workbook = try await client.fetchWorksheet(classId: classId)
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    func openWorkbook(for course: SottoCourse) async {
        guard let activeClassId = course.activeClassId else {
            errorMessage = "Take class first. Sotto creates the workbook after the class exists."
            return
        }
        await openWorkbook(for: activeClassId)
    }

    private func makeClient(usesSelectedProfile: Bool = true) -> SottoAPIClient? {
        guard let credentials else { return nil }
        return SottoAPIClient(
            serverURL: credentials.serverURL,
            apiKey: credentials.apiKey,
            profileId: usesSelectedProfile ? credentials.selectedProfile?.id : nil
        )
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
                        guard let self else { return }
                        self.loadingOperation = self.classGenerationOperation(
                            progress: progress,
                            course: course,
                            elapsedSeconds: elapsedSeconds
                        )
                    }
                } catch {
                    await MainActor.run {
                        guard let self else { return }
                        self.loadingOperation = self.classGenerationOperation(
                            progress: nil,
                            course: course,
                            elapsedSeconds: elapsedSeconds
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
        elapsedSeconds: Int
    ) -> SottoLoadingOperation {
        if let progress {
            let title = progress.lessonTitle.map { "Generating \($0)" } ?? "Generating class"
            return SottoLoadingOperation(
                title: title,
                detail: "\(progress.stage). \(progress.detail)",
                progress: max(0, min(1, progress.progress)),
                currentStep: progress.currentStep == 0 ? nil : progress.currentStep,
                totalSteps: progress.totalSteps,
                elapsedSeconds: progress.elapsedSeconds ?? elapsedSeconds,
                remainingSeconds: progress.remainingSeconds
            )
        }

        let fallbackProgress = min(0.08, Double(elapsedSeconds) / 300.0)
        return SottoLoadingOperation(
            title: "Generating \(course.curriculum?.title ?? "class")",
            detail: "Contacting your Sotto server and preparing the lesson plan.",
            progress: fallbackProgress,
            currentStep: nil,
            totalSteps: nil,
            elapsedSeconds: elapsedSeconds,
            remainingSeconds: max(0, 240 - elapsedSeconds)
        )
    }
}

private enum PairingScan {
    case pairing(PairingPayload)
    case serverURL(URL)
    case invalid

    init(scannedValue: String) {
        if let pairing = PairingPayload(scannedValue: scannedValue) {
            self = .pairing(pairing)
            return
        }

        guard
            let url = URL(string: scannedValue),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            url.host() != nil
        else {
            self = .invalid
            return
        }

        self = .serverURL(url)
    }
}

private struct PairingPayload {
    let serverURL: URL
    let token: String

    init?(scannedValue: String) {
        guard
            let url = URL(string: scannedValue),
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
            !token.isEmpty,
            let scheme = components.scheme,
            let host = components.host
        else {
            return nil
        }

        var base = URLComponents()
        base.scheme = scheme
        base.host = host
        base.port = components.port

        guard let serverURL = base.url else { return nil }
        self.serverURL = serverURL
        self.token = token
    }
}
