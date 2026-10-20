package fm.sotto.app

import fm.sotto.app.model.*
import fm.sotto.app.network.ApiError
import fm.sotto.app.play.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class PlayRecoveryTest {
    @Test fun uncertainActionReplaysTheOriginalBytesAfterCoordinatorRestart() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val disk = MemoryVault(Vault(connection = connection))
            val unavailable = java.util.concurrent.atomic.AtomicBoolean(true)
            server.respond = { request ->
                if (request.path == "/api/v1/play/rooms" && request.method == "POST") {
                    if (unavailable.get()) HttpReply(503, "{\"error\":\"Try later\"}")
                    else HttpReply(200, SottoJson.encodeToString(server.room()))
                } else server.normal(request)
            }
            val firstScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val first = PlayCoordinator(disk, firstScope, "Android test")
            first.setForeground(true)
            first.awaitState { it.vault != null && !it.checking }
            try { first.create(GameKind.MIXED, Theme.EVERYDAY, Settings(), false); fail("Expected unavailable server") }
            catch (error: ApiError) { assertEquals(503, error.status) }
            val original = requireNotNull(first.state.value.vault?.pending)
            first.setForeground(false); firstScope.cancel()
            unavailable.set(false)
            val nextScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val restarted = PlayCoordinator(disk, nextScope, "Android test")
                restarted.setForeground(true)
                restarted.awaitState { it.vault?.pending != null && !it.checking }
                restarted.retryAction()
                assertNull(restarted.state.value.vault?.pending)
                assertEquals(server.room(), restarted.state.value.room)
                val requests = server.received.filter { it.path == "/api/v1/play/rooms" && it.method == "POST" }
                assertEquals(listOf(original.body, original.body), requests.map { it.body })
            } finally { nextScope.cancel() }
        }
    }

    @Test fun simultaneousIndependentPickReconcilesOnceUsingTheNewRevision() = runBlocking {
        PlayScenario().use { server ->
            val initial = server.room(Seat.GUEST)
            var fresh = initial
            var posts = 0
            server.respond = { request -> when {
                request.path.endsWith("/actions") -> {
                    posts++
                    if (posts == 1) {
                        fresh = initial.copy(revision = initial.revision + 1, round = server.round("one-pick-0-GUEST"))
                        HttpReply(409, "{\"error\":\"Revision changed\"}")
                    } else HttpReply(200, SottoJson.encodeToString(initial.copy(revision = initial.revision + 2,
                        round = server.round("finished-0-GUEST"))))
                }
                request.path == "/api/v1/play/rooms/${initial.id}" -> HttpReply(200, SottoJson.encodeToString(fresh))
                else -> server.normal(request)
            } }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(MemoryVault(Vault(connection = server.connection(Seat.GUEST))), scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.navigate(Screen.Room(initial.id))
                coordinator.awaitState { it.room != null && !it.checking }
                coordinator.command(Command(ActionType.CHOOSE, optionId = Option.A), initial)
                assertEquals(Phase.FINISHED, coordinator.state.value.room?.round?.header?.phase)
                val bodies = server.received.filter { it.path.endsWith("/actions") }.map { SottoJson.parseToJsonElement(it.body).jsonObject }
                assertEquals(listOf(initial.revision, initial.revision + 1), bodies.map { it["expectedRevision"]?.jsonPrimitive?.int })
                assertNotEquals(bodies[0]["actionId"], bodies[1]["actionId"])
                assertEquals(bodies[0]["command"], bodies[1]["command"])
            } finally { scope.cancel() }
        }
    }

    @Test fun changedMissionConversationRequiresAnotherExplicitOutcome() = runBlocking {
        PlayScenario().use { server ->
            val before = server.room().copy(round = server.round("message-4-4-HOST"))
            val after = before.copy(revision = before.revision + 1, round = server.round("message-5-4-HOST"))
            var current = before
            server.respond = { request -> when {
                request.path.endsWith("/actions") -> { current = after; HttpReply(409, "{\"error\":\"Changed\"}") }
                request.path == "/api/v1/play/rooms/${before.id}" -> HttpReply(200, SottoJson.encodeToString(current))
                else -> server.normal(request)
            } }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(MemoryVault(Vault(connection = server.connection())), scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.navigate(Screen.Room(before.id))
                coordinator.awaitState { it.room != null && !it.checking }
                try { coordinator.command(Command(ActionType.MISSION_DONE, achieved = true), before); fail("A changed conversation needs review") }
                catch (error: ApiError) { assertEquals(409, error.status) }
                assertEquals(after, coordinator.state.value.room)
                assertNull(coordinator.state.value.vault?.pending)
                assertEquals(1, server.received.filter { it.path.endsWith("/actions") }.size)
            } finally { scope.cancel() }
        }
    }

    @Test fun confirmedDiscardKeepsTheCredentialAndDraftAndRejectsAStaleConfirmation() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val pending = PendingOperation(newID(), connection, "/api/v1/play/rooms", "{}", OperationResponse.ROOM)
            val disk = MemoryVault(Vault(connection = connection, pending = pending, drafts = mapOf("saved" to "hola")))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.discardPendingAction("another-operation")
                coordinator.awaitState { !it.busy && it.error != null }
                assertEquals(pending, disk.load().pending)
                disk.failWrites = true
                coordinator.discardPendingAction(pending.id)
                coordinator.awaitState { !it.busy && it.error?.contains("disk") == true }
                assertEquals(pending, disk.load().pending)
                disk.failWrites = false
                coordinator.discardPendingAction(pending.id)
                coordinator.awaitState { !it.busy && it.vault?.pending == null }
                assertEquals(connection, disk.load().connection)
                assertTrue(connection in disk.load().archivedConnections)
                assertEquals("hola", disk.load().drafts["saved"])
                assertTrue(server.received.none { it.method == "POST" })
            } finally { scope.cancel() }
        }
    }
}
