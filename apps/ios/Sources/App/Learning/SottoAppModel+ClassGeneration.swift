import Foundation

enum SottoClassGenerationRequest {
    case next(SottoClassGenerationSource)
    case regenerate(classId: String, previousAttempt: Int)
    case observe(classId: String, attempt: Int)

    var classId: String? {
        switch self {
        case .next: return nil
        case let .regenerate(classId, _), let .observe(classId, _): return classId
        }
    }

    func accepts(_ detail: SottoClassDetail) -> Bool {
        switch self {
        case .next: return true
        case let .regenerate(classId, previousAttempt):
            return detail.id == classId && (detail.attempt ?? 1) > previousAttempt
        case let .observe(classId, attempt):
            return detail.id == classId && (detail.attempt ?? 1) == attempt
        }
    }
}

struct SottoClassGenerationObservation {
    let id = UUID()
    let request: SottoClassGenerationRequest
    let startedAt = Date()
    var operationId: String?
    var operationStatus: String?
    var isAdmitting = false
    var admissionUnconfirmed = false
    var explicitlyRechecking = false
}

extension SottoAppModel {
    func startClassGeneration(for course: SottoCourse, source: SottoClassGenerationSource = .curriculum) {
        guard let client = makeClient(), courses.contains(where: { $0.id == course.id }) else { return }
        guard classGenerationObservations[course.id] == nil else {
            checkClassGenerationStatus(for: course)
            return
        }
        let observation = beginClassObservation(course: course, request: .next(source), admitting: true)
        classGenerationTasks[course.id] = Task { [weak self] in
            guard let self else { return }
            if await admitClassGeneration(client: client, course: course, observation: observation) {
                await monitorClassGeneration(client: client, course: course, observationId: observation.id)
            } else if classGenerationObservations[course.id] == nil || classGenerationObservations[course.id]?.id == observation.id {
                classGenerationTasks[course.id] = nil
            }
        }
    }

    func regenerateSelectedClass() async {
        guard let client = makeClient(), let selectedClass,
              let course = courses.first(where: { $0.id == selectedClass.courseId }) else { return }
        guard classGenerationObservations[course.id] == nil else {
            if classGenerationRetryTitle(for: course.id) != nil,
               let observation = classGenerationObservations[course.id],
               observation.request.classId == selectedClass.id ||
               (observation.request.classId == nil && course.activeClassId == selectedClass.id) {
                retryClassGeneration(for: course)
                return
            }
            closeClass()
            checkClassGenerationStatus(for: course)
            return
        }
        let observation = beginClassObservation(course: course,
            request: .regenerate(classId: selectedClass.id, previousAttempt: selectedClass.attempt ?? 1),
            admitting: true)
        isLoading = true
        classGenerationAdmissionId = observation.id
        loadingOperation = classGenerationOperations[course.id]
        defer {
            if classGenerationAdmissionId == observation.id, isCurrentLearningClient(client) {
                isLoading = false
                loadingOperation = nil
                classGenerationAdmissionId = nil
            }
        }
        if await admitClassGeneration(client: client, course: course, observation: observation) {
            guard observationIsCurrent(observation.id, courseId: course.id, client: client) else { return }
            closeClass()
            startClassObservationTask(client: client, course: course)
        }
    }

    /// Attaches to durable work after foreground refresh or relaunch. It never admits work.
    func resumeClassGenerationMonitoring() {
        guard let client = makeClient() else { return }
        for course in courses {
            if let observation = classGenerationObservations[course.id] {
                if !observation.isAdmitting { startClassObservationTask(client: client, course: course) }
                continue
            }
            guard let current = course.classes.first(where: { $0.id == course.activeClassId }),
                  current.status == "GENERATING" || (current.status == "FAILED" && current.submission == nil) else { continue }
            _ = beginClassObservation(course: course,
                request: .observe(classId: current.id, attempt: current.attempt ?? 1))
            startClassObservationTask(client: client, course: course)
        }
    }

