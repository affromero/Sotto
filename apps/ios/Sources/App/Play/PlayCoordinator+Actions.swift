import Foundation

extension PlayCoordinator {
    func discardPendingAction(id: UUID) throws {
        guard !busy, let pending = state?.pending, pending.id == id else {
            throw SottoAPIError.message("The pending action changed. Check its current state before discarding it.")
        }
        try save {
            try $0.archive(pending.connection)
            $0.pending = nil
        }
        notice = "The action may already have saved. Check the game before submitting again. Your draft and original connection are kept."
    }

    func create(kind: PlayKind, theme: PlayTheme, settings: PlaySettings, openQuestions: Bool) async throws {
        guard settings.isValid else { throw SottoAPIError.message("Choose two different languages.") }
        let request = PlayCreateRequest(actionId: UUID(), kind: kind, theme: theme,
            questionStyle: openQuestions ? .open : .choices, settings: settings)
        try await operation(path: "/api/v1/play/rooms", body: request, response: .room)
    }

    func roomAction(_ type: PlayRoomAction, in displayed: PlayRoom) async throws {
        guard let room, room.id == displayed.id, room.round?.id == displayed.round?.id,
              room.status == displayed.status, room.ownSeat == displayed.ownSeat,
              displayed.ownMember?.id == model?.activeProfile?.id,
              displayed.allowedActions.contains(type), room.allowedActions.contains(type) else {
            throw SottoAPIError.message("The game changed. Check the current turn before continuing.")
        }
        try await operation(path: "/api/v1/play/rooms/\(SottoAPIClient.playID(displayed.id))/actions",
            body: PlayActionRequest(actionId: UUID(), expectedRevision: displayed.revision, type: type, command: nil),
            response: .room, baseline: displayed)
    }

    func command(_ command: PlayCommand, in displayed: PlayRoom) async throws {
        guard let room, let before = displayed.round, let current = room.round,
              room.id == displayed.id, current.id == before.id, room.ownSeat == displayed.ownSeat,
              displayed.ownMember?.id == model?.credentials?.selectedProfile?.id,
              before.allowedActions.contains(command.type), current.allowedActions.contains(command.type) else {
            throw SottoAPIError.message("The turn changed. Your draft is still saved for its original turn.")
        }
        try await operation(path: "/api/v1/play/rooms/\(SottoAPIClient.playID(displayed.id))/actions",
            body: PlayActionRequest(actionId: UUID(), expectedRevision: displayed.revision, type: nil, command: command),
            response: .room, baseline: displayed)
    }

    func rotateInvitation() async throws {
        guard let room, room.status == .waiting, room.ownSeat == .host else { return }
        struct Body: Encodable { let actionId: UUID; let expectedRevision: Int }
        try await operation(path: "/api/v1/play/rooms/\(SottoAPIClient.playID(room.id))/invitations",
            body: Body(actionId: UUID(), expectedRevision: room.revision), response: .invitation, baseline: room)
    }

    func approve(_ candidate: PlayPendingRequest, type: PlayApproval) async throws {
        guard candidate.allowedActions.contains(type) else { return }
        struct Body: Encodable { let actionId: UUID; let expectedRevision: Int; let type: PlayApproval }
        try await operation(path: "/api/v1/play/join-requests/\(SottoAPIClient.playID(candidate.requestId))/approve",
            body: Body(actionId: UUID(), expectedRevision: candidate.roomRevision, type: type), response: .approval)
    }

    func operation<Body: Encodable>(path: String, body: Body, response: PlayOperationResponse,
                                  baseline: PlayRoom? = nil) async throws {
        try requireCurrent(epoch, connection: boundConnection)
        guard state?.pending == nil else { throw SottoAPIError.message("Recover the pending action first.") }
        guard let connection = model?.credentials, connection.selectedProfile != nil else {
            throw SottoAPIError.message("Choose a paired learner profile first.")
        }
        let pending = PlayPendingOperation(id: UUID(), connection: connection, path: path,
            body: try JSONEncoder().encode(body), response: response, baseline: baseline, reconciliationUsed: false)
        try save { $0.pending = pending }
        try await retryAction()
    }

