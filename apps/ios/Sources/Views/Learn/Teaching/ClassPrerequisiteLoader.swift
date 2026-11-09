import Foundation

@MainActor
struct ClassPrerequisiteLoader {
    let detail: SottoClassDetail
    let read: () async throws -> SottoClassPrerequisiteResponse
    let start: (SottoClassPrerequisiteRequest) async throws -> SottoClassPrerequisiteResponse
    let pause: () async throws -> Void
    let timeout: Duration

    init(
        detail: SottoClassDetail,
        read: @escaping () async throws -> SottoClassPrerequisiteResponse,
        start: @escaping (SottoClassPrerequisiteRequest) async throws -> SottoClassPrerequisiteResponse,
        pause: @escaping () async throws -> Void = { try await Task.sleep(for: .seconds(2)) },
        timeout: Duration = .seconds(600)
    ) {
        self.detail = detail
        self.read = read
        self.start = start
        self.pause = pause
        self.timeout = timeout
    }

    func load(
        prepare: Bool,
        update: (SottoClassPrerequisiteResponse) -> Void
    ) async throws -> SottoClassPrerequisiteResponse {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        func accept(_ value: SottoClassPrerequisiteResponse) throws -> SottoClassPrerequisiteResponse {
            try Task.checkCancellation()
            try value.validate(for: detail)
            update(value)
            return value
        }

        var value = try accept(await read())
        if prepare && (value.status == .available ||
            ([.failed, .stale].contains(value.status) && value.canRetry == true)) {
            value = try accept(await start(value.request))
        }
        while value.status == .pending {
            guard ContinuousClock.now < deadline else {
                throw SottoAPIError.message("This is taking longer than expected. Check the saved status.")
            }
            try await pause()
            try Task.checkCancellation()
            if value.recoverable == true {
                value = try accept(await start(value.request))
            } else {
                value = try accept(await read())
            }
        }
        return value
    }

    func acknowledge(
        _ request: SottoClassPrerequisiteAcknowledgment,
        perform: (SottoClassPrerequisiteAcknowledgment) async throws -> SottoClassPrerequisiteResponse,
        update: (SottoClassPrerequisiteResponse) -> Void
    ) async throws -> SottoClassPrerequisiteResponse {
        let value = try await perform(request)
        try Task.checkCancellation()
        try value.validateAcknowledgment(request, for: detail)
        update(value)
        return value
    }
}
