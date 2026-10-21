import Foundation

extension PlayCoordinator {
    func join(settings: PlaySettings, name: String, existing: Bool, acceptedConduct: Bool) async throws {
        guard settings.isValid, let invite = state?.invitation, state?.admission == nil else {
            throw SottoAPIError.message("Choose two different languages and a valid invitation.")
        }
        guard acceptedConduct, policyServer == invite.serverURL, let policy = safetyPolicy else {
            throw SottoAPIError.message("Read and accept this server's game conduct before sharing your name or requesting entry.")
        }
        let connection = model?.credentials
        let generation = epoch
        let candidate: PlayJoinCandidate
        if existing {
            guard let connection, connection.serverURL == invite.serverURL,
                  let profile = connection.selectedProfile else {
                throw SottoAPIError.message("Choose a saved profile on this server first.")
            }
            let profiles = try await client(connection).listProfiles()
            try requireCurrent(generation, connection: connection)
            guard profiles.contains(where: { $0.id == profile.id }) else {
                throw SottoAPIError.message("This device no longer has access to that profile.")
            }
            candidate = PlayJoinCandidate(kind: .existing, expectedProfileId: profile.id,
                name: nil, settings: settings, consentToProfile: nil)
        } else {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= 80 else { throw SottoAPIError.message("Enter your name, up to 80 characters.") }
            candidate = PlayJoinCandidate(kind: .new, expectedProfileId: nil,
                name: trimmed, settings: settings, consentToProfile: true)
        }
        let pending = PlayAdmissionRecovery(invitation: invite,
            command: PlayJoinRequest(requestId: UUID(), code: invite.code,
                deviceName: String(SottoAppModel.deviceName.prefix(80)), candidate: candidate,
                acceptedConductVersion: policy.version),
            proof: try PlayInvitation.newProof(), existingConnection: existing ? connection : nil)
        try save { $0.admission = pending }
        try await retryIntake()
    }

    func retryIntake() async throws {
        guard let pending = state?.admission else { return }
        let generation = epoch
        let connection = model?.credentials
        try assertExisting(pending)
        if pending.command.acceptedConductVersion == nil {
            let result = try await publicClient(pending.invitation).playStatus(pending.command.requestId, proof: pending.proof)
            try requireCurrent(generation, connection: connection)
            joinStatus = result.status
            return
        }
        let api = pending.existingConnection.map(client) ?? publicClient(pending.invitation)
        let result: PlayJoinStatusView = try await api.play("/api/v1/play/invitations",
            body: JSONEncoder().encode(pending.command), proof: pending.proof,
            authorized: pending.existingConnection != nil)
        try requireCurrent(generation, connection: connection)
        guard state?.admission?.command == pending.command else { throw CancellationError() }
        joinStatus = result.status
    }

    func assertExisting(_ pending: PlayAdmissionRecovery) throws {
        if let original = pending.existingConnection, original != model?.credentials {
            throw SottoAPIError.message("Return to the original saved profile to finish this invitation.")
        }
    }