    func observePreparingClass(_ detail: SottoClassDetail, client: SottoAPIClient) {
        guard isCurrentLearningClient(client), let course = courses.first(where: { $0.id == detail.courseId }) else { return }
        if classGenerationObservations[course.id] == nil {
            _ = beginClassObservation(course: course, request: .observe(classId: detail.id, attempt: detail.attempt ?? 1))
        }
        closeClass()
        startClassObservationTask(client: client, course: course)
    }

    func checkClassGenerationStatus(for course: SottoCourse) {
        guard let client = makeClient(), courses.contains(where: { $0.id == course.id }),
              classGenerationTasks[course.id] == nil else { return }
        if classGenerationObservations[course.id] == nil {
            guard let current = course.classes.first(where: { $0.id == course.activeClassId }) else { return }
            _ = beginClassObservation(course: course,
                request: .observe(classId: current.id, attempt: current.attempt ?? 1))
        }
        classGenerationObservations[course.id]?.explicitlyRechecking = true
        startClassObservationTask(client: client, course: course)
    }

    func canCancelClassGeneration(for courseId: String) -> Bool {
        guard let observation = classGenerationObservations[courseId] else { return false }
        return observation.operationId != nil && !observation.admissionUnconfirmed &&
            ["QUEUED", "RUNNING"].contains(observation.operationStatus ?? "")
    }

    func classGenerationRetryTitle(for courseId: String) -> String? {
        guard let observation = classGenerationObservations[courseId], observation.operationId != nil,
              !observation.admissionUnconfirmed, ["FAILED", "CANCELLED"].contains(observation.operationStatus ?? "") else { return nil }
        return observation.request.classId == nil ? "Try class again" : "Try regeneration again"
    }

    func retryClassGeneration(for course: SottoCourse) {
        guard let client = makeClient(), let previous = classGenerationObservations[course.id],
              classGenerationRetryTitle(for: course.id) != nil, classGenerationTasks[course.id] == nil else { return }
        classGenerationTasks[course.id] = Task { [weak self] in
            guard let self else { return }
            do {
                let progress = try await client.fetchClassGenerationProgress(courseId: course.id)
                guard observationIsCurrent(previous.id, courseId: course.id, client: client) else { return }
                guard progress.operationId == previous.operationId,
                      ["FAILED", "CANCELLED"].contains(progress.operationStatus ?? "") else {
                    stopClassObservation(courseId: course.id, message: "Preparation changed. Check status before starting another attempt.")
                    classGenerationTasks[course.id] = nil
                    return
                }
                let request: SottoClassGenerationRequest
                if let classId = progress.classId {
                    let detail = try await client.fetchClass(classId: classId)
                    guard observationIsCurrent(previous.id, courseId: course.id, client: client) else { return }
                    guard detail.id == classId, detail.courseId == course.id, detail.status != "GENERATING", previous.request.accepts(detail),
                          previous.request.classId == nil || previous.request.classId == classId else {
                        throw SottoAPIError.message("The class changed. Reload before regenerating.")
                    }
                    request = .regenerate(classId: classId, previousAttempt: detail.attempt ?? 1)
                } else if case .next = previous.request {
                    request = previous.request
                } else {
                    throw SottoAPIError.message("The class could not be identified. Check status.")
                }
                let observation = beginClassObservation(course: course, request: request, admitting: true)
                if await admitClassGeneration(client: client, course: course, observation: observation) {
                    if selectedClass?.id == request.classId { closeClass() }
                    await monitorClassGeneration(client: client, course: course, observationId: observation.id)
                } else if isCurrentLearningClient(client),
                          classGenerationObservations[course.id] == nil || classGenerationObservations[course.id]?.id == observation.id {
                    classGenerationTasks[course.id] = nil
                }
            } catch {
                guard observationIsOwned(previous.id, courseId: course.id, client: client) else { return }
                stopClassObservation(courseId: course.id, message: error.localizedDescription)
                classGenerationTasks[course.id] = nil
            }
        }
    }

