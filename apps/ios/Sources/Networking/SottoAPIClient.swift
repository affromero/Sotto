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
            acceptedStatuses: [200, 201, 409],
            timeout: SottoAPIClient.generationTimeout
        )

        if let classId = response.classId ?? response.activeClassId {
            return classId
        }

        if response.done == true {
            throw SottoAPIError.message("This course is complete.")
        }

        throw SottoAPIError.message("Sotto did not return a class to open.")
    }

    func startNextClassGeneration(
        courseId: String,
        source: SottoClassGenerationSource = .curriculum
    ) async throws {
        let _: NextClassBackgroundResponse = try await post(
            "/api/v1/courses/\(courseId)/next-class?background=1",
            body: NextClassGenerationRequest(source: source),
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
            acceptedStatuses: [200],
            timeout: SottoAPIClient.generationTimeout
        )
    }

    func startClassRegeneration(classId: String) async throws {
        let _: NextClassBackgroundResponse = try await post(
            "/api/v1/classes/\(classId)?background=1",
            body: RegenerateClassRequest(scope: "class"),
            acceptedStatuses: [202]
        )
    }

    func deleteClass(classId: String) async throws {
        let _: DeleteClassResponse = try await delete("/api/v1/classes/\(classId)")
    }

    func startPractice(courseId: String, kind: String) async throws -> SottoPracticeStart {
        // The server builds a script and its audio here; the web client warns
        // this runs one to three minutes.
        try await post(
            "/api/v1/courses/\(courseId)/practice",
            body: StartPracticeRequest(kind: kind),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    func fetchCourseTopics(courseId: String) async throws -> [SottoTopicSuggestion] {
        let response: SottoCourseTopicsResponse = try await get("/api/v1/courses/\(courseId)/topics")
        return response.topics
    }

    func fetchCourseNotes(courseId: String) async throws -> SottoCourseNotesResponse {
        try await get("/api/v1/courses/\(courseId)/notes")
    }

    func saveCourseNotes(courseId: String, body: String) async throws -> SottoCourseNotesResponse {
        try await put("/api/v1/courses/\(courseId)/notes", body: CourseNotesRequest(body: body))
    }

    func updateCoursePedagogy(
        courseId: String,
        pedagogy: SottoPedagogyStyle
    ) async throws -> SottoPedagogyStyle {
        let response: SottoCoursePedagogyResponse = try await patch(
            "/api/v1/courses/\(courseId)/pedagogy",
            body: CoursePedagogyRequest(pedagogy: pedagogy)
        )
        return response.pedagogy
    }

    func submitPractice(sessionId: String, answers: [SottoPracticeAnswer]) async throws -> SottoPracticeSubmitResult {
        try await post(
            "/api/v1/practice/\(sessionId)/submit",
            body: SubmitPracticeRequest(answers: answers),
            timeout: SottoAPIClient.generationTimeout
        )
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
        try await uploadSpeakingRecording(
            path: "/api/v1/classes/\(classId)/speaking/\(promptId)",
            audioURL: audioURL
        )
    }

    func pollClassSpeakingRecording(
        classId: String,
        promptId: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        try await pollSpeakingRecording(
            path: "/api/v1/classes/\(classId)/speaking/\(promptId)",
            recordingId: recordingId
        )
    }

    /// Class, practice, and exam speaking all upload to their own path and then
    /// poll the same path for the grade, so the transport lives here once.
    private func uploadSpeakingRecording(
        path: String,
        audioURL: URL
    ) async throws -> SottoSpeakingUploadResponse {
        var request = try makeRequest(
            path: path,
            method: "POST",
            authorized: true,
            timeout: SottoAPIClient.generationTimeout
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

    private func pollSpeakingRecording(
        path: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        let encodedRecordingId =
            recordingId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? recordingId
        return try await get("\(path)?recordingId=\(encodedRecordingId)")
    }

    // MARK: - Placement

    /// Generates the adaptive question batch, so this runs against a model.
    func fetchPlacement(native: String, target: String) async throws -> SottoPlacementBatch {
        try await get(
            "/api/v1/placement?native=\(native)&target=\(target)",
            timeout: SottoAPIClient.generationTimeout
        )
    }

    func submitPlacement(
        native: String,
        target: String,
        answers: [SottoPlacementAnswer]
    ) async throws -> SottoPlacementResult {
        try await post(
            "/api/v1/placement",
            body: SubmitPlacementRequest(native: native, target: target, answers: answers),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    /// Declaring a level skips the test but still creates the course, which
    /// builds a curriculum on the server, so it gets the long timeout too.
    func submitManualPlacement(
        native: String,
        target: String,
        level: String
    ) async throws -> SottoManualPlacementResult {
        try await post(
            "/api/v1/placement/manual",
            body: ManualPlacementRequest(native: native, target: target, level: level),
            acceptedStatuses: [200, 201],
            timeout: SottoAPIClient.generationTimeout
        )
    }

    // MARK: - Mock exams

    func fetchCourseExams(courseId: String) async throws -> SottoCourseExams {
        try await get("/api/v1/courses/\(courseId)/exams")
    }

    /// Builds every section up front, so this is one of the long calls.
    func startExam(courseId: String, level: String?) async throws -> String {
        let response: SottoExamStartResponse = try await post(
            "/api/v1/exams",
            body: StartExamRequest(courseId: courseId, level: level),
            timeout: SottoAPIClient.generationTimeout
        )
        return response.examId
    }

    func fetchExam(examId: String) async throws -> SottoExamDetail {
        try await get("/api/v1/exams/\(examId)")
    }

    /// Carries the multiple-choice answers only. Speaking and writing are
    /// graded through their own routes before this runs, and the server folds
    /// those scores in.
    func submitExam(examId: String, answers: [SottoSubmitAnswer]) async throws -> SottoExamScoreResult {
        try await post(
            "/api/v1/exams/\(examId)/submit",
            body: SubmitClassRequest(answers: answers),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    func uploadExamSpeakingRecording(
        examId: String,
        promptId: String,
        audioURL: URL
    ) async throws -> SottoSpeakingUploadResponse {
        try await uploadSpeakingRecording(
            path: "/api/v1/exams/\(examId)/speaking/\(promptId)",
            audioURL: audioURL
        )
    }

    func pollExamSpeakingRecording(
        examId: String,
        promptId: String,
        recordingId: String
    ) async throws -> SottoSpeakingPollResponse {
        try await pollSpeakingRecording(
            path: "/api/v1/exams/\(examId)/speaking/\(promptId)",
            recordingId: recordingId
        )
    }

    func submitExamWriting(
        examId: String,
        promptId: String,
        text: String
    ) async throws -> SottoWritingGrade {
        try await post(
            "/api/v1/exams/\(examId)/writing/\(promptId)",
            body: WritingSubmissionRequest(text: text),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    /// Writing is graded in the POST itself (one LLM call), unlike speaking,
    /// which uploads and then polls.
    func submitClassWriting(
        classId: String,
        promptId: String,
        text: String
    ) async throws -> SottoWritingGrade {
        try await post(
            "/api/v1/classes/\(classId)/writing/\(promptId)",
            body: WritingSubmissionRequest(text: text),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    func submitPracticeWriting(
        sessionId: String,
        promptId: String,
        text: String
    ) async throws -> SottoWritingGrade {
        try await post(
            "/api/v1/practice/\(sessionId)/writing/\(promptId)",
            body: WritingSubmissionRequest(text: text),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    func submitClass(classId: String, answers: [SottoSubmitAnswer]) async throws -> SottoClassSubmitResult {
        try await post(
            "/api/v1/classes/\(classId)/submit",
            body: SubmitClassRequest(answers: answers),
            timeout: SottoAPIClient.generationTimeout
        )
    }

    private func get<Response: Decodable>(
        _ path: String,
        timeout: TimeInterval = SottoAPIClient.defaultTimeout
    ) async throws -> Response {
        let request = try makeRequest(path: path, method: "GET", authorized: true, timeout: timeout)
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
        acceptedStatuses: Set<Int> = [200, 201],
        timeout: TimeInterval = SottoAPIClient.defaultTimeout
    ) async throws -> Response {
        var request = try makeRequest(
            path: path,
            method: "POST",
            authorized: authorized,
            timeout: timeout
        )
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, acceptedStatuses: acceptedStatuses)
    }

    private func put<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body,
        authorized: Bool = true,
        acceptedStatuses: Set<Int> = [200]
    ) async throws -> Response {
        var request = try makeRequest(path: path, method: "PUT", authorized: authorized)
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, acceptedStatuses: acceptedStatuses)
    }

    private func patch<Body: Encodable, Response: Decodable>(
        _ path: String,
        body: Body,
        authorized: Bool = true,
        acceptedStatuses: Set<Int> = [200]
    ) async throws -> Response {
        var request = try makeRequest(path: path, method: "PATCH", authorized: authorized)
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, acceptedStatuses: acceptedStatuses)
    }

    /// Routes that generate content or call a model server-side. The Next.js
    /// handlers give these `maxDuration = 300`, so the client has to wait that
    /// long too rather than time out on work the server is still doing.
    static let generationTimeout: TimeInterval = 300
    static let defaultTimeout: TimeInterval = 60

    private func makeRequest(
        path: String,
        method: String,
        authorized: Bool,
        timeout: TimeInterval = SottoAPIClient.defaultTimeout
    ) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: serverURL)?.absoluteURL else {
            throw SottoAPIError.message("Invalid Sotto URL.")
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
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
            throw SottoAPIError.message("Sotto returned data this app could not read. \(Self.describeDecodingError(error))")
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

private struct NextClassGenerationRequest: Encodable {
    let sourceUrl: String?
    let topic: String?

    init(source: SottoClassGenerationSource) {
        switch source {
        case .curriculum:
            sourceUrl = nil
            topic = nil
        case let .sourceUrl(value):
            sourceUrl = value
            topic = nil
        case let .topic(value):
            sourceUrl = nil
            topic = value
        }
    }
}

private struct CourseNotesRequest: Encodable {
    let body: String
}

private struct CoursePedagogyRequest: Encodable {
    let pedagogy: SottoPedagogyStyle
}

private struct SubmitPracticeRequest: Encodable {
    let answers: [SottoPracticeAnswer]
}

private struct SubmitClassRequest: Encodable {
    let answers: [SottoSubmitAnswer]
}

private struct WritingSubmissionRequest: Encodable {
    let text: String
}

private struct SubmitPlacementRequest: Encodable {
    let native: String
    let target: String
    let answers: [SottoPlacementAnswer]
}

private struct ManualPlacementRequest: Encodable {
    let native: String
    let target: String
    let level: String
}

private struct StartExamRequest: Encodable {
    let courseId: String
    let level: String?
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
