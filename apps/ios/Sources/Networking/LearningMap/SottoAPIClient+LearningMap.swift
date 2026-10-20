import Foundation

extension SottoAPIClient {
    func fetchLearningMap(courseId: String, level: SottoLearningLevel? = nil) async throws -> SottoLearningMap {
        let query = level.map { "?level=\($0.rawValue)" } ?? ""
        let map: SottoLearningMap = try await get("/api/v1/courses/\(courseId)/learning-map\(query)")
        try map.validate(courseId: courseId, level: level)
        return map
    }

    func previewLearningSelection(courseId: String, selection: SottoLearningSelection) async throws -> SottoLearningSelectionPreview {
        let preview: SottoLearningSelectionPreview
        do { preview = try await post("/api/v1/courses/\(courseId)/learning-map/selection", body: selection) }
        catch { throw SottoLearningMapFailure.normalized(error) }
        guard preview.selection.level == selection.level,
              (selection.catalogVersion == nil || preview.selection.catalogVersion == selection.catalogVersion),
              preview.selection.materialFocusId == selection.materialFocusId,
              !preview.availableKinds.isEmpty,
              preview.availableKinds.allSatisfy({ ["FULL", "GRAMMAR", "READING", "LISTENING", "SPEAKING", "WRITING"].contains($0) }),
              (selection.nodeIds.isEmpty ? preview.selection.objectives.isEmpty : !preview.selection.objectives.isEmpty),
              preview.selection.objectives.count <= 4,
              preview.selection.objectives.allSatisfy({ $0.level == selection.level }) else {
            throw SottoAPIError.message("The selected practice receipt changed. Reload its objectives.")
        }
        return preview
    }

    func advanceLearningLevel(courseId: String, request: SottoLearningAdvanceRequest) async throws -> SottoLearningCompletion {
        let receipt: SottoLearningCompletion = try await post("/api/v1/courses/\(courseId)/learning-map/advance", body: request)
        let levels = SottoLearningLevel.allCases
        let index = levels.firstIndex(of: request.expectedLevel)!
        let next = index + 1 < levels.count ? levels[index + 1] : nil
        guard receipt.completed, receipt.courseId == courseId, receipt.level == request.expectedLevel,
              receipt.nextLevel == next, receipt.currentLevel == (next ?? request.expectedLevel) else {
            throw SottoAPIError.message("The level completion receipt changed. Refresh the course.")
        }
        return receipt
    }
}

enum SottoLearningMapFailure {
    static func normalized(_ error: Error) -> Error {
        let raw = error.localizedDescription.lowercased()
        if ["api key", "api_key", "byok", "not configured", "no provider"].contains(where: raw.contains) {
            return SottoAPIError.message("Set up the practice providers on your Sotto web app before starting this format.")
        }
        return error
    }
}