    func retryAction() async throws {
        guard let pending = state?.pending else { return }
        let generation = epoch
        guard pending.connection == model?.credentials else {
            throw SottoAPIError.message("Return to the original saved profile to recover this action.")
        }
        let api = client(pending.connection)
        do {
            switch pending.response {
            case .room:
                let value: PlayRoom = try await api.play(pending.path, body: pending.body)
                try requireCurrent(generation, connection: pending.connection)
                try finishOperation(pending)
                if screen != .room(value.id) { navigate(.room(value.id)) }
                apply(value)
            case .invitation:
                let value: PlayInvitationView = try await api.play(pending.path, body: pending.body)
                try requireCurrent(generation, connection: pending.connection)
                try finishOperation(pending)
                invitation = value
            case .approval:
                let _: PlayPendingRequest = try await api.play(pending.path, body: pending.body)
                try requireCurrent(generation, connection: pending.connection)
                try finishOperation(pending)
                notice = "Decision saved."
            case .phrase:
                let value: PlayPhrase = try await api.play(pending.path, body: pending.body)
                try requireCurrent(generation, connection: pending.connection)
                try finishOperation(pending)
                if !phrases.contains(where: { $0.id == value.id }) { phrases.insert(value, at: 0) }
                notice = "Saved privately to your notebook."
            }
        } catch {
            try requireCurrent(generation, connection: pending.connection)
            guard case let SottoAPIError.http(status, _) = error, (400..<500).contains(status), status != 429 else {
                throw error
            }
            if status == 409, try await reconcile(pending, generation: generation) { return }
            if state?.pending?.id == pending.id { try save { $0.pending = nil } }
            if status == 403 {
                do {
                    if let baseline = pending.baseline {
                        let fresh = try await api.playRoom(baseline.id)
                        try requireCurrent(generation, connection: pending.connection)
                        apply(fresh)
                    } else {
                        let _: PlayRoomList = try await api.play("/api/v1/play/rooms?limit=1")
                        try requireCurrent(generation, connection: pending.connection)
                    }
                } catch {
                    try handleMemberFailure(error, generation: generation, connection: pending.connection)
                }
            } else if status == 401 {
                try handleMemberFailure(error, generation: generation, connection: pending.connection)
            }
            throw error
        }
    }

    func finishOperation(_ pending: PlayPendingOperation) throws {
        guard state?.pending?.id == pending.id else { throw CancellationError() }
        try save { next in
            next.pending = nil
            guard let before = pending.baseline, let round = before.round,
                  let request = try? JSONDecoder().decode(PlayActionRequest.self, from: pending.body),
                  let command = request.command else { return }
            let type: PlayActionType
            let text: String
            switch command {
            case let .text(action, value): type = action; text = value
            case let .feedback(_, correction): type = .feedback; text = correction ?? ""
            default: return
            }
            let key = draftKey(room: before, round: round, action: type)
            if next.drafts[key] == text { next.drafts[key] = nil }
        }
    }

    /// A definite revision refusal permits one new independent commit. An
    /// uncertain response always retries the exact saved bytes and action ID.
    func reconcile(_ pending: PlayPendingOperation, generation: UUID) async throws -> Bool {
        guard !pending.reconciliationUsed, pending.response == .room,
              let baseline = pending.baseline, let before = baseline.round,
              let request = try? JSONDecoder().decode(PlayActionRequest.self, from: pending.body),
              let command = request.command,
              [.choose, .answer, .missionDone].contains(command.type) else { return false }
        let refreshed = try await client(pending.connection).playRoom(baseline.id)
        try requireCurrent(generation, connection: pending.connection)
        guard state?.pending?.id == pending.id else { return false }
        apply(refreshed)
        guard refreshed.revision > baseline.revision,
              refreshed.ownSeat == baseline.ownSeat, refreshed.ownMember?.id == baseline.ownMember?.id,
              refreshed.status == .playing, let after = refreshed.round, after.id == before.id,
              after.allowedActions.contains(command.type) else { return false }
        if command.type == .missionDone {
            guard case let .mission(old) = before.content, case let .mission(new) = after.content,
                  old.ownObjective == new.ownObjective, old.twist == new.twist,
                  old.messages == new.messages, before.hints == after.hints else { return false }
        }
        let retry = PlayActionRequest(actionId: UUID(), expectedRevision: refreshed.revision, type: nil, command: command)
        let replacement = PlayPendingOperation(id: UUID(), connection: pending.connection, path: pending.path,
            body: try JSONEncoder().encode(retry), response: .room, baseline: refreshed, reconciliationUsed: true)
        try save { $0.pending = replacement }
        apply(refreshed)
        try await retryAction()
        return true
    }

    func draftKey(room: PlayRoom, round: PlayRound, action: PlayActionType) -> String {
        let ownCount: Int
        if case let .mission(mission) = round.content { ownCount = mission.messages.filter { $0.seat == room.ownSeat }.count }
        else { ownCount = 0 }
        return "\(model?.credentials?.serverURL.absoluteString ?? "")/\(room.ownMember?.id ?? "")/\(room.id)/\(round.id)/\(round.phase.rawValue)/\(action.rawValue)/\(ownCount)"
    }

    func saveDraft(_ text: String, key: String) {
        do {
            try save {
                if text.isEmpty { $0.drafts[key] = nil }
                else { $0.drafts[key] = String(text.prefix(500)) }
            }
        } catch { report(error) }
    }
}
