import Foundation

struct SottoPlacementAnalysisReference: Codable, Equatable {
    let analysisId: UUID
    let analysisRevision: Int
    let resultDigest: String
}

struct SottoPlacementBatch: Decodable, Equatable {
    let native: String
    let target: String
    let placementSessionId: UUID
    let status: String
    let questionsDigest: String
    let analysisId: UUID?
    let analysisRevision: Int?
    let resultDigest: String?
    let expiresAt: String
    let failureReason: String?
    let questions: [SottoPlacementQuestion]

    func validateIdentity(native: String, target: String, sessionId: UUID?) throws {
        guard self.native == native, self.target == target,
              sessionId == nil || placementSessionId == sessionId else {
            throw SottoAPIError.message("The saved placement identity changed. Reopen the same request.")
        }
        let sourceFields = [analysisId != nil, analysisRevision != nil, resultDigest != nil]
        guard sourceFields.allSatisfy({ $0 }) || sourceFields.allSatisfy({ !$0 }) else {
            throw SottoAPIError.message("The saved placement source receipt is incomplete.")
        }
        if ["READY", "ACCEPTED"].contains(status) {
            guard questionsDigest.count == 64,
                  questionsDigest.allSatisfy({ "0123456789abcdef".contains($0) }),
                  (6...24).contains(questions.count),
                  Set(questions.map(\.id)).count == questions.count,
                  questions.allSatisfy({ $0.id.hasPrefix("pq_") && Int($0.id.dropFirst(3)) != nil && $0.options.count == 5 }) else {
                throw SottoAPIError.message("The preserved placement questions are incomplete. Reopen the same request.")
            }
        }
    }
}

struct SottoPlacementQuestion: Decodable, Identifiable, Equatable {
    let id: String
    let cefr: String
    let skill: String
    let prompt: String
    let options: [String]
}

struct SottoPlacementSubmission: Encodable {
    let schemaVersion = 1
    let requestId: String
    let native: String
    let target: String
    let placementSessionId: String
    let questionsDigest: String
    let analysisId: String?
    let analysisRevision: Int?
    let resultDigest: String?
    let acceptPartial: Bool
    let answers: [SottoPlacementAnswer]
}
