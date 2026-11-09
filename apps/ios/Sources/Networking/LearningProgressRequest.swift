import Foundation

struct LearningProgressRequest: Encodable {
    let expectedRevision: Int
    let answers: [String: Int]
    let writingDrafts: [String: String]
    var expectedAttempt: Int? = nil
    var taskMaterialRevision: String? = nil
}

struct PracticeGenerationAction: Encodable {
    let action: String
    let acknowledgeUnknownOutcome: Bool
}
