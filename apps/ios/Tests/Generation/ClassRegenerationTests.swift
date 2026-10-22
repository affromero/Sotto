import Combine
import XCTest

@testable import Sotto

final class ClassRegenerationTests: XCTestCase {
    @MainActor
    func testClassMenuRetriesConfirmedFailedPreparationWithTheCurrentAttempt() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("FAILED", host: host(model))
        await waitForState(model) { $1["course"]?.contains("FAILED") == true }
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await waitForState(model) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
        let payloads = await ClassRegenerationServer.shared.postPayloads(host: host(model))
        XCTAssertEqual(payloads.map(\.expectedAttempt), [4, 5])
        XCTAssertNil(model.selectedClass)
        model.signOut()
    }

    @MainActor
    func testRemovingFailedClassClearsItsObservationAndAllowsANewClass() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("FAILED", host: host(model))
        await waitForState(model) { $1["course"]?.contains("FAILED") == true }
        await model.openClass("class")
        let removed = await model.deleteSelectedClass(classId: "class")
        XCTAssertTrue(removed)
        XCTAssertNil(model.selectedClass)
        XCTAssertNil(model.courses.first?.activeClassId)
        XCTAssertTrue(model.courses.first?.classes.isEmpty == true)
        XCTAssertNil(model.classGenerationErrors["course"])
        XCTAssertNil(model.classGenerationRetryTitle(for: "course"))
        model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
        await waitForState(model) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
        let payloads = await ClassRegenerationServer.shared.postPayloads(host: host(model))
        XCTAssertEqual(payloads.last?.path, "/api/v1/courses/course/next-class")
        model.signOut()
    }

    @MainActor
    func testFailedRemovalKeepsTheClassAndItsSavedAnswers() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        let original = model.selectedClass
        await ClassRegenerationServer.shared.setRemovalStatus(503, host: host(model))
        let removed = await model.deleteSelectedClass(classId: "class")
        XCTAssertFalse(removed)
        XCTAssertEqual(model.selectedClass, original)
        XCTAssertEqual(model.selectedClass?.learnerAnswers, ["old-question": 1])
        XCTAssertEqual(model.courses.first?.activeClassId, "class")
        XCTAssertNotNil(model.errorMessage)
        model.signOut()
    }

    @MainActor
    func testRemovalWaitingForASaveCannotDeleteAfterCancellationClassSwitchOrProfileChange() async throws {
        for action in ["cancel", "switch-class", "switch-profile"] {
            let session = makeSession()
            let model = model(session: session)
            await model.loadCourses(showLoading: false)
            await model.openClass("class")
            let serverHost = host(model)
            let progress = LearningProgressStore()
            progress.configure(client: model.makeClient(), path: "/api/v1/classes/class", revision: 4)
            let saving = expectation(description: "Progress save is active before removal")
            await ClassRegenerationServer.shared.holdProgress(host: serverHost, arrival: saving)
            addTeardownBlock {
                await ClassRegenerationServer.shared.releaseProgress(host: serverHost)
                session.invalidateAndCancel()
            }
            progress.update(answers: ["old-question": 1], writingDrafts: ["writing": "Keep this draft"])
            await fulfillment(of: [saving], timeout: 5)
            let removing = expectation(description: "Removal is waiting for the progress save")
            var started = false
            let observation = model.$isLoading.sink { loading in
                if loading && !started { started = true; removing.fulfill() }
            }
            let finished = expectation(description: "Abandoned removal finishes after the save drains")
            var removed: Bool?
            model.run {
                removed = await model.deleteSelectedClass(classId: "class", progress: progress)
                finished.fulfill()
            }
            await fulfillment(of: [removing], timeout: 5)
            observation.cancel()
            switch action {
            case "cancel": await model.cancelWork()
            case "switch-class": await model.openClass("other-class")
            default: model.clearSelectedProfile()
            }
            await ClassRegenerationServer.shared.releaseProgress(host: serverHost)
            await fulfillment(of: [finished], timeout: 5)
            XCTAssertEqual(removed, false, action)
            let requests = await ClassRegenerationServer.shared.requests(host: serverHost)
            XCTAssertFalse(requests.contains("DELETE"), action)
            if action == "switch-class" { XCTAssertEqual(model.selectedClass?.id, "other-class") }
            if action == "cancel" { XCTAssertEqual(model.selectedClass?.id, "class") }
            XCTAssertEqual(progress.answers, ["old-question": 1])
            model.signOut()
        }
    }

    @MainActor
    func testClassMenuRetriesItsConfirmedFailedInitialPreparation() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
        await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
        await ClassRegenerationServer.shared.set("FAILED", host: host(model))
        await waitForState(model) { $1["course"]?.contains("FAILED") == true }
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await waitForState(model) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
        let payloads = await ClassRegenerationServer.shared.postPayloads(host: host(model))
        XCTAssertEqual(payloads.map(\.path), ["/api/v1/courses/course/next-class", "/api/v1/classes/class"])
        XCTAssertEqual(payloads.last?.expectedAttempt, 5)
        XCTAssertNil(model.selectedClass)
        model.signOut()
    }

    @MainActor
    func testEmptyFailedOrCancelledClassCanBeRemovedWithoutOpeningAndReplaced() async throws {
        for phase in ["FAILED", "CANCELLED"] {
            let model = model()
            let serverHost = host(model)
            await model.loadCourses(showLoading: false)
            model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
            await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
            await ClassRegenerationServer.shared.setEmptyClass("FAILED", host: serverHost)
            await ClassRegenerationServer.shared.set(phase, host: serverHost)
            await waitForState(model) { $1["course"]?.contains(phase) == true }
            if phase == "CANCELLED" {
                var staleCourse = try XCTUnwrap(model.courses.first)
                staleCourse.activeClassId = nil
                staleCourse.classes = []
                model.applyCourseRefresh([staleCourse])
            }
            let course = try XCTUnwrap(model.courses.first)
            let target = try XCTUnwrap(model.failedClassRemoval(for: course))
            XCTAssertNil(model.selectedClass)
            let removed = await model.removeFailedClass(target)
            XCTAssertTrue(removed, phase)
            XCTAssertNil(model.courses.first?.activeClassId)
            XCTAssertTrue(model.courses.first?.classes.isEmpty == true)
            XCTAssertNil(model.classGenerationRetryTitle(for: course.id))
            model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
            await waitForState(model) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
            let payloads = await ClassRegenerationServer.shared.postPayloads(host: serverHost)
            XCTAssertEqual(payloads.last?.path, "/api/v1/courses/course/next-class")
            model.signOut()
        }
    }

    @MainActor
    func testFailedClassRemovalPreservesTheGateWhenDeletionFails() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
        await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
        await ClassRegenerationServer.shared.setEmptyClass("FAILED", host: host(model))
        await ClassRegenerationServer.shared.set("FAILED", host: host(model))
        await waitForState(model) { $1["course"]?.contains("FAILED") == true }
        let target = try XCTUnwrap(model.failedClassRemoval(for: try XCTUnwrap(model.courses.first)))
        await ClassRegenerationServer.shared.setRemovalStatus(503, host: host(model))
        let removed = await model.removeFailedClass(target)
        XCTAssertFalse(removed)
        XCTAssertEqual(model.courses.first?.activeClassId, "class")
        XCTAssertNotNil(model.classGenerationRetryTitle(for: "course"))
        XCTAssertTrue(model.classGenerationErrors["course"]?.contains("FAILED") == true)
        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.selectedClass)
        model.signOut()
    }

    @MainActor
    func testFailedClassRemovalRejectsChangedAndUncertainTargetsWithoutDeleting() async throws {
        for change in ["RUNNING", "UNRESOLVED", "REPLACED", "RETARGETED",
                       "PASSED_DETAIL", "SUBMITTED_DETAIL", "profile", "active-class"] {
            let model = model()
            let serverHost = host(model)
            await model.loadCourses(showLoading: false)
            model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
            await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
            await ClassRegenerationServer.shared.setEmptyClass("FAILED", host: serverHost)
            await ClassRegenerationServer.shared.set("FAILED", host: serverHost)
            await waitForState(model) { $1["course"]?.contains("FAILED") == true }
            let target = try XCTUnwrap(model.failedClassRemoval(for: try XCTUnwrap(model.courses.first)))
            if change == "profile" { model.clearSelectedProfile() }
            else if change == "active-class" {
                var changed = try XCTUnwrap(model.courses.first)
                changed.activeClassId = "other-class"
                model.applyCourseRefresh([changed])
            } else if change == "PASSED_DETAIL" {
                await ClassRegenerationServer.shared.setEmptyClass("PASSED", host: serverHost)
            } else if change == "SUBMITTED_DETAIL" {
                await ClassRegenerationServer.shared.setEmptyClass("FAILED", host: serverHost, submitted: true)
            } else { await ClassRegenerationServer.shared.set(change, host: serverHost) }
            let removed = await model.removeFailedClass(target)
            XCTAssertFalse(removed, change)
            let requests = await ClassRegenerationServer.shared.requests(host: serverHost)
            XCTAssertFalse(requests.contains("DELETE"), change)
            model.signOut()
        }
    }

    @MainActor
    func testFailedInitialPreparationRemovesGeneratingOrAlreadyRemovedRowsThroughExactCleanup() async throws {
        for detailStatus in [200, 404] {
            let model = model()
            let serverHost = host(model)
            await model.loadCourses(showLoading: false)
            model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
            await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
            await ClassRegenerationServer.shared.setEmptyClass("GENERATING", host: serverHost)
            await ClassRegenerationServer.shared.set("FAILED", host: serverHost)
            await waitForState(model) { $1["course"]?.contains("FAILED") == true }
            await ClassRegenerationServer.shared.setDetailStatus(detailStatus, host: serverHost)
            let target = try XCTUnwrap(model.failedClassRemoval(for: try XCTUnwrap(model.courses.first)))
            let removed = await model.removeFailedClass(target)
            XCTAssertTrue(removed)
            XCTAssertTrue(model.courses.first?.classes.isEmpty == true)
            XCTAssertNil(model.classGenerationRetryTitle(for: "course"))
            let paths = await ClassRegenerationServer.shared.requestPaths(host: serverHost)
            XCTAssertTrue(paths.contains("DELETE /api/v1/courses/course/generation?operationId=new-operation&classId=class"))
            XCTAssertFalse(paths.contains("DELETE /api/v1/classes/class"))
            model.signOut()
        }
    }

    @MainActor
    func testFailedInitialPreparationRetriesGeneratingOrMissingRowsWithItsExactOperation() async throws {
        for detailStatus in [200, 404] {
            let model = model()
            let serverHost = host(model)
            await model.loadCourses(showLoading: false)
            model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
            await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
            await ClassRegenerationServer.shared.setEmptyClass("GENERATING", host: serverHost)
            await ClassRegenerationServer.shared.set("FAILED", host: serverHost)
            await waitForState(model) { $1["course"]?.contains("FAILED") == true }
            await ClassRegenerationServer.shared.setDetailStatus(detailStatus, host: serverHost)
            model.retryClassGeneration(for: try XCTUnwrap(model.courses.first))
            await waitForState(model) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
            let paths = await ClassRegenerationServer.shared.requestPaths(host: serverHost)
            XCTAssertTrue(paths.contains("POST /api/v1/courses/course/next-class?background=1&expectedOperationId=new-operation&expectedClassId=class"))
            XCTAssertFalse(paths.contains("POST /api/v1/classes/class"))
            model.signOut()
        }
    }

    @MainActor
    func testUnconfirmedTerminalCleanupPreservesRemovalGateAndCanBeExplicitlyRechecked() async throws {
        let model = model()
        let serverHost = host(model)
        await model.loadCourses(showLoading: false)
        model.startClassGeneration(for: try XCTUnwrap(model.courses.first))
        await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
        await ClassRegenerationServer.shared.setEmptyClass("GENERATING", host: serverHost)
        await ClassRegenerationServer.shared.set("FAILED", host: serverHost)
        await waitForState(model) { $1["course"]?.contains("FAILED") == true }
        let target = try XCTUnwrap(model.failedClassRemoval(for: try XCTUnwrap(model.courses.first)))
        await ClassRegenerationServer.shared.setCleanupAcknowledged(false, host: serverHost)
        let unconfirmed = await model.removeFailedClass(target)
        XCTAssertFalse(unconfirmed)
        XCTAssertNotNil(model.failedClassRemoval(for: try XCTUnwrap(model.courses.first)))
        XCTAssertNotNil(model.errorMessage)
        await ClassRegenerationServer.shared.setDetailStatus(404, host: serverHost)
        await ClassRegenerationServer.shared.setCleanupAcknowledged(true, host: serverHost)
        let confirmed = await model.removeFailedClass(target)
        XCTAssertTrue(confirmed)
        XCTAssertTrue(model.courses.first?.classes.isEmpty == true)
        model.signOut()
    }

    @MainActor
    func testRelaunchRecoversAnUnpublishedInitialClassWithoutAnActivePointerAndRetainsItsSource() async throws {
        let first = model()
        let serverHost = host(first)
        await first.loadCourses(showLoading: false)
        first.startClassGeneration(for: try XCTUnwrap(first.courses.first), source: .topic("Sustainable travel"))
        await waitForState(first) { operations, _ in operations["course"]?.progress == 0.2 }
        await ClassRegenerationServer.shared.setEmptyClass("GENERATING", host: serverHost)
        await ClassRegenerationServer.shared.setMissingActiveClass(host: serverHost)
        await ClassRegenerationServer.shared.set("FAILED", host: serverHost)
        await waitForState(first) { $1["course"]?.contains("FAILED") == true }
        first.signOut()
        let relaunched = model(host: serverHost)
        await relaunched.loadCourses(showLoading: false)
        await waitForState(relaunched) { $1["course"]?.contains("FAILED") == true }
        let course = try XCTUnwrap(relaunched.courses.first)
        XCTAssertNil(course.activeClassId)
        XCTAssertNotNil(relaunched.failedClassRemoval(for: course))
        relaunched.retryClassGeneration(for: course)
        await waitForState(relaunched) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
        let payloads = await ClassRegenerationServer.shared.postPayloads(host: serverHost)
        XCTAssertEqual(payloads.last?.path, "/api/v1/courses/course/next-class")
        XCTAssertEqual(payloads.last?.topic, "Sustainable travel")
        let paths = await ClassRegenerationServer.shared.requestPaths(host: serverHost)
        XCTAssertTrue(paths.contains("POST /api/v1/courses/course/next-class?background=1&expectedOperationId=new-operation&expectedClassId=class"))
        relaunched.signOut()
    }

    @MainActor
    func testUnconfirmedPreparationDoesNotOfferFailedClassRemoval() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await ClassRegenerationServer.shared.setAdmissionStatus(503, host: host(model))
        await model.regenerateSelectedClass()
        XCTAssertNil(model.failedClassRemoval(for: try XCTUnwrap(model.courses.first)))
        model.signOut()
    }

    @MainActor
    func testAcceptedRegenerationReturnsToCourseProgressWhileTheClassIsStillPreparing() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        XCTAssertEqual(model.selectedClass?.learnerAnswers, ["old-question": 1])
        let admitted = expectation(description: "Accepted regeneration releases the foreground")
        let request = Task {
            await model.regenerateSelectedClass()
            admitted.fulfill()
        }
        await fulfillment(of: [admitted], timeout: 1)
        request.cancel()
        await request.value
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.selectedClass)
        XCTAssertNotNil(model.classGenerationOperations["course"])
        XCTAssertNil(model.classGenerationErrors["course"])
        model.signOut()
    }

    @MainActor
    func testPublishedRegenerationIsResumableWithItsNewAttemptAndSavedRevision() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("COMPLETED", host: host(model))
        await waitForState(model) { $0["course"] == nil && $1["course"] == nil }
        await model.openClass("class")
        XCTAssertEqual(model.selectedClass?.attempt, 5)
        XCTAssertEqual(model.selectedClass?.progressRevision, 5)
        XCTAssertEqual(model.selectedClass?.learnerAnswers, [:])
        XCTAssertFalse(model.isLoading)
        model.signOut()
    }

    @MainActor
    func testRelaunchFindsRunningRegenerationWithoutAnotherAdmission() async throws {
        let first = model()
        let serverHost = host(first)
        await first.loadCourses(showLoading: false)
        await first.openClass("class")
        await first.regenerateSelectedClass()
        first.signOut()
        let relaunched = model(host: serverHost)
        await relaunched.loadCourses(showLoading: false)
        XCTAssertFalse(relaunched.isLoading)
        await waitForState(relaunched) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
        await ClassRegenerationServer.shared.set("COMPLETED", host: serverHost)
        await waitForState(relaunched) { $0["course"] == nil && $1["course"] == nil }
        await relaunched.openClass("class")
        XCTAssertEqual(relaunched.selectedClass?.attempt, 5)
        let requests = await ClassRegenerationServer.shared.requests(host: serverHost)
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 1)
        relaunched.signOut()
    }

    @MainActor
    func testDurableFailureAndUnresolvedOutcomesNeverLookLikeSuccessfulPublication() async throws {
        for status in ["FAILED", "CANCELLED", "UNRESOLVED"] {
            let model = model()
            await model.loadCourses(showLoading: false)
            await model.openClass("class")
            await model.regenerateSelectedClass()
            await ClassRegenerationServer.shared.set(status, host: host(model))
            await waitForState(model) { $0["course"] == nil && $1["course"]?.contains(status) == true }
            XCTAssertNil(model.selectedClass)
            XCTAssertFalse(model.isLoading)
            XCTAssertEqual(model.classGenerationRetryTitle(for: "course") != nil, status != "UNRESOLVED")
            model.signOut()
        }
    }

    @MainActor
    func testKnownFailedRegenerationOnlyRetriesAfterExplicitUserAction() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("FAILED", host: host(model))
        await waitForState(model) { $1["course"]?.contains("FAILED") == true }
        var requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 1)
        model.retryClassGeneration(for: try XCTUnwrap(model.courses.first))
        await waitForState(model) { $0["course"]?.progress == 0.2 && $1["course"] == nil }
        requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 2)
        let payloads = await ClassRegenerationServer.shared.postPayloads(host: host(model))
        XCTAssertEqual(payloads.map(\.path), ["/api/v1/classes/class", "/api/v1/classes/class"])
        XCTAssertEqual(payloads.map(\.scope), ["class", "class"])
        XCTAssertEqual(payloads.map(\.expectedAttempt), [4, 5])
        model.signOut()
    }

    @MainActor
    func testCompletedOperationCannotPublishThePreviousClassAttempt() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("STALE_COMPLETED", host: host(model))
        await waitForState(model) { $0["course"] == nil && $1["course"]?.contains("attempt changed") == true }
        XCTAssertNil(model.selectedClass)
        let requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 1)
        model.signOut()
    }

    @MainActor
    func testTransientObservationFailureKeepsAdmittedWorkVisibleWithoutReposting() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("UNAVAILABLE", host: host(model))
        await waitForState(model) { operations, _ in operations["course"]?.activity?.contains("Cannot refresh") == true }
        XCTAssertFalse(model.isLoading)
        let requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 1)
        model.signOut()
    }

    @MainActor
    func testReplacedOperationCannotPublishOrCancelAnotherPreparation() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await model.regenerateSelectedClass()
        await ClassRegenerationServer.shared.set("REPLACED", host: host(model))
        await waitForState(model) { $0["course"] == nil && $1["course"]?.contains("changed") == true }
        await model.cancelClassGeneration(for: "course")
        let requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertFalse(requests.contains("DELETE"))
        XCTAssertNil(model.selectedClass)
        model.signOut()
    }

    @MainActor
    func testUnconfirmedAdmissionOnlyChecksStatusAndExplicitTerminalCheckAllowsLaterUserWork() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await ClassRegenerationServer.shared.setAdmissionStatus(503, host: host(model))
        await model.regenerateSelectedClass()
        let course = try XCTUnwrap(model.courses.first)
        model.checkClassGenerationStatus(for: course)
        await waitForState(model) { $1["course"]?.contains("remains unconfirmed") == true }
        await model.cancelClassGeneration(for: "course")
        var requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 1)
        XCTAssertFalse(requests.contains("DELETE"))
        await ClassRegenerationServer.shared.set("COMPLETED", host: host(model))
        model.checkClassGenerationStatus(for: course)
        await waitForState(model) { $1["course"]?.contains("settled") == true }
        await model.openClass("class")
        XCTAssertEqual(model.selectedClass?.attempt, 5)
        await ClassRegenerationServer.shared.setAdmissionStatus(202, host: host(model))
        await model.regenerateSelectedClass()
        requests = await ClassRegenerationServer.shared.requests(host: host(model))
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 2)
        model.signOut()
    }

    @MainActor
    func testRejectedAdmissionRetainsTheOpenClassAndItsAnswers() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        await ClassRegenerationServer.shared.setAdmissionStatus(409, host: host(model))
        await model.regenerateSelectedClass()
        XCTAssertEqual(model.selectedClass?.attempt, 4)
        XCTAssertEqual(model.selectedClass?.learnerAnswers, ["old-question": 1])
        XCTAssertFalse(model.isLoading)
        XCTAssertNotNil(model.errorMessage)
        model.signOut()
    }

    @MainActor
    func testClearingProfileDuringAdmissionRemovesOverlayAndRejectsLateCompletion() async throws {
        let session = makeSession()
        let model = model(session: session)
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        let serverHost = host(model)
        let arrival = expectation(description: "Regeneration POST reaches its held response")
        await ClassRegenerationServer.shared.holdAdmission(host: serverHost, arrival: arrival)
        addTeardownBlock {
            await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
            session.invalidateAndCancel()
        }
        model.run { await model.regenerateSelectedClass() }
        guard await XCTWaiter.fulfillment(of: [arrival], timeout: 5) == .completed else {
            await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
            await model.cancelWork()
            model.applyCourseRefresh([])
            session.invalidateAndCancel()
            XCTFail("Regeneration POST did not arrive within five seconds.")
            return
        }
        model.clearSelectedProfile()
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.loadingOperation)
        await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
        await model.loadCourses(showLoading: false)
        XCTAssertNil(model.selectedClass)
        XCTAssertTrue(model.classGenerationOperations.isEmpty)
        XCTAssertTrue(model.classGenerationErrors.isEmpty)
        XCTAssertTrue(model.courses.isEmpty)
    }

    @MainActor
    func testStoppingAdmissionWaitCanRecoverWithGetOnlyAfterLostAcknowledgement() async throws {
        let session = makeSession()
        let model = model(session: session)
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        let serverHost = host(model)
        let arrival = expectation(description: "Regeneration POST reaches its held response")
        await ClassRegenerationServer.shared.holdAdmission(host: serverHost, arrival: arrival)
        addTeardownBlock {
            await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
            session.invalidateAndCancel()
        }
        model.run { await model.regenerateSelectedClass() }
        guard await XCTWaiter.fulfillment(of: [arrival], timeout: 5) == .completed else {
            await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
            await model.cancelWork()
            model.applyCourseRefresh([])
            session.invalidateAndCancel()
            XCTFail("Regeneration POST did not arrive within five seconds.")
            return
        }
        await model.cancelWork()
        await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
        await waitForState(model) { $1["course"]?.contains("could not be confirmed") == true }
        await model.loadCourses(showLoading: false)
        await waitForState(model) { $1["course"]?.contains("remains unconfirmed") == true }
        XCTAssertFalse(model.isLoading)
        XCTAssertNil(model.loadingOperation)
        let requests = await ClassRegenerationServer.shared.requests(host: serverHost)
        XCTAssertEqual(requests.filter { $0 == "POST" }.count, 1)
        XCTAssertFalse(requests.contains("DELETE"))
        model.signOut()
    }

    @MainActor
    func testCancelledAdmissionCannotDismissANewerForegroundClass() async throws {
        let session = makeSession()
        let model = model(session: session)
        await model.loadCourses(showLoading: false)
        await model.openClass("class")
        let serverHost = host(model)
        let arrival = expectation(description: "Regeneration POST reaches its held response")
        await ClassRegenerationServer.shared.holdAdmission(host: serverHost, arrival: arrival)
        addTeardownBlock {
            await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
            session.invalidateAndCancel()
        }
        model.run { await model.regenerateSelectedClass() }
        guard await XCTWaiter.fulfillment(of: [arrival], timeout: 5) == .completed else {
            await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
            await model.cancelWork()
            model.applyCourseRefresh([])
            session.invalidateAndCancel()
            XCTFail("Regeneration POST did not arrive within five seconds.")
            return
        }
        await model.cancelWork()
        await model.openClass("other-class")
        XCTAssertEqual(model.selectedClass?.id, "other-class")
        let dismissed = expectation(description: "Old admission cannot dismiss the new class")
        dismissed.isInverted = true
        let observation = model.$selectedClass.sink { detail in
            if detail?.id != "other-class" { dismissed.fulfill() }
        }
        await ClassRegenerationServer.shared.releaseAdmission(host: serverHost)
        await fulfillment(of: [dismissed], timeout: 0.2)
        observation.cancel()
        XCTAssertFalse(model.isLoading)
        model.signOut()
    }

    @MainActor
    func testNextClassAcceptsTheCanonicalResponseWithoutCourseIdAndChecksDurableFailure() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        let course = try XCTUnwrap(model.courses.first)
        await ClassRegenerationServer.shared.setAdmissionStatus(202, host: host(model), next: true)
        model.startClassGeneration(for: course)
        await waitForState(model) { operations, _ in operations["course"]?.progress == 0.2 }
        await ClassRegenerationServer.shared.set("FAILED", host: host(model))
        await waitForState(model) { $0["course"] == nil && $1["course"]?.contains("FAILED") == true }
        XCTAssertNil(model.selectedClass)
        model.signOut()
    }

    @MainActor
    private func waitForState(_ model: SottoAppModel,
        matching predicate: @escaping ([String: SottoLoadingOperation], [String: String]) -> Bool) async {
        let reached = expectation(description: "Generation reaches its observable state")
        var fulfilled = false
        let observation = model.$classGenerationOperations.combineLatest(model.$classGenerationErrors)
            .sink { operations, errors in
                if !fulfilled, predicate(operations, errors) { fulfilled = true; reached.fulfill() }
            }
        await fulfillment(of: [reached], timeout: 5)
        observation.cancel()
    }

    @MainActor
    private func host(_ model: SottoAppModel) -> String { model.credentials!.serverURL.host! }

    @MainActor
    private func model(host: String = UUID().uuidString.lowercased() + ".example", session: URLSession? = nil) -> SottoAppModel {
        SottoAppModel(credentials: SottoCredentials(
            serverURL: URL(string: "https://\(host)")!,
            apiKey: "synthetic-key", user: nil, selectedProfile: SottoProfile(
                id: "learner", name: "Learner", avatarUrl: "", isOwner: true,
                role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)),
            session: session ?? makeSession(), credentialStore: RegenerationCredentials())
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ClassRegenerationHTTP.self]
        return URLSession(configuration: configuration)
    }
}

