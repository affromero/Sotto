import Foundation

extension SottoAppModel {
    func fetchClassLessonHelp(classId: String) async throws -> SottoClassLessonHelpResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to load language help.") }
        let response = try await client.fetchClassLessonHelp(classId: classId)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return response
    }

    func startClassLessonHelp(classId: String, request: SottoClassLessonHelpRequest) async throws -> SottoClassLessonHelpResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to prepare language help.") }
        let response = try await client.startClassLessonHelp(classId: classId, request: request)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return response
    }
}
