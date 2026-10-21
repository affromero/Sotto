import Foundation

extension PlayCoordinator {
    var safetyServer: URL? {
        if screen == .join {
            return (state?.admission?.invitation ?? state?.invitation)?.serverURL ?? model?.credentials?.serverURL
        }
        return model?.credentials?.serverURL
    }

    var conductAccepted: Bool {
        policyServer == model?.credentials?.serverURL && safetyStatus?.profileId == model?.credentials?.selectedProfile?.id
            && safetyStatus?.acceptedVersion == safetyPolicy?.version && safetyPolicy != nil
    }

    var sharingAllowed: Bool { conductAccepted && safetyStatus?.sharingRestricted == false }
    var gameControlsDisabled: Bool { busy || safetyBusy || state?.pending != nil || state?.pendingSafety != nil || !sharingAllowed }

    func loadSafetyPolicy(generation: UUID) async throws {
        guard let server = safetyServer else { return }
        if policyServer == server, safetyPolicy != nil { return }
        let connection = model?.credentials
        let api = SottoAPIClient(serverURL: server, apiKey: nil, session: session)
        let value: PlaySafetyPolicy = try await api.play("/api/v1/play/policy", authorized: false)
        try requireCurrent(generation, connection: connection)
        guard safetyServer == server else { throw CancellationError() }
        try value.validate()
        if policyServer != server { safetyStatus = nil }
        policyServer = server
        safetyPolicy = value
    }

    func loadSafetyStatus(generation: UUID, connection: SottoCredentials) async throws {
        guard connection.serverURL == safetyServer else { return }
        let value: PlaySafetyStatus = try await client(connection).play("/api/v1/play/safety")
        try requireCurrent(generation, connection: connection)
        guard value.profileId == connection.selectedProfile?.id,
              (value.acceptedVersion == nil) == (value.acceptedAt == nil) else {
            throw SottoAPIError.message("The server returned safety settings for a different profile.")
        }
        safetyStatus = value
    }

    func refreshSafetyLists(generation: UUID, connection: SottoCredentials) async throws {
        let api = client(connection)
        let blocked: PlayBlockList = try await api.play("/api/v1/play/safety/blocks")
        try requireCurrent(generation, connection: connection)
        let reports: PlaySafetyReportList = try await api.play("/api/v1/play/safety/reports")
        try requireCurrent(generation, connection: connection)
        blocks = blocked.blocks + olderBlocks.filter { older in !blocked.blocks.contains(where: { $0.id == older.id }) }
        if !openedOlderBlocks { blocksCursor = blocked.nextCursor }
        safetyReports = reports.reports + olderSafetyReports.filter { older in !reports.reports.contains(where: { $0.id == older.id }) }
        if !openedOlderSafetyReports { safetyReportsCursor = reports.nextCursor }
    }

    func loadOlderSafety(blocked: Bool) async throws {
        guard let connection = model?.credentials,
              let cursor = blocked ? blocksCursor : safetyReportsCursor else { return }
        let generation = epoch
        let path = "/api/v1/play/safety/\(blocked ? "blocks" : "reports")?beforeId=\(try SottoAPIClient.playID(cursor))"
        if blocked {
            let result: PlayBlockList = try await client(connection).play(path)
            try requireCurrent(generation, connection: connection)
            let added = result.blocks.filter { item in !blocks.contains(where: { $0.id == item.id }) }
            olderBlocks += added
            blocks += added
            openedOlderBlocks = true
            blocksCursor = result.nextCursor
        } else {
            let result: PlaySafetyReportList = try await client(connection).play(path)
            try requireCurrent(generation, connection: connection)
            let added = result.reports.filter { item in !safetyReports.contains(where: { $0.id == item.id }) }
            olderSafetyReports += added
            safetyReports += added
            openedOlderSafetyReports = true
            safetyReportsCursor = result.nextCursor
        }
    }

