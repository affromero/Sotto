package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.network.ApiError
import fm.sotto.app.network.SottoClient
import fm.sotto.app.storage.*
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*

suspend fun PlayCoordinator.create(kind: GameKind, theme: Theme, settings: Settings, open: Boolean) {
    require(settings.valid) { "Choose two different languages." }
    operation("/api/v1/play/rooms", buildJsonObject {
        put("actionId", newID()); put("kind", kind.name); put("theme", theme.name)
        put("questionStyle", if (open) "OPEN" else "CHOICES")
        put("settings", SottoJson.encodeToJsonElement(settings))
    }.toString(), OperationResponse.ROOM)
}

suspend fun PlayCoordinator.roomAction(type: RoomAction, displayed: PlayRoom) {
    val room = requireNotNull(state.value.room)
    require(room.id == displayed.id && room.round?.id == displayed.round?.id && room.status == displayed.status &&
        room.ownSeat == displayed.ownSeat && displayed.ownMember?.id == state.value.vault?.connection?.profile?.id &&
        type in displayed.allowedActions && type in room.allowedActions) { "The game changed. Check the current turn." }
    operation("/api/v1/play/rooms/${SottoClient.id(room.id)}/actions", buildJsonObject {
        put("actionId", newID()); put("expectedRevision", displayed.revision); put("type", type.name)
    }.toString(), OperationResponse.ROOM, displayed)
}

suspend fun PlayCoordinator.command(command: Command, displayed: PlayRoom) {
    val room = requireNotNull(state.value.room)
    val before = requireNotNull(displayed.round)
    val current = requireNotNull(room.round)
    require(room.id == displayed.id && before.id == current.id && room.ownSeat == displayed.ownSeat &&
        displayed.ownMember?.id == state.value.vault?.connection?.profile?.id &&
        command.type in before.header.allowedActions && command.type in current.header.allowedActions) {
        "The turn changed. Your draft is still saved for its original turn."
    }
    operation("/api/v1/play/rooms/${SottoClient.id(room.id)}/actions", actionBody(displayed.revision, command),
        OperationResponse.ROOM, displayed)
}

private fun actionBody(revision: Int, command: Command): String = buildJsonObject {
    put("actionId", newID()); put("expectedRevision", revision); put("command", command.payload())
}.toString()

suspend fun PlayCoordinator.rotateInvitation() {
    val room = requireNotNull(state.value.room)
    require(room.status == RoomStatus.WAITING && room.ownSeat == Seat.HOST)
    operation("/api/v1/play/rooms/${SottoClient.id(room.id)}/invitations", buildJsonObject {
        put("actionId", newID()); put("expectedRevision", room.revision)
    }.toString(), OperationResponse.INVITATION, room)
}

suspend fun PlayCoordinator.approve(candidate: PendingRequest, type: Approval) {
    require(type in candidate.allowedActions)
    operation("/api/v1/play/join-requests/${SottoClient.id(candidate.requestId)}/approve", buildJsonObject {
        put("actionId", newID()); put("expectedRevision", candidate.roomRevision); put("type", type.name)
    }.toString(), OperationResponse.APPROVAL)
}

internal suspend fun PlayCoordinator.operation(path: String, body: String, response: OperationResponse, baseline: PlayRoom? = null) {
    val connection = requireNotNull(state.value.vault?.connection) { "Pair with a learner profile first." }
    checkEpoch(epoch, connection)
    val pending = PendingOperation(newID(), connection, path, body, response, baseline)
    persist {
        require(it.pending == null && it.connection == connection) { "Recover the pending action first." }
        it.copy(pending = pending)
    }
    retryAction()
}

