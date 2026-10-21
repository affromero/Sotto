package fm.sotto.app

import fm.sotto.app.model.*
import fm.sotto.app.network.ApiError
import fm.sotto.app.play.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean

class PlayLegacyDeliveryTest {
    private suspend fun resumed(disk: MemoryVault, block: suspend (PlayCoordinator) -> Unit) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val coordinator = PlayCoordinator(disk, scope, "Legacy recovery")
            coordinator.setForeground(true)
            coordinator.awaitState { it.policy != null && it.joinStatus == JoinStatus.CLAIMED && !it.checking }
            block(coordinator)
        } finally { scope.cancel() }
    }

    @Test fun deliveredLegacyCredentialRequiresDurableExplicitConsentThenVerifiesAndAcknowledgesAcrossRelaunches() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection()
            val invite = PlayInvitation(server.origin, "ABCDEFGH2345")
            val delivery = Delivery(DeliveryKind.NATIVE, "old-issued-delivery", "fixture-room",
                requireNotNull(server.room(Seat.GUEST).guest), "already-issued-isolated-native-token")
            val legacy = Admission(invite, JoinCommand(newID(), invite.code, "Original device",
                JoinCandidate(CandidateKind.NEW, Settings(), name = "Sam", consentToProfile = true)),
                PlayInvitation.proof(), delivery = delivery)
            val bytes = SottoJson.encodeToString(legacy.command)
            val disk = MemoryVault(Vault(connection = original, invitation = invite, admission = legacy))
            val failAck = AtomicBoolean(true)
            server.respond = { request -> when {
                request.path.endsWith("/conduct") -> HttpReply(200, "{\"requestId\":\"${legacy.command.requestId}\",\"version\":1}")
                request.path.endsWith("/ack") -> if (failAck.getAndSet(false)) HttpReply(503, "{\"error\":\"Uncertain acknowledgment\"}")
                    else HttpReply(200, "{\"acknowledged\":true}")
                request.path == "/api/v1/profiles" -> HttpReply(200, SottoJson.encodeToString(ProfileList(listOf(server.connection(Seat.GUEST).profile))))
                request.path == "/api/v1/play/rooms/fixture-room" -> HttpReply(200, SottoJson.encodeToString(server.room(Seat.GUEST)))
                request.path.startsWith("/api/v1/play/join-requests/") -> HttpReply(200,
                    "{\"requestId\":\"${legacy.command.requestId}\",\"status\":\"CLAIMED\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"serverTime\":\"2026-10-21T12:00:00Z\"}")
                else -> server.normal(request)
            } }
            resumed(disk) { coordinator ->
                try { coordinator.finishAdmission(); fail("An issued legacy credential still requires explicit conduct acceptance") }
                catch (_: IllegalArgumentException) { }
                assertEquals(legacy, disk.load().admission)
                assertTrue(server.received.none { it.path == "/api/v1/profiles" || it.path.endsWith("/ack") })
                disk.failWrites = true
                try { coordinator.acceptPendingConduct(); fail("Acceptance must be saved before recovery proceeds") }
                catch (_: java.io.IOException) { }
                assertEquals(legacy, disk.load().admission)
                assertEquals(original, disk.load().connection)
                disk.failWrites = false
                coordinator.acceptPendingConduct()
                assertEquals(legacy.copy(conductVersion = CONDUCT_VERSION), disk.load().admission)
                assertEquals(bytes, SottoJson.encodeToString(requireNotNull(disk.load().admission).command))
            }
            resumed(disk) { coordinator ->
                assertEquals(CONDUCT_VERSION, coordinator.state.value.vault?.admission?.conductVersion)
                try { coordinator.finishAdmission(); fail("Expected uncertain ACK") }
                catch (error: ApiError) { assertEquals(503, error.status) }
                assertEquals(delivery.token, disk.load().connection?.token)
                assertEquals(legacy.copy(conductVersion = CONDUCT_VERSION), disk.load().admission)
                assertTrue(original in disk.load().archivedConnections)
            }
            resumed(disk) { coordinator ->
                coordinator.finishAdmission()
                assertNull(disk.load().admission)
                assertEquals(delivery.token, disk.load().connection?.token)
                assertEquals(Seat.GUEST, coordinator.state.value.room?.ownSeat)
            }
            assertTrue(server.received.none { it.path == "/api/v1/play/invitations" && it.method == "POST" || it.path.endsWith("/claim") })
            val posts = server.received.filter { it.method == "POST" }
            assertTrue(posts.all { it.headers["x-sotto-play-proof"] == listOf(legacy.proof) && it.headers["authorization"] == null })
            assertEquals(listOf("{\"version\":1}", "{\"version\":1}"), posts.filter { it.path.endsWith("/conduct") }.map { it.body })
            assertEquals(2, posts.count { it.path.endsWith("/ack") })
        }
    }

    @Test fun refusedLegacyDeliveryConsentKeepsTheExactCommandProofAndTokenWithoutVerificationOrAck() = runBlocking {
        PlayScenario().use { server ->
            val invite = PlayInvitation(server.origin, "ABCDEFGH2345")
            val legacy = Admission(invite, JoinCommand(newID(), invite.code, "Original device",
                JoinCandidate(CandidateKind.NEW, Settings(), name = "Sam", consentToProfile = true)),
                PlayInvitation.proof(), delivery = Delivery(DeliveryKind.NATIVE, "issued", "fixture-room",
                    requireNotNull(server.room(Seat.GUEST).guest), "already-issued-isolated-native-token"))
            val initial = Vault(connection = server.connection(), invitation = invite, admission = legacy)
            val disk = MemoryVault(initial)
            server.respond = { request -> when {
                request.path.endsWith("/conduct") -> HttpReply(409, "{\"error\":\"Sharing restricted\",\"reason\":\"SHARING_RESTRICTED\"}")
                request.path.startsWith("/api/v1/play/join-requests/") -> HttpReply(200,
                    "{\"requestId\":\"${legacy.command.requestId}\",\"status\":\"CLAIMED\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"serverTime\":\"2026-10-21T12:00:00Z\"}")
                else -> server.normal(request)
            } }
            resumed(disk) { coordinator ->
                try { coordinator.acceptPendingConduct(); fail("Restricted consent must be refused") }
                catch (error: ApiError) { assertEquals("SHARING_RESTRICTED", error.reason) }
                assertEquals(initial, disk.load())
                assertFalse(coordinator.state.value.accessRevoked)
                assertTrue(server.received.none { it.path == "/api/v1/profiles" || it.path.endsWith("/ack") || it.path.endsWith("/claim") })
            }
        }
    }
}
