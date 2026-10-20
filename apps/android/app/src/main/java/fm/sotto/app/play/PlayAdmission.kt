package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.network.SottoClient
import fm.sotto.app.storage.Admission
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

suspend fun PlayCoordinator.join(settings: Settings, name: String, existing: Boolean) {
    require(settings.valid) { "Choose two different languages." }
    val vault = requireNotNull(state.value.vault)
    val invite = requireNotNull(vault.invitation) { "Open an invitation first." }
    require(vault.admission == null) { "Recover the current request first." }
    val generation = epoch
    val original = vault.connection
    val candidate = if (existing) {
        require(original != null && original.server == invite.server) { "Choose a saved profile on this server first." }
        val profiles = api(original).get<ProfileList>("/api/v1/profiles")
        checkEpoch(generation, original)
        require(profiles.profiles.any { it.id == original.profile.id }) { "This device cannot access that profile." }
        JoinCandidate(CandidateKind.EXISTING, settings, expectedProfileId = original.profile.id)
    } else {
        require(name.trim().length in 1..80) { "Enter your name, up to 80 characters." }
        JoinCandidate(CandidateKind.NEW, settings, name = name.trim(), consentToProfile = true)
    }
    val admission = Admission(invite, JoinCommand(newID(), invite.code, deviceName.take(80), candidate),
        PlayInvitation.proof(), if (existing) original else null)
    persist {
        require(it.admission == null && it.invitation == invite && it.connection == original)
        it.copy(admission = admission)
    }
    retryIntake()
}

internal fun PlayCoordinator.assertExisting(admission: Admission) {
    require(admission.existingConnection == null || admission.existingConnection == state.value.vault?.connection) {
        "Return to the original saved profile to finish this invitation."
    }
}

suspend fun PlayCoordinator.retryIntake() {
    val pending = requireNotNull(state.value.vault?.admission)
    val generation = epoch
    val original = state.value.vault?.connection
    assertExisting(pending)
    val api = pending.existingConnection?.let(::api) ?: SottoClient(pending.invitation.server)
    val value = api.post<JoinStatusView>("/api/v1/play/invitations", pending.command.payload(), pending.proof)
    checkEpoch(generation, original)
    require(state.value.vault?.admission?.command == pending.command)
    mutable.update { it.copy(joinStatus = value.status) }
}

suspend fun PlayCoordinator.finishAdmission() {
    var pending = requireNotNull(state.value.vault?.admission)
    val generation = epoch
    val original = state.value.vault?.connection
    assertExisting(pending)
    if (pending.delivery == null) {
        val api = pending.existingConnection?.let(::api) ?: SottoClient(pending.invitation.server)
        val value = api.post<Delivery>("/api/v1/play/join-requests/${SottoClient.id(pending.command.requestId)}/claim", "{}", pending.proof)
        checkEpoch(generation, original)
        require((value.kind == DeliveryKind.EXISTING) == (pending.command.candidate.kind == CandidateKind.EXISTING))
        pending = pending.copy(delivery = value)
        persist {
            require(it.admission?.command == pending.command)
            it.copy(admission = pending)
        }
    }
    val delivery = requireNotNull(pending.delivery)
    if (delivery.kind == DeliveryKind.EXISTING) {
        require(original != null && delivery.profile.id == original.profile.id)
        val verified = api(original).get<PlayRoom>("/api/v1/play/rooms/${SottoClient.id(delivery.roomId)}")
        checkEpoch(generation, original)
        require(verified.ownMember?.id == delivery.profile.id)
        persist { it.copy(admission = null, invitation = null,
            retainedAdmissions = it.retainedAdmissions.filterNot { value -> value.command.requestId == pending.command.requestId }) }
        moveToRoom(verified)
        return
    }
    val token = requireNotNull(delivery.token)
    require(token.length in 20..512 && delivery.deliveryId != null) { "The server returned an incomplete credential. Retry to recover it." }
    val provisional = Connection(pending.invitation.server, token,
        Profile(delivery.profile.id, delivery.profile.name, false, "USER"))
    val profiles = api(provisional).get<ProfileList>("/api/v1/profiles").profiles
    checkEpoch(generation, original)
    val profile = profiles.singleOrNull()
    require(profile != null && profile.id == delivery.profile.id && !profile.isOwner && profile.role.uppercase() != "ADMIN") {
        "The server did not confirm an isolated learner profile."
    }
    val next = provisional.copy(profile = profile)
    val verified = api(next).get<PlayRoom>("/api/v1/play/rooms/${SottoClient.id(delivery.roomId)}")
    checkEpoch(generation, original)
    require(verified.ownMember?.id == profile.id && verified.ownSeat == Seat.GUEST)
    activate(next)
    val ack = SottoClient(pending.invitation.server).post<kotlinx.serialization.json.JsonObject>(
        "/api/v1/play/join-requests/${SottoClient.id(pending.command.requestId)}/ack",
        buildJsonObject { put("deliveryId", delivery.deliveryId) }.toString(), pending.proof)
    checkEpoch(generation, next)
    require(ack["acknowledged"]?.jsonPrimitive?.content == "true") { "Retry to confirm the saved device credential." }
    persist {
        require(it.admission?.command == pending.command)
        it.copy(admission = null, invitation = null,
            retainedAdmissions = it.retainedAdmissions.filterNot { value -> value.command.requestId == pending.command.requestId })
    }
    moveToRoom(verified)
}

suspend fun PlayCoordinator.discardInvitation() {
    persist {
        require(it.admission?.delivery == null) { "Keep the received credential in saved recoveries first." }
        it.copy(admission = null, invitation = null)
    }
    mutable.update { it.copy(joinStatus = null, screen = Screen.Lobby, preview = null) }
}

suspend fun PlayCoordinator.retainAdmission() {
    val pending = requireNotNull(state.value.vault?.admission)
    require(pending.delivery != null) { "No delivered credential needs separate recovery." }
    persist {
        require(it.admission?.command == pending.command)
        val retained = it.retainedAdmissions.filterNot { old -> old.command.requestId == pending.command.requestId }
        require(retained.size < 16) { "Remove an old recovery before keeping another." }
        it.copy(admission = null, invitation = null, retainedAdmissions = retained + pending)
    }
    mutable.update { it.copy(screen = Screen.Lobby, joinStatus = null, preview = null,
        notice = "The issued credential is kept in saved invitation recoveries.") }
}

suspend fun PlayCoordinator.resumeAdmission(pending: Admission) {
    persist {
        require(it.admission == null) { "Finish the current invitation first." }
        require(pending in it.retainedAdmissions)
        it.copy(admission = pending, invitation = pending.invitation)
    }
    mutable.update { it.copy(screen = Screen.Join, joinStatus = null, preview = null) }
}
