import Foundation

extension SottoAppModel {
    func fetchClassPrerequisite(classId: String) async throws -> SottoClassPrerequisiteResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to load the class explanation.") }
        let response = try await client.fetchClassPrerequisite(classId: classId)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return response
    }

    func startClassPrerequisite(classId: String, request: SottoClassPrerequisiteRequest) async throws -> SottoClassPrerequisiteResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to prepare the class explanation.") }
        let response = try await client.startClassPrerequisite(classId: classId, request: request)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return response
    }

    func acknowledgeClassPrerequisite(classId: String, request: SottoClassPrerequisiteAcknowledgment) async throws -> SottoClassPrerequisiteResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to continue the class.") }
        let response = try await client.acknowledgeClassPrerequisite(classId: classId, request: request)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return response
    }
}
