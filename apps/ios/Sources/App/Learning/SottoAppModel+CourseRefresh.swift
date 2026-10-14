import Foundation

struct SottoLearnerIdentity: Hashable {
    let serverURL: URL
    let apiKey: String?
    let profileId: String?

    init(_ client: SottoAPIClient) {
        serverURL = client.serverURL
        apiKey = client.apiKey
        profileId = client.profileId
    }
}

struct SottoCourseRefreshRequest {
    let id = UUID()
    let task: Task<[SottoCourse], Error>
}

extension SottoAppModel {
    var courseRefreshIdentity: SottoLearnerIdentity? {
        makeClient().map(SottoLearnerIdentity.init)
    }

    func loadCourses(showLoading: Bool = true) async {
        guard hasSelectedProfile, let client = makeClient() else { return }
        let identity = SottoLearnerIdentity(client)
        if showLoading {
            isLoading = true
            errorMessage = nil
        }
        defer { if showLoading, isCurrentLearningClient(client) { isLoading = false } }
        let request: SottoCourseRefreshRequest
        let ownsTask = courseRefreshTasks[identity] == nil
        if let existing = courseRefreshTasks[identity] { request = existing }
        else {
            request = SottoCourseRefreshRequest(task: Task { try await client.listCourses() })
            courseRefreshTasks[identity] = request
        }
        defer {
            if ownsTask, courseRefreshTasks[identity]?.id == request.id { courseRefreshTasks[identity] = nil }
        }
        do {
            let refreshed = try await request.task.value
            try Task.checkCancellation()
            if request.task.isCancelled { throw CancellationError() }
            guard isCurrentLearningClient(client) else { return }
            applyCourseRefresh(refreshed)
            courseRefreshError = nil
        } catch {
            guard isCurrentLearningClient(client), !(error is CancellationError),
                  (error as? URLError)?.code != .cancelled else { return }
            courseRefreshError = "Could not refresh courses. Showing the last loaded data."
            if showLoading { report(error) }
        }
    }
}