    func cancelClassGeneration(for courseId: String) async {
        guard let client = makeClient(), let observation = classGenerationObservations[courseId],
              let operationId = observation.operationId, canCancelClassGeneration(for: courseId) else { return }
        do {
            let progress = try await client.fetchClassGenerationProgress(courseId: courseId)
            guard observationIsCurrent(observation.id, courseId: courseId, client: client) else { return }
            guard progress.operationId == operationId else {
                stopClassObservation(courseId: courseId, message: "Preparation changed. Check its status before cancelling.")
                return
            }
            guard ["QUEUED", "RUNNING"].contains(progress.operationStatus ?? "") else { return }
            try await client.cancelClassGeneration(courseId: courseId)
            guard observationIsCurrent(observation.id, courseId: courseId, client: client) else { return }
            classGenerationObservations[courseId]?.operationStatus = "CANCELLING"
            if let course = courses.first(where: { $0.id == courseId }) { checkClassGenerationStatus(for: course) }
        } catch {
            guard observationIsCurrent(observation.id, courseId: courseId, client: client) else { return }
            stopClassObservation(courseId: courseId,
                message: "Cancellation could not be confirmed. Check status before trying again. \(error.localizedDescription)")
        }
    }

    private func beginClassObservation(course: SottoCourse, request: SottoClassGenerationRequest,
                                       admitting: Bool = false) -> SottoClassGenerationObservation {
        var observation = SottoClassGenerationObservation(request: request)
        observation.isAdmitting = admitting
        classGenerationObservations[course.id] = observation
        classGenerationErrors[course.id] = nil
        classGenerationOperations[course.id] = classGenerationOperation(progress: nil, course: course, elapsedSeconds: 0)
        errorMessage = nil
        return observation
    }

    private func admitClassGeneration(client: SottoAPIClient, course: SottoCourse,
                                      observation: SottoClassGenerationObservation) async -> Bool {
        do {
            let accepted: NextClassBackgroundResponse
            switch observation.request {
            case let .next(source):
                accepted = try await client.startNextClassGeneration(courseId: course.id, source: source)
            case let .regenerate(classId, attempt):
                accepted = try await client.startClassRegeneration(classId: classId, expectedAttempt: attempt)
            case .observe: return false
            }
            guard observationIsOwned(observation.id, courseId: course.id, client: client) else { return false }
            let courseMatches: Bool
            switch observation.request {
            case .next: courseMatches = accepted.courseId == nil || accepted.courseId == course.id
            case .regenerate: courseMatches = accepted.courseId == course.id
            case .observe: return false
            }
            guard accepted.started, courseMatches,
                  let operationId = accepted.operationId, !operationId.isEmpty else {
                throw SottoAPIError.message("The server did not identify the admitted preparation.")
            }
            classGenerationObservations[course.id]?.operationId = operationId
            classGenerationObservations[course.id]?.isAdmitting = false
            return !Task.isCancelled
        } catch {
            guard observationIsOwned(observation.id, courseId: course.id, client: client) else { return false }
            if case let SottoAPIError.http(status, _) = error, (400..<500).contains(status) {
                classGenerationObservations[course.id] = nil
                stopClassObservation(courseId: course.id, message: error.localizedDescription)
                if !Task.isCancelled { report(error) }
            } else {
                classGenerationObservations[course.id]?.isAdmitting = false
                classGenerationObservations[course.id]?.admissionUnconfirmed = true
                stopClassObservation(courseId: course.id,
                    message: "The preparation request could not be confirmed. Check status; do not submit it again. \(error.localizedDescription)")
                if !Task.isCancelled, classGenerationAdmissionId == observation.id,
                   selectedClass?.id == observation.request.classId { closeClass() }
            }
            return false
        }
    }