suspend fun PlayCoordinator.retryAction() {
    val pending = requireNotNull(state.value.vault?.pending)
    val generation = epoch
    require(pending.connection == state.value.vault?.connection) { "Restore the original saved profile to recover this action." }
    try {
        when (pending.response) {
            OperationResponse.ROOM -> {
                val value = api(pending.connection).post<PlayRoom>(pending.path, pending.body)
                checkEpoch(generation, pending.connection)
                require(value.ownMember?.id == pending.connection.profile.id)
                finishOperation(pending)
                moveToRoom(value)
            }
            OperationResponse.INVITATION -> {
                val value = api(pending.connection).post<InvitationView>(pending.path, pending.body)
                checkEpoch(generation, pending.connection)
                finishOperation(pending)
                mutable.update { if (value.generation >= (it.invitation?.generation ?: 0)) it.copy(invitation = value) else it }
            }
            OperationResponse.APPROVAL -> {
                api(pending.connection).post<PendingRequest>(pending.path, pending.body)
                checkEpoch(generation, pending.connection)
                finishOperation(pending)
                mutable.update { it.copy(notice = "Decision saved.") }
            }
            OperationResponse.PHRASE -> {
                val value = api(pending.connection).post<Phrase>(pending.path, pending.body)
                checkEpoch(generation, pending.connection)
                finishOperation(pending)
                mutable.update { it.copy(phrases = listOf(value) + it.phrases.filterNot { old -> old.id == value.id },
                    notice = "Saved privately to your notebook.") }
            }
        }
    } catch (error: Exception) {
        checkEpoch(generation, pending.connection)
        if (error !is ApiError || error.status !in 400..499 || error.status == 429) throw error
        if (error.status == 409 && reconcile(pending, generation)) return
        persist { if (it.pending?.id == pending.id) it.copy(pending = null) else it }
        if (error.status == 401) memberFailure(error, generation, pending.connection)
        if (error.status == 403) {
            try {
                if (pending.baseline != null) {
                    val fresh = api(pending.connection).get<PlayRoom>("/api/v1/play/rooms/${SottoClient.id(pending.baseline.id)}")
                    checkEpoch(generation, pending.connection)
                    if (state.value.screen == Screen.Room(fresh.id)) applyRoom(fresh)
                } else {
                    api(pending.connection).get<RoomList>("/api/v1/play/rooms?limit=1")
                    checkEpoch(generation, pending.connection)
                }
            } catch (failure: Exception) { memberFailure(failure, generation, pending.connection) }
        }
        throw error
    }
}

private suspend fun PlayCoordinator.finishOperation(pending: PendingOperation) {
    val request = SottoJson.parseToJsonElement(pending.body).jsonObject
    val command = request["command"]?.let { SottoJson.decodeFromJsonElement<Command>(it) }
    persist {
        require(it.pending?.id == pending.id)
        val before = pending.baseline
        val round = before?.round
        if (command == null || before == null || round == null) it.copy(pending = null)
        else {
            val key = draftKey(before, round, command.type)
            val text = if (command.type == ActionType.FEEDBACK) command.correction.orEmpty() else command.text
            it.copy(pending = null, drafts = if (it.drafts[key] == text) it.drafts - key else it.drafts)
        }
    }
}

private suspend fun PlayCoordinator.reconcile(pending: PendingOperation, generation: Long): Boolean {
    val beforeRoom = pending.baseline ?: return false
    val before = beforeRoom.round ?: return false
    if (pending.reconciled || pending.response != OperationResponse.ROOM) return false
    val objectBody = SottoJson.parseToJsonElement(pending.body).jsonObject
    val command = objectBody["command"]?.let { SottoJson.decodeFromJsonElement<Command>(it) } ?: return false
    if (command.type !in listOf(ActionType.CHOOSE, ActionType.ANSWER, ActionType.MISSION_DONE)) return false
    val fresh = api(pending.connection).get<PlayRoom>("/api/v1/play/rooms/${SottoClient.id(beforeRoom.id)}")
    checkEpoch(generation, pending.connection)
    if (state.value.vault?.pending?.id != pending.id) return false
    if (!applyRoom(fresh)) return false
    val after = fresh.round ?: return false
    if (fresh.revision <= beforeRoom.revision || fresh.ownSeat != beforeRoom.ownSeat ||
        fresh.ownMember?.id != beforeRoom.ownMember?.id || fresh.status != RoomStatus.PLAYING ||
        before.id != after.id || command.type !in after.header.allowedActions) return false
    if (command.type == ActionType.MISSION_DONE) {
        val old = before.content as? Mission ?: return false
        val next = after.content as? Mission ?: return false
        if (old.ownObjective != next.ownObjective || old.twist != next.twist || old.messages != next.messages ||
            before.header.hints != after.header.hints) return false
    }
    val replacement = pending.copy(id = newID(), body = actionBody(fresh.revision, command), baseline = fresh, reconciled = true)
    persist { require(it.pending?.id == pending.id); it.copy(pending = replacement) }
    retryAction()
    return true
}

fun PlayCoordinator.discardPendingAction(id: String) {
    if (state.value.busy) return
    confirm {
        persist {
            val pending = requireNotNull(it.pending)
            require(pending.id == id) { "The pending action changed. Check it before discarding." }
            it.archive(pending.connection).copy(pending = null)
        }
        mutable.update { it.copy(notice = "The action may already have saved. Check the game before submitting again. Your draft is kept.") }
    }
}
