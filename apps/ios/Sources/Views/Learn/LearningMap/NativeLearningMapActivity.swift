import SwiftUI

struct NativeLearningMapContext: Equatable {
    let learner: SottoLearnerIdentity
    let courseId: String
    let viewedLevel: SottoLearningLevel?
}

@MainActor
final class NativeLearningMapActivity: ObservableObject {
    struct Token: Equatable {
        let id: UUID
        let context: NativeLearningMapContext
    }

    @Published private(set) var busy = false
    private var active: Token?
    private var advanceIntent: (NativeLearningMapContext, SottoLearningAdvanceRequest)?

    func begin(_ context: NativeLearningMapContext) -> Token {
        let token = Token(id: UUID(), context: context)
        active = token
        busy = true
        return token
    }

    func accepts(_ token: Token, context: NativeLearningMapContext?) -> Bool {
        active == token && context == token.context
    }

    @discardableResult
    func finish(_ token: Token, context: NativeLearningMapContext?) -> Bool {
        guard accepts(token, context: context) else { return false }
        active = nil
        busy = false
        return true
    }

    func invalidate() {
        active = nil
        busy = false
    }

    func advanceRequest(context: NativeLearningMapContext, level: SottoLearningLevel, catalogHash: String) -> SottoLearningAdvanceRequest {
        if let (owner, request) = advanceIntent, owner.learner == context.learner,
           owner.courseId == context.courseId, request.expectedLevel == level,
           request.catalogHash == catalogHash { return request }
        let request = SottoLearningAdvanceRequest(requestId: UUID(), expectedLevel: level, catalogHash: catalogHash)
        advanceIntent = (context, request)
        return request
    }

    func reconcileAdvance(_ map: SottoLearningMap, context: NativeLearningMapContext) {
        guard let (owner, request) = advanceIntent else { return }
        if owner.learner != context.learner || owner.courseId != context.courseId ||
            map.currentLevel != request.expectedLevel || map.completedAt != nil {
            advanceIntent = nil
        }
    }

    func confirmAdvance(_ request: SottoLearningAdvanceRequest, context: NativeLearningMapContext) {
        guard let (owner, saved) = advanceIntent, owner.learner == context.learner,
              owner.courseId == context.courseId, saved == request else { return }
        advanceIntent = nil
    }
}
