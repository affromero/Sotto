import CryptoKit
import Foundation

extension SottoAPIClient {
    func fetchClassAssessmentStatus(classId: String, attempt: Int) async throws -> SottoClassAssessmentStatus {
        var request = try makeRequest(path: "/api/v1/classes/\(classId)/assessment/status", method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let response: SottoClassAssessmentStatus = try await send(request, acceptedStatuses: [200])
        try response.validate(expectedAttempt: attempt)
        return response
    }

    func fetchClassAssessment(classId: String, assessmentId: String, attempt: Int) async throws -> SottoClassAssessmentMaterial {
        var request = try makeRequest(path: "/api/v1/classes/\(classId)/assessment/\(assessmentId)", method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let response: SottoClassAssessmentMaterial = try await send(request, acceptedStatuses: [200])
        try response.validate(assessmentId: assessmentId, classAttempt: attempt)
        return response
    }

    func prepareClassAssessment(classId: String, attempt: Int, revision: String) async throws -> SottoClassAssessmentStatus {
        let response: SottoClassAssessmentStatus = try await post(
            "/api/v1/classes/\(classId)/assessment/status",
            body: AssessmentPrepareRequest(classAttempt: attempt, revision: revision),
            acceptedStatuses: [200, 202], timeout: SottoAPIClient.generationTimeout
        )
        try response.validate(expectedAttempt: attempt)
        guard [.pending, .ready].contains(response.status), response.revision == revision else {
            throw SottoAPIError.message("The assessment changed. Check its status again.")
        }
        return response
    }

    func fetchAssessmentWriting(classId: String, assessmentId: String, promptId: String) async throws -> SottoClassAssessmentWritingStatus {
        var request = try makeRequest(path: "/api/v1/classes/\(classId)/assessment/\(assessmentId)/writing/\(promptId)", method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let response: SottoClassAssessmentWritingStatus = try await send(request, acceptedStatuses: [200])
        try response.validate()
        return response
    }

    func saveAssessmentWriting(classId: String, assessmentId: String, promptId: String, text: String) async throws -> SottoClassAssessmentWritingStatus {
        let response: SottoClassAssessmentWritingStatus = try await post(
            "/api/v1/classes/\(classId)/assessment/\(assessmentId)/writing/\(promptId)",
            body: AssessmentWritingRequest(text: text), acceptedStatuses: [200, 202],
            timeout: SottoAPIClient.generationTimeout
        )
        try response.validate()
        guard response.text == text else {
            throw SottoAPIError.message("The saved writing response differs from your draft.")
        }
        return response
    }

    func fetchAssessmentSpeaking(classId: String, assessmentId: String, promptId: String) async throws -> SottoClassAssessmentSpeakingStatus {
        var request = try makeRequest(path: try assessmentSpeakingPath(classId: classId, assessmentId: assessmentId, promptId: promptId), method: "GET", authorized: true)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let response: SottoClassAssessmentSpeakingStatus = try await send(request, acceptedStatuses: [200])
        try response.validate()
        return response
    }

    func uploadAssessmentSpeaking(classId: String, assessmentId: String, promptId: String,
                                  recording: RetainedAssessmentSpeaking) async throws -> SottoClassAssessmentSpeakingStatus {
        let digest = SHA256.hash(data: recording.audio).map { String(format: "%02x", $0) }.joined()
        guard !recording.audio.isEmpty, recording.audio.count <= 8 * 1024 * 1024, digest == recording.sha256 else {
            throw SottoAPIError.message("The saved recording could not be verified.")
        }
        var request = try makeRequest(path: try assessmentSpeakingPath(classId: classId, assessmentId: assessmentId, promptId: promptId),
                                      method: "POST", authorized: true, timeout: SottoAPIClient.generationTimeout)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = multipartBody(data: recording.audio, boundary: boundary, fieldName: "audio",
                                         fileName: "speaking.wav", contentType: "audio/wav",
                                         fields: [("requestId", recording.requestId.uuidString.lowercased())])
        let response: SottoClassAssessmentSpeakingStatus = try await send(request, acceptedStatuses: [200, 202])
        try response.validate()
        guard response.requestId?.lowercased() == recording.requestId.uuidString.lowercased() else {
            throw SottoAPIError.message("The saved recording could not be confirmed. Check its status.")
        }
        return response
    }

    private func assessmentSpeakingPath(classId: String, assessmentId: String, promptId: String) throws -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))
        let ids = try [classId, assessmentId, promptId].map { value in
            guard !value.isEmpty, value != ".", value != "..", let encoded = value.addingPercentEncoding(withAllowedCharacters: allowed) else {
                throw SottoAPIError.message("The speaking task could not be identified.")
            }
            return encoded
        }
        return "/api/v1/classes/\(ids[0])/assessment/\(ids[1])/speaking/\(ids[2])"
    }

    func submitClassAssessment(classId: String, assessmentId: String, choices: [SottoPracticeAnswer]) async throws -> SottoClassSubmitResult {
        let receipt: SottoClassSubmitResult = try await post(
            "/api/v1/classes/\(classId)/assessment/\(assessmentId)",
            body: AssessmentSubmissionRequest(choices: choices), acceptedStatuses: [200],
            timeout: SottoAPIClient.generationTimeout
        )
        guard receipt.source == "ASSESSMENT" else {
            throw SottoAPIError.message("The assessment result could not be verified.")
        }
        return receipt
    }

}

private struct AssessmentPrepareRequest: Encodable { let classAttempt: Int; let revision: String }
private struct AssessmentWritingRequest: Encodable { let text: String }
private struct AssessmentSubmissionRequest: Encodable { let choices: [SottoPracticeAnswer] }
