import Foundation

struct SottoAPIClient {
    let serverURL: URL
    let apiKey: String?
    let profileId: String?

    init(serverURL: URL, apiKey: String?, profileId: String? = nil) {
        self.serverURL = serverURL
        self.apiKey = apiKey
        self.profileId = profileId
    }

    func redeemPairingToken(_ token: String) async throws -> PairingRedeemResponse {
        try await post(
            "/api/v1/auth/pair/redeem",
            body: PairingRedeemRequest(token: token),
            authorized: false
        )
    }

    func listProfiles() async throws -> [SottoProfile] {
        let response: SottoProfileListResponse = try await get("/api/v1/profiles")
        return response.profiles
    }

    func createProfile(name: String, avatarSlug: String?) async throws -> SottoProfile {
        try await post(
            "/api/v1/profiles",
            body: CreateProfileRequest(name: name, avatarSlug: avatarSlug)
        )
    }

    func listCourses() async throws -> [SottoCourse] {
        let response: SottoCourseListResponse = try await get("/api/v1/courses")
        return response.courses
    }

    func fetchAgentUsage() async throws -> SottoAgentUsageStatus {
        try await get("/api/v1/agent-usage")
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

    func startNextClassGeneration(courseId: String) async throws {
        let _: NextClassBackgroundResponse = try await post(
            "/api/v1/courses/\(courseId)/next-class?background=1",
            body: EmptyBody(),
            acceptedStatuses: [202]
        )
    }

    func fetchClassGenerationProgress(courseId: String) async throws -> SottoGenerationProgress {
        try await get("/api/v1/courses/\(courseId)/generation")
    }

    func cancelClassGeneration(courseId: String) async throws {
        let _: ClassGenerationCancelResponse = try await delete("/api/v1/courses/\(courseId)/generation")
    }

    func fetchClass(classId: String) async throws -> SottoClassDetail {
        try await get("/api/v1/classes/\(classId)")
    }

    func regenerateClass(classId: String) async throws {
        let _: ClassRegenerationResponse = try await post(
            "/api/v1/classes/\(classId)",
            body: RegenerateClassRequest(scope: "class"),
            acceptedStatuses: [200]
        )
    }

    func deleteClass(classId: String) async throws {
        let _: DeleteClassResponse = try await delete("/api/v1/classes/\(classId)")
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

    func fetchSelectionHelp(
        courseId: String,
        text: String,
        contextText: String?
    ) async throws -> SottoSelectionHelpResponse {
        try await post(
            "/api/v1/courses/\(courseId)/selection-help",
            body: SelectionHelpRequest(text: text, contextText: contextText)
        )
    }

    func uploadClassSpeakingRecording(
        classId: String,
        promptId: String,
        audioURL: URL
    ) async throws -> SottoSpeakingUploadResponse {
        var request = try makeRequest(
            path: "/api/v1/classes/\(classId)/speaking/\(promptId)",
            method: "POST",
            authorized: true
        )
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = try multipartAudioBody(
            audioURL: audioURL,
            boundary: boundary,
            fieldName: "audio",
            fileName: "speaking.wav",
            contentType: "audio/wav"
        )
        return try await send(request, acceptedStatuses: [201])
    }

    func pollClassSpeakingRecording(
        classId: String,
        promptId: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        let encodedRecordingId =
            recordingId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? recordingId
        return try await get(
            "/api/v1/classes/\(classId)/speaking/\(promptId)?recordingId=\(encodedRecordingId)"
        )
    }

    func submitClass(classId: String, answers: [SottoSubmitAnswer]) async throws -> SottoClassSubmitResult {
        try await post("/api/v1/classes/\(classId)/submit", body: SubmitClassRequest(answers: answers))
    }

    private func get<Response: Decodable>(_ path: String) async throws -> Response {
        let request = try makeRequest(path: path, method: "GET", authorized: true)
        return try await send(request, acceptedStatuses: [200])
    }

    private func delete<Response: Decodable>(_ path: String) async throws -> Response {
        let request = try makeRequest(path: path, method: "DELETE", authorized: true)
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
        request.timeoutInterval =
            path.contains("/next-class") || (method == "POST" && path.contains("/api/v1/classes/"))
            ? 300
            : 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if authorized, let apiKey {
            request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
            if let profileId {
                request.setValue(profileId, forHTTPHeaderField: "X-Sotto-Profile-Id")
            }
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

    private func multipartAudioBody(
        audioURL: URL,
        boundary: String,
        fieldName: String,
        fileName: String,
        contentType: String
    ) throws -> Data {
        var body = Data()
        body.appendString("--\(boundary)\r\n")
        body.appendString(
            "Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\n"
        )
        body.appendString("Content-Type: \(contentType)\r\n\r\n")
        body.append(try Data(contentsOf: audioURL))
        body.appendString("\r\n--\(boundary)--\r\n")
        return body
    }
}

private extension Data {
    mutating func appendString(_ value: String) {
        append(Data(value.utf8))
    }
}

private struct PairingRedeemRequest: Encodable {
    let token: String
}

private struct CreateProfileRequest: Encodable {
    let name: String
    let avatarSlug: String?
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

private struct SelectionHelpRequest: Encodable {
    let text: String
    let contextText: String?
}

private struct RegenerateClassRequest: Encodable {
    let scope: String
}

private struct ClassRegenerationResponse: Decodable {
    let regenerated: Bool
}

private struct DeleteClassResponse: Decodable {
    let deleted: Bool
}

private struct EmptyBody: Encodable {}

private struct ClassGenerationCancelResponse: Decodable {
    let cancelled: Bool
}

enum SottoAPIError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case let .message(value):
            value
        }
    }
}