    func finishAdmission() async throws {
        guard var pending = state?.admission else { return }
        guard pending.command.acceptedConductVersion == 1 || pending.conductVersion == 1 else {
            throw SottoAPIError.message("Accept the current game conduct for this saved invitation before continuing.")
        }
        let generation = epoch
        let original = model?.credentials
        try assertExisting(pending)
        if pending.delivery == nil {
            let api = pending.existingConnection.map(client) ?? publicClient(pending.invitation)
            let delivery: PlayDelivery = try await api.play(
                "/api/v1/play/join-requests/\(pending.command.requestId.uuidString)/claim",
                body: Data("{}".utf8), proof: pending.proof, authorized: pending.existingConnection != nil)
            try requireCurrent(generation, connection: original)
            guard (pending.command.candidate.kind == .existing) == (delivery.kind == .existing) else {
                throw SottoAPIError.message("The server returned an unexpected admission type.")
            }
            pending.delivery = delivery
            try save { $0.admission = pending }
        }
        guard let delivery = pending.delivery else { return }
        if delivery.kind == .existing {
            guard let original, delivery.profile.id == original.selectedProfile?.id else {
                throw SottoAPIError.message("This admission belongs to a different profile.")
            }
            let verified = try await client(original).playRoom(delivery.roomId)
            try requireCurrent(generation, connection: original)
            guard verified.ownMember?.id == delivery.profile.id else {
                throw SottoAPIError.message("The server did not confirm your room membership.")
            }
            try save {
                $0.admission = nil; $0.invitation = nil
                $0.retainedAdmissions.removeAll { $0.command.requestId == pending.command.requestId }
            }
            navigate(.room(delivery.roomId))
            apply(verified)
            return
        }
        guard let token = delivery.token, token.count >= 20, token.count <= 512,
              let deliveryID = delivery.deliveryId else {
            throw SottoAPIError.message("The server returned an incomplete device credential. Retry to recover it.")
        }
        let api = SottoAPIClient(serverURL: pending.invitation.serverURL, apiKey: token,
            profileId: delivery.profile.id, session: session)
        let profiles = try await api.listProfiles()
        try requireCurrent(generation, connection: original)
        guard profiles.count == 1, let profile = profiles.first, profile.id == delivery.profile.id,
              !profile.isOwner, profile.role.uppercased() != "ADMIN" else {
            throw SottoAPIError.message("The server did not confirm an isolated learner profile.")
        }
        let verified = try await api.playRoom(delivery.roomId)
        try requireCurrent(generation, connection: original)
        guard verified.ownMember?.id == profile.id, verified.ownSeat == .guest else {
            throw SottoAPIError.message("The server did not confirm your game seat.")
        }
        let next = SottoCredentials(serverURL: pending.invitation.serverURL, apiKey: token,
            user: nil, selectedProfile: profile)
        if let original, original.apiKey != token { try save { try $0.archive(original) } }
        guard let model else { throw CancellationError() }
        clearMemberData()
        boundConnection = next
        do { try model.activatePlayConnection(next, profiles: profiles) }
        catch { boundConnection = original; throw error }
        struct Ack: Encodable { let deliveryId: String }
        struct Acknowledged: Decodable { let acknowledged: Bool }
        let receipt: Acknowledged = try await publicClient(pending.invitation).play(
            "/api/v1/play/join-requests/\(pending.command.requestId.uuidString)/ack",
            body: JSONEncoder().encode(Ack(deliveryId: deliveryID)), proof: pending.proof, authorized: false)
        try requireCurrent(generation, connection: next)
        guard receipt.acknowledged else { throw SottoAPIError.message("Retry to confirm the saved device credential.") }
        try save {
            $0.admission = nil; $0.invitation = nil
            $0.retainedAdmissions.removeAll { $0.command.requestId == pending.command.requestId }
        }
        navigate(.room(delivery.roomId))
        apply(verified)
    }

    func discardInvitation() throws {
        guard state?.admission?.delivery == nil else {
            throw SottoAPIError.message("Finish saving the delivered profile before discarding this invitation.")
        }
        try save { $0.admission = nil; $0.invitation = nil }
        joinStatus = nil
        navigate(.lobby)
    }

    func retainDeliveredInvitation() throws {
        guard let pending = state?.admission, pending.delivery != nil else { return }
        try save {
            guard $0.retainedAdmissions.count < 16 else {
                throw SottoAPIError.message("Remove a saved invitation recovery before keeping another.")
            }
            if !$0.retainedAdmissions.contains(where: { $0.command.requestId == pending.command.requestId }) {
                $0.retainedAdmissions.append(pending)
            }
            $0.admission = nil
            $0.invitation = nil
        }
        navigate(.lobby)
        notice = "The issued credential is kept in saved invitation recoveries. Your saved connections are unchanged."
    }

    func resumeAdmission(_ pending: PlayAdmissionRecovery) throws {
        guard state?.admission == nil else { throw SottoAPIError.message("Finish the current invitation first.") }
        try save { $0.admission = pending; $0.invitation = pending.invitation }
        navigate(.join)
    }

