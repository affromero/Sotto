import Foundation

extension SottoAPIClient {
    func fetchClassLessonHelp(classId: String) async throws -> SottoClassLessonHelpResponse {
        var request = try makeRequest(path: "/api/v1/classes/\(classId)/lesson-help", method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        do { return try await send(request, acceptedStatuses: [200]) }
        catch { throw SottoClassLessonHelpFailure.normalized(error) }
    }

    func startClassLessonHelp(classId: String, request: SottoClassLessonHelpRequest) async throws -> SottoClassLessonHelpResponse {
        do { return try await post("/api/v1/classes/\(classId)/lesson-help", body: request, acceptedStatuses: [200, 202]) }
        catch { throw SottoClassLessonHelpFailure.normalized(error) }
    }
}

enum SottoClassLessonHelpFailure {
    static func normalizedMessage(_ message: String) -> String? {
        let raw = message.lowercased()
        guard ["api key", "api_key", "byok", "not configured", "no provider"].contains(where: raw.contains) else { return nil }
        return "Set up the language help provider on your Sotto web app, then try again."
    }

    static func normalized(_ error: Error) -> Error {
        guard let message = normalizedMessage(error.localizedDescription) else { return error }
        return SottoAPIError.message(message)
    }
}
