import Foundation

struct SottoSavedSourceAnalyses: Decodable {
    struct Item: Decodable, Identifiable {
        let analysisId: String
        let analysisRevision: Int
        let resultDigest: String?
        let status: String
        let sourceNames: [String]
        let focusCount: Int
        var id: String { analysisId }
    }
    let courseId: String
    let items: [Item]
    let nextCursor: String?
}

struct SottoSavedSourceFocuses: Decodable {
    struct Focus: Decodable, Identifiable {
        let id: String
        let title: String
        let kind: String
        let level: SottoLearningLevel?
        let order: Int
        let focusDigest: String
        let objectiveIds: [String]
    }
    let analysisId: String
    let analysisRevision: Int
    let resultDigest: String?
    let courseId: String?
    let target: String
    let status: String
    let stale: Bool
    let focuses: [Focus]
    let nextCursor: String?
}

struct SottoSavedSourceFocusDetail: Decodable {
    struct Focus: Decodable {
        struct Citation: Decodable, Identifiable {
            let streamId: String
            let pageNumber: Int
            let origin: String
            let codePointStart: Int
            let codePointEnd: Int
            let quote: String
            var id: String { "\(streamId):\(codePointStart):\(codePointEnd)" }
        }
        let title: String
        let citations: [Citation]
        let privateExtension: Bool
        let uncertainSource: Bool
        let exposureOnly: Bool
    }
    let analysisId: String
    let analysisRevision: Int
    let resultDigest: String
    let focusDigest: String
    let focus: Focus
}