    func switchConnection(_ next: SottoCredentials) async throws {
        let recoveries = [state?.pending, state?.pendingSafety].compactMap { $0 }
        guard recoveries.isEmpty || recoveries.contains(where: { $0.connection == next }) else {
            throw SottoAPIError.message("Recover the pending action or restore its original profile before switching elsewhere.")
        }
        let generation = epoch
        let original = model?.credentials
        let profiles = try await client(next).listProfiles()
        try requireCurrent(generation, connection: original)
        guard let selected = next.selectedProfile, let profile = profiles.first(where: { $0.id == selected.id }) else {
            throw SottoAPIError.message("That saved connection no longer has access to its profile.")
        }
        var verified = next
        let protectedConnections = recoveries.map(\.connection)
            + [state?.admission?.existingConnection].compactMap { $0 }
            + (state?.retainedAdmissions.compactMap(\.existingConnection) ?? [])
        // Revalidate membership while keeping the exact snapshot required by saved requests.
        if !protectedConnections.contains(next) { verified.selectedProfile = profile }
        if verified == original { notice = "You are already using this connection."; return }
        if let original { try save { try $0.archive(original) } }
        try model?.activatePlayConnection(verified, profiles: profiles)
        boundConnection = nil
        navigate(.lobby)
    }

    func acceptSavedAdmissionConduct() async throws {
        guard let pending = state?.admission, let policy = safetyPolicy,
              policyServer == pending.invitation.serverURL else {
            throw SottoAPIError.message("Read the invitation server's current game conduct first.")
        }
        let generation = epoch
        let connection = model?.credentials
        try assertExisting(pending)
        // Read by the original proof. An old unversioned intake is never uploaded again.
        let _: PlayJoinStatusView = try await publicClient(pending.invitation)
            .playStatus(pending.command.requestId, proof: pending.proof)
        try requireCurrent(generation, connection: connection)
        struct Body: Encodable { let version: Int }
        struct Accepted: Decodable { let requestId: UUID; let version: Int }
        let api = pending.existingConnection.map(client) ?? publicClient(pending.invitation)
        let result: Accepted = try await api.play(
            "/api/v1/play/join-requests/\(pending.command.requestId.uuidString)/conduct",
            body: JSONEncoder().encode(Body(version: policy.version)), proof: pending.proof,
            authorized: pending.existingConnection != nil)
        try requireCurrent(generation, connection: connection)
        guard result.requestId == pending.command.requestId, result.version == policy.version,
              state?.admission?.command == pending.command else {
            throw SottoAPIError.message("The server did not confirm conduct for this saved invitation.")
        }
        try save { $0.admission?.conductVersion = result.version }
        notice = "Conduct accepted for this saved invitation."
    }

    func retainUnknownLegacyAdmission() async throws {
        guard let pending = state?.admission, pending.command.acceptedConductVersion == nil,
              pending.delivery == nil, let policy = safetyPolicy, policy.version == 1,
              policyServer == pending.invitation.serverURL else {
            throw SottoAPIError.message("This invitation cannot be replaced. Its recovery is kept.")
        }
        let generation = epoch
        let connection = model?.credentials
        do {
            let _: PlayJoinStatusView = try await publicClient(pending.invitation)
                .playStatus(pending.command.requestId, proof: pending.proof)
            throw SottoAPIError.message("The original request exists. Accept conduct for it instead.")
        } catch SottoAPIError.http(let status, _) where status == 401 || status == 404 {
            try requireCurrent(generation, connection: connection)
        }
        try save {
            guard $0.retainedAdmissions.count < 16 else {
                throw SottoAPIError.message("Remove a saved invitation recovery before keeping another.")
            }
            if !$0.retainedAdmissions.contains(where: { $0.command.requestId == pending.command.requestId }) {
                $0.retainedAdmissions.append(pending)
            }
            $0.admission = nil
        }
        joinStatus = nil
        notice = "The old request and proof are kept in saved recoveries. Submit a new request after accepting conduct."
    }
}
