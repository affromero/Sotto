import Foundation

extension PlayCoordinator {
    func foreground() async {
        guard !Task.isCancelled else { return }
        endForeground()
        active = true
        accessRevoked = false
        ownerCapability = nil
        let generation = epoch
        let connection = model?.credentials
        if boundConnection != connection {
            clearMemberData()
        }
        boundConnection = connection
        defer { if epoch == generation { endForeground() } }
        var failures = 0
        while current(generation, connection: boundConnection), !accessRevoked {
            do {
                let poll = Task { try await self.refresh(generation) }
                pollingWork = poll
                try await poll.value
                pollingWork = nil
                failures = 0
            } catch {
                guard epoch == generation else { return }
                report(error)
                failures = min(failures + 1, 4)
            }
            do { try await Task.sleep(for: .seconds(failures == 0 ? 2 : min(16, 1 << failures))) }
            catch { return }
        }
    }

    func endForeground() {
        active = false
        epoch = UUID()
        let previous = work
        let polling = pollingWork
        polling?.cancel()
        pollingWork = nil
        previous?.cancel()
        if previous != nil || polling != nil {
            let earlier = drainingWork
            let drain = UUID()
            drainGeneration = drain
            drainingWork = Task { [weak self] in
                await earlier?.value
                await previous?.value
                _ = try? await polling?.value
                if self?.drainGeneration == drain { self?.drainingWork = nil }
            }
        }
        work = nil
        actionGeneration = UUID()
        busy = false
        safetyBusy = false
        releasePresence()
    }

    func releasePresence() {
        let previous = lease
        lease = nil
        leaseReady = false
        if let previous {
            let earlier = presenceRelease
            presenceRelease = Task {
                await earlier?.value
                do { _ = try await previous.client.playPresence(previous.roomID, nonce: previous.nonce, release: true) }
                catch { /* The server's bounded lease also expires after disconnection. */ }
            }
        }
    }

    func renewPresence(_ value: PlayRoom, client: SottoAPIClient, generation: UUID) async throws {
        guard value.ownSeat == .host, value.status == .waiting else { releasePresence(); return }
        if lease?.roomID != value.id {
            releasePresence()
            lease = (value.id, try PlayInvitation.newProof(), .distantPast, client)
        }
        guard let currentLease = lease, Date().timeIntervalSince(currentLease.renewed) >= 5 else { return }
        do {
            let response = try await client.playPresence(value.id, nonce: currentLease.nonce, release: false)
            try requireCurrent(generation, connection: boundConnection)
            guard lease?.nonce == currentLease.nonce else { return }
            lease?.renewed = Date()
            leaseReady = response.hostWaiting
        } catch {
            if lease?.nonce == currentLease.nonce { leaseReady = false }
            throw error
        }
    }

    func refresh(_ generation: UUID) async throws {
        let connection = model?.credentials
        guard !safetyBusy, state?.pendingSafety == nil else { releasePresence(); return }
        try await loadSafetyPolicy(generation: generation)
        if let connection, connection.selectedProfile != nil {
            do { try await loadSafetyStatus(generation: generation, connection: connection) }
            catch { try handleMemberFailure(error, generation: generation, connection: connection) }
        }
        switch screen {
        case .join:
            guard let invite = state?.admission?.invitation ?? state?.invitation else { return }
            if let pending = state?.admission {
                let result = try await publicClient(invite).playStatus(pending.command.requestId, proof: pending.proof)
                try requireCurrent(generation, connection: connection)
                joinStatus = result.status
            } else if preview == nil {
                let result = try await publicClient(invite).playPreview(invite.code)
                try requireCurrent(generation, connection: connection)
                preview = result
            }
        case .lobby:
            guard let connection, connection.selectedProfile != nil else { return }
            let api = client(connection)
            do {
                let result: PlayRoomList = try await api.play("/api/v1/play/rooms")
                try requireCurrent(generation, connection: connection)
                rooms = result.rooms + olderRooms.filter { older in !result.rooms.contains(where: { $0.id == older.id }) }
                if !openedOlderRooms { roomsCursor = result.nextCursor }
                if ownerCapability != false {
                    do {
                        let pending: PlayPendingList = try await api.play("/api/v1/play/enrollments")
                        try requireCurrent(generation, connection: connection)
                        ownerCapability = true
                        requests = pending.requests
                    } catch SottoAPIError.http(403, _) {
                        try requireCurrent(generation, connection: connection)
                        ownerCapability = false
                        requests = []
                    }
                }
            } catch { try handleMemberFailure(error, generation: generation, connection: connection) }
        case let .room(id):
            guard let connection, connection.selectedProfile != nil else { return }
            let api = client(connection)
            do {
                let value = try await api.playRoom(id)
                try requireCurrent(generation, connection: connection)
                guard screen == .room(id) else { return }
                guard apply(value) else { return }
                try await renewPresence(value, client: api, generation: generation)
                guard screen == .room(id), room == value else { return }
                if value.status == .waiting, value.ownSeat == .host {
                    let previousGeneration = invitation?.generation
                    let link: PlayInvitationView? = try await api.play("/api/v1/play/rooms/\(SottoAPIClient.playID(id))/invitations")
                    try requireCurrent(generation, connection: connection)
                    guard screen == .room(id), room == value else { return }
                    if let link, link.generation >= (invitation?.generation ?? 0) { invitation = link }
                    else if link == nil, invitation?.generation == previousGeneration { invitation = nil }
                    let pending: PlayPendingList = try await api.play("/api/v1/play/rooms/\(SottoAPIClient.playID(id))/join-requests")
                    try requireCurrent(generation, connection: connection)
                    guard screen == .room(id), room == value else { return }
                    requests = pending.requests
                }
            } catch { try handleMemberFailure(error, generation: generation, connection: connection) }
        case .notebook:
            guard let connection else { return }
            do {
                if phrases.isEmpty { try await loadPhrases() }
                else {
                    let _: PlayPhraseList = try await client(connection).play("/api/v1/play/phrases?limit=1")
                    try requireCurrent(generation, connection: connection)
                }
            } catch { try handleMemberFailure(error, generation: generation, connection: connection) }
        case .safety:
            guard let connection, connection.selectedProfile != nil else { return }
            try await refreshSafetyLists(generation: generation, connection: connection)
        case .report: break
        }
    }

    func handleMemberFailure(_ error: Error, generation: UUID, connection: SottoCredentials) throws {
        try requireCurrent(generation, connection: connection)
        if let failure = error as? PlaySafetyFailure, failure.reason == .unavailable {
            clearGameCache()
            gameUnavailable = true
        }
        if case let SottoAPIError.http(status, _) = error, status == 401 || status == 403 {
            self.error = error.localizedDescription
            endForeground()
            accessRevoked = true
            clearMemberData()
        }
        throw error
    }
}
