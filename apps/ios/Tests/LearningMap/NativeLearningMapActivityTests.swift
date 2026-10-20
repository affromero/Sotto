import Foundation
import XCTest
@testable import Sotto

@MainActor
final class NativeLearningMapActivityTests: XCTestCase {
    func testLateAdvanceCannotReplaceNewBandOrFinishItsPendingRead() async {
        let activity = NativeLearningMapActivity()
        let oldContext = context(level: .a2)
        let token = activity.begin(oldContext)
        let response = AsyncStream<Void>.makeStream()
        var viewed = SottoLearningLevel.a2
        var current = oldContext
        let completion = Task {
            for await _ in response.stream {
                if activity.accepts(token, context: current) { viewed = .b1 }
                activity.finish(token, context: current)
                return
            }
        }
        activity.invalidate()
        current = context(level: .a1)
        viewed = .a1
        let read = activity.begin(current)
        response.continuation.yield(())
        await completion.value
        XCTAssertEqual(viewed, .a1)
        XCTAssertTrue(activity.busy)
        XCTAssertTrue(activity.finish(read, context: current))
        XCTAssertFalse(activity.busy)
    }

    func testLatePracticeCannotDismissAnotherLearnerCourseOrNavigation() async {
        for replacement in [context(profile: "other"), context(course: "other"), context(level: .a1)] {
            let activity = NativeLearningMapActivity()
            let token = activity.begin(context())
            let response = AsyncStream<Void>.makeStream()
            var dismissed = false
            let completion = Task {
                for await _ in response.stream {
                    if activity.accepts(token, context: replacement) { dismissed = true }
                    activity.finish(token, context: replacement)
                    return
                }
            }
            activity.invalidate()
            let next = activity.begin(replacement)
            response.continuation.yield(())
            await completion.value
            XCTAssertFalse(dismissed)
            XCTAssertTrue(activity.busy)
            XCTAssertTrue(activity.finish(next, context: replacement))
        }
    }

    func testLostAdvanceIdentitySurvivesNavigationButCannotCrossLearnersOrIntents() {
        let activity = NativeLearningMapActivity()
        let owner = context()
        let saved = activity.advanceRequest(context: owner, level: .a2, catalogHash: "hash")
        activity.invalidate()
        let lowerRead = activity.begin(context(level: .a1))
        activity.finish(lowerRead, context: context(level: .a1))
        XCTAssertEqual(activity.advanceRequest(context: owner, level: .a2, catalogHash: "hash"), saved)
        let changedOwner = context(profile: "other")
        let other = activity.advanceRequest(context: changedOwner, level: .a2, catalogHash: "hash")
        XCTAssertNotEqual(other.requestId, saved.requestId)
        activity.confirmAdvance(saved, context: owner)
        XCTAssertEqual(activity.advanceRequest(context: changedOwner, level: .a2, catalogHash: "hash"), other)
        let revised = activity.advanceRequest(context: changedOwner, level: .a2, catalogHash: "revised")
        XCTAssertNotEqual(revised.requestId, other.requestId)
    }

    private func context(profile: String = "learner", course: String = "course",
                         level: SottoLearningLevel = .a2) -> NativeLearningMapContext {
        let client = SottoAPIClient(serverURL: URL(string: "https://synthetic.example")!, apiKey: "test", profileId: profile)
        return NativeLearningMapContext(learner: SottoLearnerIdentity(client), courseId: course, viewedLevel: level)
    }
}