    /// Safety has its own durable slot so an uncertain turn never prevents blocking or reporting.
    func runSafety(_ action: @escaping @MainActor () async throws -> Void) {
        guard active, !accessRevoked, !safetyBusy, state != nil,
              boundConnection == model?.credentials else { return }
        let previous = work
        let polling = pollingWork
        previous?.cancel()
        polling?.cancel()
        let earlier = drainingWork
        releasePresence()
        let release = presenceRelease
        safetyBusy = true
        busy = false
        error = nil
        let generation = epoch
        let invocation = UUID()
        actionGeneration = invocation
        work = Task { [weak self] in
            await earlier?.value
            await previous?.value
            _ = try? await polling?.value
            await release?.value
            guard let self, self.current(generation, connection: self.boundConnection) else { return }
            defer {
                if self.epoch == generation, self.actionGeneration == invocation {
                    self.safetyBusy = false; self.work = nil
                }
            }
            do { try await action() }
            catch {
                if self.epoch == generation, self.actionGeneration == invocation {
                    if let connection = self.model?.credentials {
                        do { try self.handleMemberFailure(error, generation: generation, connection: connection) }
                        catch { self.report(error) }
                    } else { self.report(error) }
                }
            }
        }
    }

    func acceptConduct() async throws {
        guard let policy = safetyPolicy, policyServer == model?.credentials?.serverURL else {
            throw SottoAPIError.message("Read this server's conduct policy before accepting it.")
        }
        try await operation(path: "/api/v1/play/safety/conduct",
            body: PlayConductRequest(actionId: UUID(), version: policy.version), response: .safety, slot: .safety)
    }

    func showReport(for value: PlayRoom) {
        guard value.ownMember?.id == model?.credentials?.selectedProfile?.id, !value.reportOptions.isEmpty else { return }
        reportRoom = value
        navigate(.report)
    }

    func blockPartner(in value: PlayRoom) async throws {
        guard value.ownMember?.id == model?.credentials?.selectedProfile?.id, value.guest != nil else {
            throw SottoAPIError.message("Open your game before blocking its partner.")
        }
        struct Body: Encodable { let actionId: UUID }
        try await operation(path: "/api/v1/play/rooms/\(SottoAPIClient.playID(value.id))/block",
            body: Body(actionId: UUID()), response: .safety, slot: .safety)
    }

    func unblock(_ value: PlayBlock) async throws {
        guard blocks.contains(value) else { throw SottoAPIError.message("Refresh your block list before continuing.") }
        struct Body: Encodable { let actionId: UUID }
        try await operation(path: "/api/v1/play/safety/blocks/\(SottoAPIClient.playID(value.id))/unblock",
            body: Body(actionId: UUID()), response: .safety, slot: .safety)
    }

    func sendReport(option: PlayReportOption, category: PlayReportCategory, detail: String) async throws {
        guard let value = reportRoom, value.ownMember?.id == model?.credentials?.selectedProfile?.id,
              value.reportOptions.contains(option), detail.count <= 1000 else {
            throw SottoAPIError.message("Select content visible in your game and keep the explanation under 1,000 characters.")
        }
        try await operation(path: "/api/v1/play/rooms/\(SottoAPIClient.playID(value.id))/reports",
            body: PlayReportRequest(actionId: UUID(), category: category, detail: detail,
                selector: option.selector, expectedVisibleText: option.text), response: .safety, slot: .safety)
    }

    func clearGameCache() {
        releasePresence()
        room = nil
        rooms = []
        olderRooms = []
        openedOlderRooms = false
        roomsCursor = nil
        invitation = nil
        requests = []
    }

    func resetSafetyPages() {
        olderBlocks = []
        olderSafetyReports = []
        openedOlderBlocks = false
        openedOlderSafetyReports = false
        blocksCursor = nil
        safetyReportsCursor = nil
    }

    func discardSafetyAction(id: UUID) throws {
        guard !safetyBusy, let pending = state?.pendingSafety, pending.id == id else {
            throw SottoAPIError.message("The saved safety action changed. Check its current state first.")
        }
        try save { try $0.archive(pending.connection); $0.pendingSafety = nil }
        notice = "The safety action may already have saved. Check your blocks and reports before submitting again."
    }
}
