import Foundation

extension SottoAPIClient {
    /// A retry keeps the caller's UUID and polls the same admitted session.
    func fetchPlacement(
        native: String, target: String, requestId: UUID,
        source: SottoPlacementAnalysisReference? = nil, acceptPartial: Bool = false,
        pollInterval: Duration = .seconds(2)
    ) async throws -> SottoPlacementBatch {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(Self.generationTimeout))
        var batch: SottoPlacementBatch = try await post("/api/v1/placement/generate", body: SottoPlacementAdmission(
            requestId: requestId.uuidString.lowercased(), native: native, target: target,
            analysisId: source?.analysisId.uuidString.lowercased(), analysisRevision: source?.analysisRevision,
            resultDigest: source?.resultDigest, acceptPartial: acceptPartial),
            acceptedStatuses: [200, 202], timeout: Self.generationTimeout)
        let sessionId = batch.placementSessionId
        while true {
            try Task.checkCancellation()
            try batch.validateIdentity(native: native, target: target, sessionId: sessionId)
            guard batch.analysisId == source?.analysisId, batch.analysisRevision == source?.analysisRevision,
                  batch.resultDigest == source?.resultDigest else {
                throw SottoAPIError.message("The saved placement source identity changed.")
            }
            if ["READY", "ACCEPTED"].contains(batch.status) { return batch }
            guard ["QUEUED", "GENERATING", "DISPATCHING", "SUCCEEDED"].contains(batch.status) else {
                throw SottoAPIError.message(batch.failureReason ?? "Placement stopped in state \(batch.status). Reopen the saved request or resolve it on the web app.")
            }
            guard clock.now < deadline else {
                throw SottoAPIError.message("Placement is still saved on the server. Retry to resume this request.")
            }
            try await Task.sleep(for: pollInterval)
            batch = try await get("/api/v1/placement?placementSessionId=\(sessionId.uuidString.lowercased())",
                                  acceptedStatuses: [200, 202], timeout: Self.defaultTimeout)
        }
    }

    func submitPlacement(
        batch: SottoPlacementBatch, requestId: UUID, answers: [SottoPlacementAnswer], acceptPartial: Bool = false
    ) async throws -> SottoPlacementResult {
        try batch.validateIdentity(native: batch.native, target: batch.target, sessionId: batch.placementSessionId)
        guard ["READY", "ACCEPTED"].contains(batch.status),
              Set(answers.map(\.id)) == Set(batch.questions.map(\.id)), answers.count == batch.questions.count,
              answers.allSatisfy({ (0...4).contains($0.selectedIndex) }) else {
            throw SottoAPIError.message("Answer every preserved placement question before submitting.")
        }
        return try await post("/api/v1/placement", body: SottoPlacementSubmission(requestId: requestId.uuidString.lowercased(),
            native: batch.native, target: batch.target, placementSessionId: batch.placementSessionId.uuidString.lowercased(),
            questionsDigest: batch.questionsDigest, analysisId: batch.analysisId?.uuidString.lowercased(), analysisRevision: batch.analysisRevision,
            resultDigest: batch.resultDigest, acceptPartial: acceptPartial, answers: answers),
            acceptedStatuses: [200], timeout: Self.generationTimeout)
    }
}

private struct SottoPlacementAdmission: Encodable {
    let schemaVersion = 1
    let requestId: String
    let native: String
    let target: String
    let analysisId: String?
    let analysisRevision: Int?
    let resultDigest: String?
    let acceptPartial: Bool
}
