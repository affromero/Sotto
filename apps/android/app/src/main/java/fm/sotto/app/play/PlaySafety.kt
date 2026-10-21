package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.network.ApiError
import fm.sotto.app.network.SottoClient
import fm.sotto.app.storage.PendingSafety
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*

fun PlayCoordinator.openSafety(room: PlayRoom? = null) {
    navigate(Screen.Safety)
    mutable.update { it.copy(safetyRoom = room) }
}

/** Safety remains available while an ordinary mutation needs recovery. */
fun PlayCoordinator.runSafety(block: suspend PlayCoordinator.() -> Unit) {
    if (!foreground || safetyWork?.isActive == true) return
    val previousWork = work
    val previousPolling = polling
    stopLifetime(cancelWork = false)
    val retired = retiredJobs
    previousWork?.cancel(); previousPolling?.cancel()
    val generation = epoch
    val connection = state.value.vault?.connection
    mutable.update { it.copy(busy = true, error = null, notice = null) }
    safetyWork = scope.launch {
        try {
            (retired + listOfNotNull(previousWork, previousPolling)).distinct().forEach { it.join() }
            retiredJobs = retiredJobs.filterNot { it.isCompleted }
            presenceRelease?.join()
            checkEpoch(generation, connection)
            block()
        } catch (_: CancellationException) { }
        catch (error: Exception) { if (epoch == generation) report(error) }
        finally {
            if (epoch == generation) {
                mutable.update { it.copy(busy = false) }
                if (foreground) startLifetime()
            }
        }
    }
}

suspend fun PlayCoordinator.refreshSafety(olderBlocks: Boolean = false, olderReports: Boolean = false) {
    val connection = requireNotNull(state.value.vault?.connection)
    val generation = epoch
    val status = api(connection).get<SafetyStatus>("/api/v1/play/safety")
    checkEpoch(generation, connection)
    applySafetyStatus(status, connection)
    val blocksCursor = if (olderBlocks) state.value.blocksCursor else null
    val reportsCursor = if (olderReports) state.value.reportsCursor else null
    val blocks = api(connection).get<BlockList>("/api/v1/play/safety/blocks" + page(blocksCursor))
    checkEpoch(generation, connection)
    val reports = api(connection).get<ReportList>("/api/v1/play/safety/reports" + page(reportsCursor))
    checkEpoch(generation, connection)
    mutable.update { previous ->
        val preserveBlocks = olderBlocks || previous.blocksExpanded
        val preserveReports = olderReports || previous.reportsExpanded
        val nextReports = reports.reports.map { incoming ->
            previous.reports.firstOrNull { it.id == incoming.id && it.revision > incoming.revision } ?: incoming
        }
        previous.copy(
            blocks = if (preserveBlocks) (blocks.blocks + previous.blocks).distinctBy { it.blockedUserId } else blocks.blocks,
            blocksCursor = if (olderBlocks || !previous.blocksExpanded) blocks.nextCursor else previous.blocksCursor,
            reports = if (preserveReports) (nextReports + previous.reports).distinctBy { it.id } else nextReports,
            reportsCursor = if (olderReports || !previous.reportsExpanded) reports.nextCursor else previous.reportsCursor,
            blocksExpanded = preserveBlocks, reportsExpanded = preserveReports,
        )
    }
}

internal fun PlayCoordinator.applySafetyStatus(value: SafetyStatus, connection: Connection) {
    require(value.profileId == connection.profile.id) { "The server returned another profile's safety settings." }
    mutable.update {
        val previous = it.safety
        if (previous != null && java.time.Instant.parse(previous.serverTime) > java.time.Instant.parse(value.serverTime)) it
        else it.copy(safety = value)
    }
}

private fun page(cursor: String?) = cursor?.let { "?beforeId=${SottoClient.id(it)}" }.orEmpty()

suspend fun PlayCoordinator.acceptConduct() = safetyOperation("/api/v1/play/safety/conduct") { put("version", CONDUCT_VERSION) }

