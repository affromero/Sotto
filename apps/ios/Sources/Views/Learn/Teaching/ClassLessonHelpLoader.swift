import Foundation

@MainActor
struct ClassLessonHelpLoader {
    let teaching: SottoClassTeaching
    let read: () async throws -> SottoClassLessonHelpResponse
    let start: (SottoClassLessonHelpRequest) async throws -> SottoClassLessonHelpResponse
    let pause: () async throws -> Void
    let timeout: Duration

    init(
        teaching: SottoClassTeaching,
        read: @escaping () async throws -> SottoClassLessonHelpResponse,
        start: @escaping (SottoClassLessonHelpRequest) async throws -> SottoClassLessonHelpResponse,
        pause: @escaping () async throws -> Void = { try await Task.sleep(for: .seconds(2)) },
        timeout: Duration = .seconds(600)
    ) {
        self.teaching = teaching
        self.read = read
        self.start = start
        self.pause = pause
        self.timeout = timeout
    }

    func load(
        retry: Bool,
        update: (SottoClassLessonHelpResponse) -> Void
    ) async throws -> SottoClassLessonHelpResponse {
        let deadline = ContinuousClock.now.advanced(by: timeout)

        func accept(_ value: SottoClassLessonHelpResponse) throws -> SottoClassLessonHelpResponse {
            try Task.checkCancellation()
            try value.validate(for: teaching)
            update(value)
            return value
        }

        var value = try accept(await read())
        if value.status == .available || (retry && value.canRetry) {
            value = try accept(await start(value.request))
        }
        while value.status == .pending {
            guard ContinuousClock.now < deadline else {
                throw SottoAPIError.message("Language help is taking longer than expected. Check its saved status.")
            }
            try await pause()
            try Task.checkCancellation()
            value = try accept(await read())
        }
        return value
    }
}
