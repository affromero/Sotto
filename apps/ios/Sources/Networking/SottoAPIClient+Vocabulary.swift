import Foundation

extension SottoAPIClient {
    func startVocabularyStudy(courseId: String, requestId: UUID, mode: SottoVocabularyMode, wordIds: [String] = []) async throws -> SottoPracticeStart {
        try await post("/api/v1/courses/\(courseId)/vocabulary/study",
            body: SottoVocabularyAdmission(requestId: requestId.uuidString.lowercased(), mode: mode, wordIds: wordIds.isEmpty ? nil : wordIds))
    }

    func vocabularyDictionary(courseId: String, search: String, state: String, page: Int) async throws -> SottoDictionary {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "search", value: search), URLQueryItem(name: "state", value: state), URLQueryItem(name: "page", value: String(page))]
        return try await get("/api/v1/courses/\(courseId)/vocabulary?\(query.percentEncodedQuery ?? "")")
    }

    func saveVocabularyMeaning(courseId: String, wordId: String, meaning: SottoVocabularyMeaning) async throws {
        let result: SottoVocabularySaved = try await patch("/api/v1/courses/\(courseId)/vocabulary/\(wordId)", body: meaning)
        guard result.saved else { throw SottoAPIError.message("Your meanings were not saved.") }
    }

    func indexVocabulary(materialId: String, retry: Bool) async throws {
        let _: SottoVocabularyImportResult = try await post("/api/v1/materials/\(materialId)/vocabulary-index",
            body: SottoVocabularyAudioRequest(retry: retry), acceptedStatuses: [200, 202])
    }

    func saveVocabularySupport(courseId: String, support: String?) async throws {
        let _: SottoVocabularySupport = try await patch("/api/v1/courses/\(courseId)/vocabulary-support", body: SottoVocabularySupport(vocabularySupport: support))
    }

    func vocabularyAction(sessionId: String, action: SottoVocabularyAction) async throws -> SottoPracticeStart {
        try await post("/api/v1/practice/\(sessionId)/vocabulary", body: action)
    }

    func prepareVocabularyAudio(path: String, retry: Bool) async throws -> SottoVocabularyAudioStatus {
        try await post(path, body: SottoVocabularyAudioRequest(retry: retry), acceptedStatuses: [200, 202])
    }

    func vocabularyExamples(path: String) async throws -> SottoVocabularyExamplesResponse {
        try await get(path)
    }

    func prepareVocabularyExamples(path: String, request: SottoVocabularyExamplesRequest) async throws -> SottoVocabularyExamplesResponse {
        try await post(path, body: request, acceptedStatuses: [200, 202])
    }

    func vocabularyRefill(courseId: String, sessionId: String?) async throws -> SottoVocabularyRefillResponse {
        var query = URLComponents()
        if let sessionId { query.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)] }
        let suffix = query.percentEncodedQuery.map { "?\($0)" } ?? ""
        return try await get("/api/v1/courses/\(courseId)/vocabulary/refill\(suffix)")
    }

    func prepareVocabularyRefill(courseId: String, request: SottoVocabularyRefillRequest) async throws -> SottoVocabularyRefillResponse {
        try await post("/api/v1/courses/\(courseId)/vocabulary/refill", body: request, acceptedStatuses: [200, 202])
    }
}
