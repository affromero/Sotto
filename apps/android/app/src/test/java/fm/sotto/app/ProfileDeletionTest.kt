package fm.sotto.app

import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ProfileDeletionTest {
    @Test fun backgroundingAnUncertainDeletionKeepsCredentialsAndDoesNotResubmitOnReturn() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val original = Vault(connection = connection, drafts = mapOf("saved" to "Keep me"))
            val started = CompletableDeferred<Unit>()
            val respond = CountDownLatch(1)
            server.respond = { request ->
                if (request.method == "DELETE") {
                    started.complete(Unit)
                    check(respond.await(10, TimeUnit.SECONDS))
                    HttpReply(202, "{\"success\":true}")
                } else server.normal(request)
            }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val store = MemoryVault(original)
                val coordinator = PlayCoordinator(store, scope, "Android")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.run { deleteProfile(connection) }
                withTimeout(10_000) { started.await() }
                coordinator.setForeground(false)
                respond.countDown()
                coordinator.setForeground(true)
                coordinator.awaitState { it.active && !it.checking }
                assertEquals(connection, store.load().connection)
                assertEquals(original.drafts, store.load().drafts)
                assertFalse(coordinator.state.value.notice.orEmpty().contains("deletion accepted"))
                assertEquals(1, server.received.count { it.method == "DELETE" })
            } finally { respond.countDown(); scope.cancel() }
        }
    }

    @Test fun confirmedDeletionClearsOnlyTheDeletedProfilesProtectedData() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val other = server.connection(Seat.GUEST)
            val key = "${connection.server}/${connection.profile.id}/draft"
            val otherKey = "${other.server}/${other.profile.id}/draft"
            val store = MemoryVault(Vault(connection = connection, archivedConnections = listOf(connection, other),
                pending = PendingOperation(newID(), connection, "/api/v1/play/rooms", "{}", OperationResponse.ROOM),
                drafts = mapOf(key to "Deleted draft", otherKey to "Kept draft")))
            server.respond = { if (it.method == "DELETE") HttpReply(202, "{\"success\":true}") else server.normal(it) }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(store, scope, "Android")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.deleteProfile(connection)
                val saved = store.load()
                assertNull(saved.connection)
                assertNull(saved.pending)
                assertEquals(listOf(other), saved.archivedConnections)
                assertEquals(mapOf(otherKey to "Kept draft"), saved.drafts)
                assertTrue(coordinator.state.value.notice.orEmpty().contains("deletion accepted"))
            } finally { scope.cancel() }
        }
    }

    @Test fun refusedUnconfirmedOrLocallyUnpersistedDeletionKeepsCredentialsAndRecovery() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val original = Vault(connection = connection, drafts = mapOf("saved" to "Keep me"))
            for (failure in listOf("refused", "unconfirmed", "disk")) {
                val store = MemoryVault(original)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                server.respond = { if (it.method == "DELETE") {
                    when (failure) {
                        "refused" -> HttpReply(403, "{\"error\":\"Protected profile\"}")
                        "unconfirmed" -> HttpReply(202, "{\"success\":false}")
                        else -> HttpReply(202, "{\"success\":true}")
                    }
                } else server.normal(it) }
                try {
                    val coordinator = PlayCoordinator(store, scope, "Android")
                    coordinator.setForeground(true)
                    coordinator.awaitState { it.vault != null && !it.checking }
                    store.failWrites = failure == "disk"
                    coordinator.run { deleteProfile(connection) }
                    coordinator.awaitState { !it.busy && it.error != null }
                    assertEquals(connection, store.load().connection)
                    assertEquals(original.drafts, store.load().drafts)
                    assertFalse(coordinator.state.value.notice.orEmpty().contains("deletion accepted"))
                } finally { scope.cancel() }
            }
        }
    }

    @Test fun deletionResponsePreservesAProfileSelectedWhileTheRequestWasPending() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection()
            val other = server.connection(Seat.GUEST)
            val started = CountDownLatch(1)
            val respond = CountDownLatch(1)
            server.respond = { request -> when {
                request.method == "DELETE" -> {
                    started.countDown()
                    check(respond.await(10, TimeUnit.SECONDS))
                    HttpReply(202, "{\"success\":true}")
                }
                request.path == "/api/v1/profiles" -> HttpReply(200, SottoJson.encodeToString(ProfileList(listOf(other.profile))))
                else -> server.normal(request)
            } }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val store = MemoryVault(Vault(connection = original, archivedConnections = listOf(other)))
                val coordinator = PlayCoordinator(store, scope, "Android")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                val deletion = async { coordinator.deleteProfile(original) }
                withContext(Dispatchers.IO) { check(started.await(10, TimeUnit.SECONDS)) }
                coordinator.switchConnection(other)
                respond.countDown()
                deletion.await()
                assertEquals(other, store.load().connection)
                assertFalse(store.load().archivedConnections.any { it.profile.id == original.profile.id })
                try { coordinator.deleteProfile(original); fail("A stale confirmation must fail") }
                catch (_: IllegalArgumentException) { }
                assertEquals(1, server.received.filter { it.method == "DELETE" }.size)
            } finally { respond.countDown(); scope.cancel() }
        }
    }
}