    private func startClassObservationTask(client: SottoAPIClient, course: SottoCourse) {
        guard classGenerationTasks[course.id] == nil,
              let observation = classGenerationObservations[course.id], !observation.isAdmitting else { return }
        classGenerationTasks[course.id] = Task { [weak self] in
            await self?.monitorClassGeneration(client: client, course: course, observationId: observation.id)
        }
    }

    private func monitorClassGeneration(client: SottoAPIClient, course: SottoCourse, observationId: UUID) async {
        defer {
            if classGenerationObservations[course.id]?.id == observationId || classGenerationObservations[course.id] == nil {
                classGenerationTasks[course.id] = nil
            }
        }
        while observationIsCurrent(observationId, courseId: course.id, client: client) {
            do {
                let progress = try await client.fetchClassGenerationProgress(courseId: course.id)
                guard observationIsCurrent(observationId, courseId: course.id, client: client),
                      var observation = classGenerationObservations[course.id] else { return }
                if observation.admissionUnconfirmed {
                    classGenerationObservations[course.id]?.explicitlyRechecking = false
                    await loadCourses(showLoading: false)
                    guard observationIsCurrent(observationId, courseId: course.id, client: client) else { return }
                    if observation.explicitlyRechecking,
                       ["COMPLETED", "FAILED", "CANCELLED"].contains(progress.operationStatus ?? ""),
                       let classId = observation.request.classId ?? progress.classId {
                        let detail = try await client.fetchClass(classId: classId)
                        guard observationIsCurrent(observationId, courseId: course.id, client: client) else { return }
                        let confirmed = try await client.fetchClassGenerationProgress(courseId: course.id)
                        guard observationIsCurrent(observationId, courseId: course.id, client: client) else { return }
                        let retainedAttempt: Bool
                        switch observation.request {
                        case let .regenerate(expectedId, previousAttempt):
                            retainedAttempt = detail.id == expectedId && (detail.attempt ?? 1) >= previousAttempt
                        case .next, .observe: retainedAttempt = observation.request.accepts(detail)
                        }
                        if retainedAttempt, detail.id == classId, detail.courseId == course.id, detail.status != "GENERATING",
                           (detail.submitted || classPresentationIssues(detail).isEmpty),
                           confirmed.operationId == progress.operationId,
                           confirmed.classId == progress.classId,
                           confirmed.operationStatus == progress.operationStatus {
                            classGenerationObservations[course.id] = nil
                            stopClassObservation(courseId: course.id,
                                message: "The current preparation is settled. Resume the current class. The original request outcome was not confirmed.")
                            return
                        }
                    }
                    stopClassObservation(courseId: course.id,
                        message: "The original request remains unconfirmed. Current server status: \(progress.status). Resume the current class when ready; no new request has been sent.")
                    return
                }
                if observation.operationId == nil {
                    guard progress.classId == observation.request.classId, let operationId = progress.operationId else {
                        stopClassObservation(courseId: course.id, message: "Preparation could not be identified. Reload the course before continuing.")
                        return
                    }
                    observation.operationId = operationId
                }
                guard progress.operationId == observation.operationId,
                      observation.request.classId == nil || progress.classId == observation.request.classId else {
                    stopClassObservation(courseId: course.id, message: "Preparation changed. Your previous work is retained. Check the current class.")
                    return
                }
                observation.operationStatus = progress.operationStatus
                classGenerationObservations[course.id] = observation
                classGenerationOperations[course.id] = classGenerationOperation(progress: progress, course: course,
                    elapsedSeconds: Int(Date().timeIntervalSince(observation.startedAt)))
                classGenerationErrors[course.id] = nil
                switch progress.operationStatus {
                case "QUEUED", "RUNNING", "CANCELLING": break
                case "FAILED", "CANCELLED", "UNRESOLVED":
                    stopClassObservation(courseId: course.id, message: "\(progress.operationStatus!): \(progress.detail) Your previous work is retained.")
                    return
                case "COMPLETED":
                    if progress.result != "done" {
                        guard let classId = progress.classId else {
                            stopClassObservation(courseId: course.id, message: "Completed preparation has no class to open. Check status.")
                            return
                        }
                        let detail = try await client.fetchClass(classId: classId)
                        guard observationIsCurrent(observationId, courseId: course.id, client: client) else { return }
                        guard detail.courseId == course.id, detail.id == classId, observation.request.accepts(detail) else {
                            stopClassObservation(courseId: course.id, message: "The class attempt changed. Your previous work is retained. Reload the course.")
                            return
                        }
                        let issues = detail.submitted ? [] : classPresentationIssues(detail)
                        if detail.status == "GENERATING" || isClassPresentationStillRendering(detail) { break }
                        guard detail.status != "FAILED", issues.isEmpty else {
                            stopClassObservation(courseId: course.id, message: "The prepared class is not ready to open. \(issues.joined(separator: " "))")
                            return
                        }
                        let confirmed = try await client.fetchClassGenerationProgress(courseId: course.id)
                        guard observationIsCurrent(observationId, courseId: course.id, client: client) else { return }
                        guard confirmed.operationId == observation.operationId, confirmed.operationStatus == "COMPLETED",
                              confirmed.classId == classId else {
                            stopClassObservation(courseId: course.id, message: "Preparation changed before the class could be opened. Check status.")
                            return
                        }
                    }
                    await loadCourses(showLoading: false)
                    guard observationIsCurrent(observationId, courseId: course.id, client: client) else { return }
                    classGenerationErrors[course.id] = nil
                    classGenerationOperations[course.id] = nil
                    classGenerationObservations[course.id] = nil
                    refreshAgentUsageInBackground()
                    return
                default:
                    stopClassObservation(courseId: course.id, message: "The server did not return a durable preparation status. Check status before continuing.")
                    return
                }
            } catch {
                guard observationIsCurrent(observationId, courseId: course.id, client: client),
                      let observation = classGenerationObservations[course.id] else { return }
                if case let SottoAPIError.http(status, _) = error, [401, 403, 404].contains(status) {
                    stopClassObservation(courseId: course.id, message: error.localizedDescription)
                    return
                }
                classGenerationOperations[course.id] = classGenerationOperation(progress: nil, course: course,
                    elapsedSeconds: Int(Date().timeIntervalSince(observation.startedAt)),
                    previous: classGenerationOperations[course.id])
            }
            do { try await Task.sleep(for: .milliseconds(1500)) }
            catch { return }
        }
    }

