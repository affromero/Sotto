import Foundation

struct SottoFailedClassRemoval: Identifiable {
    let id: UUID
    let client: SottoAPIClient
    let courseId: String
    let classId: String
    let operationId: String
    let request: SottoClassGenerationRequest
}

extension SottoAppModel {
    func failedClassRemoval(for course: SottoCourse) -> SottoFailedClassRemoval? {
        guard let client = makeClient(), courses.contains(where: { $0.id == course.id }),
              let observation = classGenerationObservations[course.id],
              !observation.isAdmitting, classGenerationTasks[course.id] == nil,
              classGenerationRetryTitle(for: course.id) != nil,
              let operationId = observation.operationId,
              let classId = observation.request.classId ?? observation.observedClassId,
              course.activeClassId == classId ||
              (course.activeClassId == nil && observation.observedClassId == classId) else { return nil }
        return SottoFailedClassRemoval(id: observation.id, client: client,
            courseId: course.id, classId: classId, operationId: operationId, request: observation.request)
    }

    private func removalIsCurrent(_ target: SottoFailedClassRemoval) -> Bool {
        guard !Task.isCancelled, isCurrentLearningClient(target.client),
              let course = courses.first(where: { $0.id == target.courseId }),
              let current = failedClassRemoval(for: course) else { return false }
        return current.id == target.id && current.classId == target.classId &&
            current.operationId == target.operationId
    }

    @discardableResult
    func removeFailedClass(_ target: SottoFailedClassRemoval) async -> Bool {
        guard removalIsCurrent(target) else { return false }
        return await removeClass(classId: target.classId, courseId: target.courseId,
            client: target.client, progress: nil, stillCurrent: { self.removalIsCurrent(target) }) {
            let operation = try await target.client.fetchClassGenerationProgress(courseId: target.courseId)
            guard self.removalIsCurrent(target) else { throw CancellationError() }
            guard operation.operationId == target.operationId, operation.classId == target.classId,
                  ["FAILED", "CANCELLED"].contains(operation.operationStatus ?? "") else {
                throw SottoAPIError.message("Preparation changed. Check status before removing a class.")
            }
            let detail = try await target.client.fetchClass(classId: target.classId)
            guard self.removalIsCurrent(target) else { throw CancellationError() }
            guard detail.id == target.classId, detail.courseId == target.courseId,
                  detail.status != "GENERATING", detail.status != "PASSED", !detail.submitted,
                  target.request.accepts(detail) else {
                throw SottoAPIError.message("The class changed. Reload before removing it.")
            }
            return detail
        }
    }

    @discardableResult
    func deleteSelectedClass(classId: String, progress: LearningProgressStore? = nil) async -> Bool {
        guard !Task.isCancelled, let client = makeClient(), let selectedClass,
              selectedClass.id == classId else { return false }
        return await removeClass(classId: classId, courseId: selectedClass.courseId,
            client: client, progress: progress, stillCurrent: { self.selectedClass?.id == classId }) {
            selectedClass
        }
    }

    private func removeClass(classId: String, courseId: String, client: SottoAPIClient,
        progress: LearningProgressStore?, stillCurrent: () -> Bool,
        prepare: () async throws -> SottoClassDetail) async -> Bool {
        let removalId = UUID()
        classRemovalId = removalId
        isLoading = true
        loadingOperation = SottoLoadingOperation(title: "Removing class",
            detail: "Clearing the active class so a new one can be generated.",
            progress: nil, currentStep: nil, totalSteps: nil, elapsedSeconds: nil, remainingSeconds: nil)
        errorMessage = nil
        defer {
            if classRemovalId == removalId, isCurrentLearningClient(client) {
                classRemovalId = nil
                loadingOperation = nil
                isLoading = false
            }
        }
        var writer = progress
        do {
            let detail = try await prepare()
            guard !Task.isCancelled, isCurrentLearningClient(client), stillCurrent() else { return false }
            if writer == nil {
                writer = learningSessionState(path: "/api/v1/classes/\(classId)",
                    attempt: detail.attempt ?? 1, revision: detail.progressRevision ?? 0).progress
            }
            await writer?.suspend()
            guard !Task.isCancelled, isCurrentLearningClient(client), stillCurrent() else {
                writer?.resume()
                return false
            }
            try await client.deleteClass(classId: classId)
            writer?.discard()
            guard isCurrentLearningClient(client) else { return true }
            finishClassRemoval(classId: classId, courseId: courseId)
            await loadCourses(showLoading: false)
            return true
        } catch {
            writer?.resume()
            if !Task.isCancelled, isCurrentLearningClient(client), !(error is CancellationError) { report(error) }
            return false
        }
    }

    private func finishClassRemoval(classId: String, courseId: String) {
        if let observation = classGenerationObservations[courseId],
           observation.request.classId == classId || observation.observedClassId == classId ||
           (observation.request.classId == nil && courses.first(where: { $0.id == courseId })?.activeClassId == classId) {
            classGenerationTasks.removeValue(forKey: courseId)?.cancel()
            classGenerationObservations[courseId] = nil
            classGenerationOperations[courseId] = nil
            classGenerationErrors[courseId] = nil
        }
        if selectedClass?.id == classId { closeClass() }
        applyCourseRefresh(courses.map { course in
            var remaining = course
            remaining.classes.removeAll { $0.id == classId }
            if remaining.activeClassId == classId { remaining.activeClassId = nil }
            return remaining
        })
    }
}