suspend fun PlayCoordinator.blockPartner(room: PlayRoom) {
    require(room.ownMember?.id == state.value.vault?.connection?.profile?.id && room.guest != null)
    safetyOperation("/api/v1/play/rooms/${SottoClient.id(room.id)}/block") { }
}

suspend fun PlayCoordinator.unblockPartner(block: PlayerBlock) {
    require(block in state.value.blocks) { "Refresh your own blocks before unblocking." }
    safetyOperation("/api/v1/play/safety/blocks/${SottoClient.id(block.blockedUserId)}/unblock") { }
}

suspend fun PlayCoordinator.reportPartner(room: PlayRoom, evidence: ReportEvidence, category: ReportCategory, detail: String) {
    require(room.ownMember?.id == state.value.vault?.connection?.profile?.id && evidence in room.reportableEvidence())
    require(detail.trim().length <= 1000)
    safetyOperation("/api/v1/play/rooms/${SottoClient.id(room.id)}/reports") {
        put("category", category.name); put("detail", detail.trim()); put("expectedVisibleText", evidence.text)
        put("selector", buildJsonObject {
            put("kind", evidence.selector.kind.name)
            evidence.selector.roundId?.let { put("roundId", it) }
            evidence.selector.field?.let { put("field", it.name) }
            evidence.selector.index?.let { put("index", it) }
        })
    }
}

private suspend fun PlayCoordinator.safetyOperation(path: String, fields: JsonObjectBuilder.() -> Unit) {
    val connection = requireNotNull(state.value.vault?.connection)
    checkEpoch(epoch, connection)
    val id = newID()
    val pending = PendingSafety(id, connection, path, buildJsonObject { put("actionId", id); fields() }.toString())
    stageProtectedRequest(connection, pending, { it.pendingSafety }) { saved, request -> saved.copy(pendingSafety = request) }
    retrySafety()
}

suspend fun PlayCoordinator.retrySafety() {
    val pending = requireNotNull(state.value.vault?.pendingSafety)
    val generation = epoch
    require(pending.connection == state.value.vault?.connection) { "Restore the original profile for this safety action." }
    try {
        val ack = api(pending.connection).post<SafetyAck>(pending.path, pending.body)
        checkEpoch(generation, pending.connection)
        require(ack.actionId == pending.id && ack.completed) { "The server did not confirm this safety action. Retry its saved request." }
        completeProtectedRequest(pending, { it.pendingSafety }) {
            val room = pending.path.removePrefix("/api/v1/play/rooms/").removeSuffix("/reports")
            val key = "${pending.connection.server}/${pending.connection.profile.id}/safety/report/$room"
            val submitted = SottoJson.parseToJsonElement(pending.body).jsonObject["detail"]?.jsonPrimitive?.content
            val drafts = if (pending.path.endsWith("/reports") && it.drafts[key] == submitted) it.drafts - key else it.drafts
            it.copy(pendingSafety = null, drafts = drafts)
        }
        if (pending.path.endsWith("/block")) {
            releasePresence()
            olderRooms = emptyList(); olderRoomsOpened = false
            mutable.update { it.copy(screen = Screen.Safety, room = null, rooms = emptyList(), roomsCursor = null,
                invitation = null, requests = emptyList(), leaseReady = false) }
        }
        mutable.update { it.copy(notice = "Safety action saved.", blocks = emptyList(), blocksExpanded = false, blocksCursor = null) }
        refreshSafety()
    } catch (error: Exception) {
        checkEpoch(generation, pending.connection)
        if (error is ApiError && error.status in 400..499 && error.status != 429) {
            persist { if (it.pendingSafety == pending) it.copy(pendingSafety = null) else it }
            if (error.status in listOf(401, 403)) memberFailure(error, generation, pending.connection)
        }
        throw error
    }
}

fun PlayCoordinator.discardPendingSafety(id: String) = confirm(safety = true) {
    persist {
        val pending = requireNotNull(it.pendingSafety)
        require(pending.id == id) { "The saved safety action changed. Confirm again." }
        it.archive(pending.connection).copy(pendingSafety = null)
    }
    mutable.update { it.copy(notice = "The safety action may already have saved. Check your reports and blocks before acting again.") }
}