    private func observationIsCurrent(_ id: UUID, courseId: String, client: SottoAPIClient) -> Bool {
        !Task.isCancelled && observationIsOwned(id, courseId: courseId, client: client)
    }

    private func observationIsOwned(_ id: UUID, courseId: String, client: SottoAPIClient) -> Bool {
        isCurrentLearningClient(client) && courses.contains(where: { $0.id == courseId }) &&
            classGenerationObservations[courseId]?.id == id
    }

    private func stopClassObservation(courseId: String, message: String) {
        classGenerationOperations[courseId] = nil
        classGenerationErrors[courseId] = message
    }

    private func classGenerationOperation(progress: SottoGenerationProgress?, course: SottoCourse,
                                           elapsedSeconds: Int, previous: SottoLoadingOperation? = nil) -> SottoLoadingOperation {
        if let progress {
            return progress.loadingOperation(title: progress.lessonTitle.map { "Preparing \($0)" } ?? "Preparing class",
                elapsedSeconds: elapsedSeconds)
        }
        if let previous { return previous.progressUnavailable(elapsedSeconds: elapsedSeconds) }
        return SottoLoadingOperation(title: "Preparing \(course.curriculum?.title ?? "class")",
            detail: "Contacting your Sotto server and preparing the lesson plan.", progress: nil,
            currentStep: nil, totalSteps: nil, elapsedSeconds: elapsedSeconds, remainingSeconds: nil,
            activity: "Waiting for a progress report from the server.")
    }
}
