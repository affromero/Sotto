package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.network.ApiError
import fm.sotto.app.network.SottoClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal data class Lease(val roomID: String, val nonce: String, val client: SottoClient, val renewed: Long = 0)
internal data class DeferredConfirmation(
    val id: String, val epoch: Long, val screen: Screen, val connection: Connection?, val expires: Long,
    val action: suspend PlayCoordinator.() -> Unit,
)

fun PlayCoordinator.setForeground(value: Boolean) {
    if (!value) clearConfirmation()
    if (foreground == value) return
    val pending = confirmation
    val valid = pending != null && pending.epoch == epoch && pending.screen == state.value.screen &&
        pending.connection == state.value.vault?.connection && System.nanoTime() <= pending.expires
    confirmation = null
    stopLifetime()
    foreground = value
    mutable.update { it.copy(active = value) }
    if (value) {
        startLifetime()
        if (valid) run(requireNotNull(pending).action)
        else if (pending != null) mutable.update { it.copy(notice = "The confirmation changed. Please confirm again.") }
    }
}

internal fun PlayCoordinator.stopLifetime(cancelWork: Boolean = true) {
    clearConfirmation()
    epoch++
    polling?.cancel(); polling = null
    if (cancelWork) { work?.cancel(); work = null }
    mutable.update { it.copy(busy = false, checking = false) }
    releasePresence()
}

internal fun PlayCoordinator.startLifetime() {
    val generation = epoch
    val restoreInvitation = state.value.vault == null
    mutable.update { it.copy(accessRevoked = false, owner = null, checking = true) }
    polling = scope.launch {
        try {
            publish(store.load())
            checkEpoch(generation)
            if (restoreInvitation && (state.value.vault?.admission != null || state.value.vault?.invitation != null))
                mutable.update { if (it.screen == Screen.Lobby) it.copy(screen = Screen.Join) else it }
            var failures = 0
            while (isActive && epoch == generation && !state.value.accessRevoked) {
                try { refresh(generation); failures = 0 }
                catch (_: CancellationException) { return@launch }
                catch (error: Exception) { if (epoch == generation) report(error); failures = minOf(failures + 1, 4) }
                if (epoch == generation) mutable.update { it.copy(checking = false) }
                delay(if (failures == 0) 2000 else minOf(16, 1 shl failures) * 1000L)
            }
        } catch (_: CancellationException) { }
        catch (error: Exception) { if (epoch == generation) { report(error); mutable.update { it.copy(checking = false) } } }
    }
}

internal fun PlayCoordinator.releasePresence() {
    val before = lease
    lease = null
    mutable.update { it.copy(leaseReady = false) }
    if (before != null) scope.launch {
        try { withTimeout(5000) {
            before.client.raw("/api/v1/play/rooms/${SottoClient.id(before.roomID)}/presence",
                buildJsonObject { put("type", "RELEASE"); put("viewNonce", before.nonce) }.toString())
        } } catch (_: Exception) { /* The bounded server lease also expires after disconnection. */ }
    }
}

internal suspend fun PlayCoordinator.renewPresence(room: PlayRoom, generation: Long, connection: Connection) {
    if (room.ownSeat != Seat.HOST || room.status != RoomStatus.WAITING) { releasePresence(); return }
    if (lease?.roomID != room.id) {
        releasePresence()
        lease = Lease(room.id, PlayInvitation.proof(), api(connection))
    }
    val current = requireNotNull(lease)
    val now = System.nanoTime()
    if (current.renewed != 0L && now - current.renewed < 5_000_000_000L) return
    try {
        val value = current.client.post<Presence>("/api/v1/play/rooms/${SottoClient.id(room.id)}/presence",
            buildJsonObject { put("type", "RENEW"); put("viewNonce", current.nonce) }.toString())
        checkEpoch(generation, connection)
        if (lease?.nonce == current.nonce) {
            lease = current.copy(renewed = now)
            mutable.update { it.copy(leaseReady = value.hostWaiting) }
        }
    } catch (error: Exception) {
        if (lease?.nonce == current.nonce) mutable.update { it.copy(leaseReady = false) }
        throw error
    }
}

internal suspend fun PlayCoordinator.refresh(generation: Long) {
    val connection = state.value.vault?.connection
    val screen = state.value.screen
    fun current() { checkEpoch(generation, connection); if (screen != state.value.screen) throw CancellationException() }
    if (screen == Screen.Join) {
        val admission = state.value.vault?.admission
        val invite = admission?.invitation ?: state.value.vault?.invitation ?: return
        val public = SottoClient(invite.server)
        if (admission != null) {
            val value = public.get<JoinStatusView>("/api/v1/play/join-requests/${SottoClient.id(admission.command.requestId)}", admission.proof)
            current(); mutable.update { it.copy(joinStatus = value.status) }
        } else if (state.value.preview == null) {
            val value = public.get<Preview>("/api/v1/play/invitations?code=${invite.code}")
            current(); mutable.update { it.copy(preview = value) }
        }
        return
    }
    if (connection == null) return
    try {
        when (screen) {
            Screen.Lobby -> {
                val value = api(connection).get<RoomList>("/api/v1/play/rooms")
                current()
                mutable.update { it.copy(rooms = value.rooms + olderRooms.filter { old -> value.rooms.none { it.id == old.id } },
                    roomsCursor = if (olderRoomsOpened) it.roomsCursor else value.nextCursor) }
                if (state.value.owner != false) {
                    try {
                        val pending = api(connection).get<PendingList>("/api/v1/play/enrollments")
                        current(); mutable.update { it.copy(owner = true, requests = pending.requests) }
                    } catch (error: ApiError) {
                        current()
                        if (error.status != 403) throw error
                        mutable.update { it.copy(owner = false, requests = emptyList()) }
                    }
                }
            }
            is Screen.Room -> {
                val path = "/api/v1/play/rooms/${SottoClient.id(screen.id)}"
                val value = api(connection).get<PlayRoom>(path)
                current()
                require(value.ownMember?.id == connection.profile.id) { "The server returned another profile's room." }
                if (!applyRoom(value)) return
                renewPresence(value, generation, connection)
                current()
                if (state.value.room != value) return
                if (value.status == RoomStatus.WAITING && value.ownSeat == Seat.HOST) {
                    val previous = state.value.invitation?.generation
                    val link = api(connection).get<InvitationView?>("$path/invitations")
                    current()
                    if (state.value.room != value) return
                    mutable.update {
                        if (link != null && link.generation >= (it.invitation?.generation ?: 0)) it.copy(invitation = link)
                        else if (link == null && previous == it.invitation?.generation) it.copy(invitation = null) else it
                    }
                    val pending = api(connection).get<PendingList>("$path/join-requests")
                    current()
                    if (state.value.room != value) return
                    mutable.update { it.copy(requests = pending.requests) }
                }
            }
            Screen.Notebook -> {
                if (state.value.phrases.isEmpty()) loadPhrases()
                else { api(connection).get<PhraseList>("/api/v1/play/phrases?limit=1"); current() }
            }
            else -> Unit
        }
    } catch (error: Exception) { memberFailure(error, generation, connection) }
}

internal fun PlayCoordinator.memberFailure(error: Exception, generation: Long, connection: Connection): Nothing {
    checkEpoch(generation, connection)
    if (error is ApiError && error.status in listOf(401, 403)) {
        stopLifetime()
        clearMemberData()
        mutable.update { it.copy(accessRevoked = true, error = error.message) }
    }
    throw error
}
