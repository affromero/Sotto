import Foundation

@MainActor
struct ClassPreludeLoader {
    let read: () async throws -> SottoClassPrelude
    let prepare: (SottoClassPrerequisiteRequest, Bool) async throws -> SottoClassPrelude
    let acknowledge: (SottoClassPreludeAcknowledgment) async throws -> Void
    let isCurrent: () -> Bool
    let pause: () async throws -> Void
    let timeout: Duration

    init(
        read: @escaping () async throws -> SottoClassPrelude,
        prepare: @escaping (SottoClassPrerequisiteRequest, Bool) async throws -> SottoClassPrelude,
        acknowledge: @escaping (SottoClassPreludeAcknowledgment) async throws -> Void,
        isCurrent: @escaping () -> Bool,
        pause: @escaping () async throws -> Void = { try await Task.sleep(for: .seconds(2)) },
        timeout: Duration = .seconds(600)
    ) {
        self.read = read
        self.prepare = prepare
        self.acknowledge = acknowledge
        self.isCurrent = isCurrent
        self.pause = pause
        self.timeout = timeout
    }

    private func requireCurrent() throws {
        try Task.checkCancellation()
        guard isCurrent() else { throw CancellationError() }
    }

    private func accept(_ value: SottoClassPrelude) throws -> SottoClassPrelude {
        try requireCurrent()
        try value.validate()
        return value
    }

    func load(update: (SottoClassPrelude) -> Void) async throws -> SottoClassPrelude {
        try requireCurrent()
        return try await settle(accept(await read()), update: update)
    }

    func start(displayed: SottoClassPrelude, update: (SottoClassPrelude) -> Void) async throws -> SottoClassPrelude {
        let displayed = try accept(displayed)
        guard displayed.kind == .addendum, let request = displayed.request,
              displayed.status == .available ||
                ([.failed, .stale].contains(displayed.status) && displayed.canRetry == true) else {
            throw SottoAPIError.message("The lesson changed. Check saved status.")
        }
        let current = try accept(await read())
        guard current.kind == displayed.kind, current.status == displayed.status,
              current.request == request, current.canRetry == displayed.canRetry else {
            throw SottoAPIError.message("The lesson changed. Check saved status.")
        }
        return try await settle(accept(await prepare(request, false)), update: update)
    }

    func acknowledge(displayed: SottoClassPrelude) async throws -> SottoClassPrelude {
        let displayed = try accept(displayed)
        guard [.base, .addendum].contains(displayed.kind), let receiptId = displayed.receiptId,
              displayed.acknowledged == false else {
            throw SottoAPIError.message("The lesson changed. Check saved status.")
        }
        let request = SottoClassPreludeAcknowledgment(kind: displayed.kind.rawValue, receiptId: receiptId)
        try await acknowledge(request)
        try Task.checkCancellation()
        guard isCurrent() else { throw CancellationError() }
        let current = try accept(await read())
        guard current.kind == displayed.kind, current.receiptId == receiptId, current.acknowledged == true else {
            throw SottoAPIError.message("The lesson changed. Check saved status.")
        }
        return current
    }

    private func settle(_ initial: SottoClassPrelude, update: (SottoClassPrelude) -> Void) async throws -> SottoClassPrelude {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        var value = try accept(initial)
        while true {
            update(value)
            guard value.kind == .generating || (value.kind == .addendum && value.status == .pending) else { return value }
            guard ContinuousClock.now < deadline else {
                throw SottoAPIError.message("This is taking longer than expected. Check saved status.")
            }
            try await pause()
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
            if value.kind == .addendum, value.recoverable == true, let request = value.request {
                value = try accept(await prepare(request, true))
            } else {
                value = try accept(await read())
            }
        }
    }
}
