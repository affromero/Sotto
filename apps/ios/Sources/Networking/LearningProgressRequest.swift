import Foundation

struct LearningProgressRequest: Encodable {
    let expectedRevision: Int
    let answers: [String: Int]
    let writingDrafts: [String: String]
}

struct PracticeGenerationAction: Encodable {
    let action: String
    let acknowledgeUnknownOutcome: Bool
}
