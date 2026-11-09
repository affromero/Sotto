import Foundation

extension SottoAPIClient {
    func fetchClassPrelude(classId: String) async throws -> SottoClassPrelude {
        var request = try makeRequest(path: "/api/v1/classes/\(classId)/teaching-prelude", method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let response: SottoClassPrelude = try await send(request, acceptedStatuses: [200])
        try response.validate()
        return response
    }

    func prepareClassPrelude(classId: String, request: SottoClassPrerequisiteRequest, recovery: Bool) async throws -> SottoClassPrelude {
        let suffix = recovery ? "?recover=1" : ""
        let response: SottoClassPrelude = try await post(
            "/api/v1/classes/\(classId)/teaching-prelude/prepare\(suffix)", body: request, acceptedStatuses: [200, 202]
        )
        try response.validate()
        return response
    }

    func acknowledgeClassPrelude(classId: String, request: SottoClassPreludeAcknowledgment) async throws {
        let response: SottoClassPreludeAcknowledgmentResponse = try await post(
            "/api/v1/classes/\(classId)/teaching-prelude/acknowledge", body: request, acceptedStatuses: [200]
        )
        try response.validate(for: request)
    }

    func fetchClassPrerequisite(classId: String) async throws -> SottoClassPrerequisiteResponse {
        var request = try makeRequest(path: "/api/v1/classes/\(classId)/prerequisite", method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        do { return try await send(request, acceptedStatuses: [200]) }
        catch { throw SottoClassPrerequisiteFailure.normalized(error) }
    }

    func startClassPrerequisite(classId: String, request: SottoClassPrerequisiteRequest) async throws -> SottoClassPrerequisiteResponse {
        do { return try await post("/api/v1/classes/\(classId)/prerequisite", body: request, acceptedStatuses: [200, 202]) }
        catch { throw SottoClassPrerequisiteFailure.normalized(error) }
    }

    func acknowledgeClassPrerequisite(classId: String, request: SottoClassPrerequisiteAcknowledgment) async throws -> SottoClassPrerequisiteResponse {
        do { return try await post("/api/v1/classes/\(classId)/prerequisite/acknowledge", body: request, acceptedStatuses: [200]) }
        catch { throw SottoClassPrerequisiteFailure.normalized(error) }
    }
}

enum SottoClassPrerequisiteFailure {
    static func normalized(_ error: Error) -> Error {
        let raw = error.localizedDescription.lowercased()
        guard ["api key", "api_key", "byok", "not configured", "no provider"].contains(where: raw.contains) else { return error }
        return SottoAPIError.message("Set up the AI provider on your Sotto web app, then try again.")
    }
}
