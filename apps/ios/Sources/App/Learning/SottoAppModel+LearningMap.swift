import Foundation

extension SottoAppModel {
    func learningMap(courseId: String, level: SottoLearningLevel?) async throws -> SottoLearningMap {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to open the learning map.") }
        let result = try await client.fetchLearningMap(courseId: courseId, level: level)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return result
    }

    func previewLearningSelection(courseId: String, selection: SottoLearningSelection) async throws -> SottoLearningSelectionPreview {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to choose practice.") }
        let result = try await client.previewLearningSelection(courseId: courseId, selection: selection)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return result
    }

    func advanceLearningLevel(courseId: String, request: SottoLearningAdvanceRequest) async throws {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to complete a level.") }
        _ = try await client.advanceLearningLevel(courseId: courseId, request: request)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        await loadCourses(showLoading: false)
    }
}