private struct RegenerationCredentials: SottoCredentialPersistence {
    func load() throws -> SottoCredentials? { nil }
    func save(_ credentials: SottoCredentials) throws {}
    func delete() throws {}
}

private actor ClassRegenerationServer {
    struct PostPayload: Decodable {
        var path = ""
        let scope: String?
        let expectedAttempt: Int?
        let topic: String?
        let sourceUrl: String?
        private enum CodingKeys: String, CodingKey { case scope, expectedAttempt, topic, sourceUrl }
    }
    private struct InitialSource: Encodable { let topic: String?; let sourceUrl: String? }
    static let shared = ClassRegenerationServer()
    private var admitted = Set<String>()
    private var phases: [String: String] = [:]
    private var attempts: [String: Int] = [:]
    private var admissionStatuses: [String: Int] = [:]
    private var nextResponses = Set<String>()
    private var removed = Set<String>()
    private var removalStatuses: [String: Int] = [:]
    private var emptyClassStatuses: [String: String] = [:]
    private var submittedEmptyClasses = Set<String>()
    private var methods: [String: [String]] = [:]
    private var paths: [String: [String]] = [:]
    private var detailStatuses: [String: Int] = [:]
    private var cleanupAcknowledged: [String: Bool] = [:]
    private var initialSources: [String: InitialSource] = [:]
    private var missingActiveClasses = Set<String>()
    private var payloads: [String: [PostPayload]] = [:]
    private var admissionArrivals: [String: XCTestExpectation] = [:]
    private var admissionReleases: [String: CheckedContinuation<Void, Never>] = [:]
    private var progressArrivals: [String: XCTestExpectation] = [:]
    private var progressReleases: [String: CheckedContinuation<Void, Never>] = [:]

    func set(_ phase: String, host: String) { phases[host] = phase }
    func setRemovalStatus(_ status: Int, host: String) { removalStatuses[host] = status }
    func setEmptyClass(_ status: String, host: String, submitted: Bool = false) {
        emptyClassStatuses[host] = status
        if submitted { submittedEmptyClasses.insert(host) }
        else { submittedEmptyClasses.remove(host) }
    }
    func setAdmissionStatus(_ status: Int, host: String, next: Bool = false) {
        admissionStatuses[host] = status
        if next { nextResponses.insert(host) }
    }
    func requests(host: String) -> [String] { methods[host] ?? [] }
    func requestPaths(host: String) -> [String] { paths[host] ?? [] }
    func setDetailStatus(_ status: Int, host: String) { detailStatuses[host] = status }
    func setCleanupAcknowledged(_ value: Bool, host: String) { cleanupAcknowledged[host] = value }
    func setMissingActiveClass(host: String) { missingActiveClasses.insert(host) }
    func postPayloads(host: String) -> [PostPayload] { payloads[host] ?? [] }
    func holdAdmission(host: String, arrival: XCTestExpectation) { admissionArrivals[host] = arrival }
    func holdProgress(host: String, arrival: XCTestExpectation) { progressArrivals[host] = arrival }
    func releaseProgress(host: String) {
        progressArrivals[host] = nil
        progressReleases.removeValue(forKey: host)?.resume()
    }
    func releaseAdmission(host: String) {
        admissionArrivals[host] = nil
        admissionReleases.removeValue(forKey: host)?.resume()
    }

    func respond(_ request: URLRequest) async -> (Int, String) {
        let host = request.url!.host!
        methods[host, default: []].append(request.httpMethod ?? "GET")
        paths[host, default: []].append("\(request.httpMethod ?? "GET") \(request.url!.path)\(request.url!.query.map { "?" + $0 } ?? "")")
        if request.httpMethod == "PATCH" {
            if let arrival = progressArrivals.removeValue(forKey: host) {
                await withCheckedContinuation { continuation in
                    progressReleases[host] = continuation
                    arrival.fulfill()
                }
            }
            return (200, #"{"saved":true,"progressRevision":5}"#)
        }
        if request.httpMethod == "POST" {
            if request.url!.path.hasSuffix("/next-class") { removed.remove(host) }
            if let data = request.httpBody, var payload = try? JSONDecoder().decode(PostPayload.self, from: data) {
                payload.path = request.url!.path
                payloads[host, default: []].append(payload)
                if request.url!.path.hasSuffix("/next-class") {
                    initialSources[host] = InitialSource(topic: payload.topic, sourceUrl: payload.sourceUrl)
                } else { initialSources[host] = nil }
            }
            let responseStatus = admissionStatuses[host] ?? 202
            if responseStatus == 409 { return (409, #"{"error":"The class attempt changed."}"#) }
            admitted.insert(host)
            attempts[host] = (attempts[host] ?? 4) + 1
            phases[host] = "RUNNING"
            if let arrival = admissionArrivals.removeValue(forKey: host) {
                await withCheckedContinuation { continuation in
                    admissionReleases[host] = continuation
                    arrival.fulfill()
                }
            }
            if responseStatus != 202 { return (responseStatus, #"{"error":"Acknowledgement unavailable."}"#) }
            if nextResponses.contains(host) { return (202, #"{"started":true,"operationId":"new-operation","status":"GENERATING"}"#) }
            return (202, #"{"started":true,"operationId":"new-operation","courseId":"course"}"#)
        }
        if request.httpMethod == "DELETE" {
            if request.url!.path.hasSuffix("/generation"), request.url!.query != nil {
                let status = removalStatuses[host] ?? 200
                if status != 200 { return (status, #"{"error":"Cleanup is not confirmed."}"#) }
                let acknowledged = cleanupAcknowledged[host] ?? true
                if acknowledged { removed.insert(host) }
                return (200, "{\"cancelled\":false,\"deleted\":\(acknowledged),\"operationId\":\"new-operation\",\"classId\":\"class\"}")
            }
            if request.url!.path == "/api/v1/classes/class" {
                let status = removalStatuses[host] ?? 200
                if status != 200 { return (status, #"{"error":"Removal unavailable."}"#) }
                removed.insert(host)
                return (200, #"{"deleted":true}"#)
            }
            return (200, #"{"cancelled":true}"#)
        }
        let phase = phases[host] ?? "COMPLETED"
        let isPreparing = admitted.contains(host) && ["RUNNING", "REPLACED", "UNAVAILABLE"].contains(phase)
        let attempt = attempts[host] ?? 4
        if request.url?.path == "/api/v1/courses" {
            if removed.contains(host) {
                return (200, #"{"courses":[{"id":"course","nativeLang":"en","targetLang":"de","currentLevel":"A2","startLevel":"A2","classes":[]}]}"#)
            }
            let status = emptyClassStatuses[host] ?? (isPreparing ? "GENERATING" : "AVAILABLE")
            let active = missingActiveClasses.contains(host) ? "null" : "\"class\""
            return (200, """
                {"courses":[{"id":"course","nativeLang":"en","targetLang":"de","currentLevel":"A2","startLevel":"A2","activeClassId":\(active),"classes":[{"id":"class","order":1,"status":"\(status)","attempt":\(attempt),"lesson":{"title":"Everyday German","level":"A2"}}]}]}
                """)
        }
        if request.url?.path.hasSuffix("/generation") == true {
            if phase == "UNAVAILABLE" { return (503, #"{"error":"Progress unavailable."}"#) }
            let operationId = phase == "REPLACED" ? "another-operation" : (admitted.contains(host) ? "new-operation" : "old-operation")
            let initial = initialSources[host].flatMap { try? JSONEncoder().encode($0) }
                .flatMap { String(data: $0, encoding: .utf8) }.map { ",\"initialPreparation\":" + $0 } ?? ""
            return (200, """
                {"operationId":"\(operationId)","operationStatus":"\(phase == "REPLACED" ? "RUNNING" : phase == "STALE_COMPLETED" ? "COMPLETED" : phase == "RETARGETED" ? "FAILED" : phase)","status":"\(isPreparing ? "GENERATING" : phase)","classId":"\(phase == "RETARGETED" ? "other-class" : "class")","stage":"Preparing","detail":"Preparing class material","progress":0.2,"currentStep":1,"totalSteps":6,"sections":[]\(initial)}
                """)
        }
        if request.url?.path == "/api/v1/classes/other-class" {
            return (200, Self.classBody(attempt: 7, status: "AVAILABLE")
                .replacingOccurrences(of: "\"id\":\"class\",\"courseId\"", with: "\"id\":\"other-class\",\"courseId\""))
        }
        if let status = detailStatuses[host], status != 200 { return (status, #"{"error":"Class detail unavailable."}"#) }
        if let status = emptyClassStatuses[host] {
            return (200, """
                {"id":"class","courseId":"course","status":"\(status)","order":1,"passThreshold":0.8,"attempt":\(attempt),"progressRevision":\(attempt),"submitted":\(submittedEmptyClasses.contains(host)),"sections":[]}
                """)
        }
        return (200, Self.classBody(attempt: phase == "STALE_COMPLETED" ? 4 : attempt, status: isPreparing ? "GENERATING" : "AVAILABLE"))
    }

    static func classBody(attempt: Int, status: String) -> String {
        """
        {"id":"class","courseId":"course","status":"\(status)","order":1,"passThreshold":0.8,"attempt":\(attempt),"progressRevision":\(attempt),"learnerAnswers":\(attempt == 4 ? "{\"old-question\":1}" : "{}"),"submitted":false,"sections":[
        {"id":"grammar-\(attempt)","skill":"GRAMMAR","status":"READY","attempt":\(attempt),"questions":[],"prompts":[],"writingPrompts":[]},
        {"id":"reading-\(attempt)","skill":"READING","status":"READY","attempt":\(attempt),"questions":[{"id":"reading-question","order":0,"question":"Where?","options":["Here","There"],"passageText":"We are here."}],"prompts":[],"writingPrompts":[]},
        {"id":"listening-\(attempt)","skill":"LISTENING","status":"READY","attempt":\(attempt),"questions":[],"prompts":[],"writingPrompts":[],"episode":{"id":"episode","status":"READY","title":"A conversation","audioUrl":"/audio.mp3"}},
        {"id":"speaking-\(attempt)","skill":"SPEAKING","status":"READY","attempt":\(attempt),"questions":[],"prompts":[{"id":"speaking-prompt","targetPhrase":"Hallo","translation":"Hello"}],"writingPrompts":[]},
        {"id":"writing-\(attempt)","skill":"WRITING","status":"READY","attempt":\(attempt),"questions":[],"prompts":[],"writingPrompts":[{"id":"writing-prompt","task":"Introduce yourself."}]}
        ]}
        """
    }
}

private final class ClassRegenerationHTTP: URLProtocol {
    private var work: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var capturedRequest = request
        if capturedRequest.httpBody == nil, let stream = capturedRequest.httpBodyStream {
            stream.open()
            var data = Data()
            var bytes = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
            stream.close()
            capturedRequest.httpBody = data
        }
        work = Task {
            let (status, body) = await ClassRegenerationServer.shared.respond(capturedRequest)
            guard !Task.isCancelled else { return }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { work?.cancel() }
}
