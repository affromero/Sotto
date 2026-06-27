import Foundation

struct SottoAPIClient {
    let serverURL: URL
    let apiKey: String?

    func redeemPairingToken(_ token: String) async throws -> PairingRedeemResponse {
        try await post(
            "/api/v1/auth/pair/redeem",
            body: PairingRedeemRequest(token: token),
            authorized: false
        )
    }

    func listCourses() async throws -> [SottoCourse] {
        let response: SottoCourseListResponse = try await get("/api/v1/courses")
        return response.courses
    }

    func createCourse(native: String, target: String) async throws -> SottoCourse {
        let response: SottoCourseCreateResponse = try await post(
            "/api/v1/courses",
            body: CreateCourseRequest(native: native, target: target)
        )
        return response.course
    }

    func startNextClass(courseId: String) async throws -> String {
        let response: NextClassCreatedResponse = try await post(
            "/api/v1/courses/\(courseId)/next-class",
            body: EmptyBody(),
            acceptedStatuses: [200, 201, 409]
        )

        if let classId = response.classId ?? response.activeClassId {
            return classId
        }

        if response.done == true {
            throw SottoAPIError.message("This course is complete.")
        }

        throw SottoAPIError.message("Sotto did not return a class to open.")
    }

    func fetchClassGenerationProgress(courseId: String) async throws -> SottoGenerationProgress {
        try await get("/api/v1/courses/\(courseId)/generation")
    }

    func fetchClass(classId: String) async throws -> SottoClassDetail {
        try await get("/api/v1/classes/\(classId)")
    }

    func startPractice(courseId: String, kind: String) async throws -> SottoPracticeStart {
        try await post("/api/v1/courses/\(courseId)/practice", body: StartPracticeRequest(kind: kind))
    }

    func submitPractice(sessionId: String, answers: [SottoPracticeAnswer]) async throws -> SottoPracticeSubmitResult {
        try await post("/api/v1/practice/\(sessionId)/submit", body: SubmitPracticeRequest(answers: answers))
    }

    func fetchWorksheet(classId: String) async throws -> SottoWorksheetResponse {
        try await get("/api/v1/classes/\(classId)/worksheet")
    }

    func submitClass(classId: String, answers: [SottoSubmitAnswer]) async throws -> SottoClassSubmitResult {
        try await post("/api/v1/classes/\(classId)/submit", body: SubmitClassRequest(answers: answers))
    }

    private func get<Response: Decodable>(_ path: String) async throws -> Response {
        let request = try makeRequest(path: path, method: "GET", authorized: true)
        return try await send(request, acceptedStatuses: [200])
    }

    private func post<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body,
        authorized: Bool = true,
        acceptedStatuses: Set<Int> = [200, 201]
    ) async throws -> Response {
        var request = try makeRequest(path: path, method: "POST", authorized: authorized)
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, acceptedStatuses: acceptedStatuses)
    }

    private func makeRequest(path: String, method: String, authorized: Bool) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: serverURL)?.absoluteURL else {
            throw SottoAPIError.message("Invalid Sotto URL.")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = path.contains("/next-class") ? 300 : 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if authorized, let apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    private func send<Response: Decodable>(
        _ request: URLRequest,
        acceptedStatuses: Set<Int>
    ) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SottoAPIError.message("Sotto returned a non-HTTP response.")
        }

        guard acceptedStatuses.contains(http.statusCode) else {
            if let error = try? JSONDecoder().decode(SottoErrorResponse.self, from: data) {
                throw SottoAPIError.message(error.error.description)
            }
            throw SottoAPIError.message("Sotto returned HTTP \(http.statusCode).")
        }

        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw SottoAPIError.message("Sotto returned data this iPad app could not read. \(Self.describeDecodingError(error))")
        }
    }

    private static func describeDecodingError(_ error: Error) -> String {
        guard case let DecodingError.keyNotFound(key, context) = error else {
            return error.localizedDescription
        }

        let path = (context.codingPath + [key]).map(\.stringValue).joined(separator: ".")
        return path.isEmpty ? "A required field was missing." : "Missing field: \(path)."
    }
}

private struct PairingRedeemRequest: Encodable {
    let token: String
}

private struct StartPracticeRequest: Encodable {
    let kind: String
}

private struct CreateCourseRequest: Encodable {
    let native: String
    let target: String
}

private struct SubmitPracticeRequest: Encodable {
    let answers: [SottoPracticeAnswer]
}

private struct SubmitClassRequest: Encodable {
    let answers: [SottoSubmitAnswer]
}

private struct EmptyBody: Encodable {}

enum SottoAPIError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case let .message(value):
            value
        }
    }
}
