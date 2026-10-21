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

class PlayAdmissionTest {
    private fun configure(server: PlayScenario, delivery: Delivery, failAck: AtomicBoolean = AtomicBoolean(false), broad: Boolean = false) {
        server.respond = { request -> when {
            request.path == "/api/v1/play/invitations" && request.method == "GET" -> HttpReply(200,
                SottoJson.encodeToString(Preview("fixture-room", "Alex", GameKind.MIXED, Theme.EVERYDAY,
                    QuestionStyle.CHOICES, true, "2026-10-30T00:00:00Z", "2026-10-20T00:00:00Z")))
            request.path == "/api/v1/play/invitations" && request.method == "POST" -> {
                val id = SottoJson.parseToJsonElement(request.body).jsonObject.getValue("requestId").jsonPrimitive.content
                HttpReply(201, SottoJson.encodeToString(JoinStatusView(id, JoinStatus.ACCEPTED, "2026-10-30T00:00:00Z", "2026-10-20T00:00:00Z")))
            }
            request.path.endsWith("/claim") -> HttpReply(200, SottoJson.encodeToString(delivery))
            request.path.endsWith("/ack") -> if (failAck.getAndSet(false)) HttpReply(503, "{\"error\":\"Acknowledgment unavailable\"}")
                else HttpReply(200, "{\"acknowledged\":true}")
            request.path == "/api/v1/profiles" -> HttpReply(200, SottoJson.encodeToString(ProfileList(
                listOf(server.connection(Seat.GUEST).profile) + if (broad) listOf(server.connection().profile) else emptyList())))
            request.path == "/api/v1/play/rooms/fixture-room" -> HttpReply(200, SottoJson.encodeToString(server.room(Seat.GUEST)))
            else -> server.normal(request)
        } }
    }

    @Test fun receivedCredentialAndProofSurviveAcknowledgmentFailureAndRestart() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection()
            val guest = requireNotNull(server.room(Seat.GUEST).guest)
            val delivery = Delivery(DeliveryKind.NATIVE, "delivery-1", "fixture-room", guest, "a-new-principal-bound-device-token")
            configure(server, delivery, AtomicBoolean(true))
            val disk = MemoryVault(Vault(connection = original, invitation = PlayInvitation(server.origin, "ABCDEFGH2345")))
            val firstScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            val first = PlayCoordinator(disk, firstScope, "Android test")
            first.setForeground(true)
            first.awaitState { it.preview != null && !it.checking }
            first.join(Settings(), "Sam", existing = false, acceptedConduct = true)
            val intake = requireNotNull(disk.load().admission)
            try { first.finishAdmission(); fail("Expected uncertain acknowledgment") }
            catch (error: ApiError) { assertEquals(503, error.status) }
            val saved = disk.load()
            assertEquals(delivery, saved.admission?.delivery)
            assertEquals(intake.proof, saved.admission?.proof)
            assertEquals(delivery.token, saved.connection?.token)
            assertTrue(original in saved.archivedConnections)
            first.setForeground(false); firstScope.cancel()
            val nextScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val restarted = PlayCoordinator(disk, nextScope, "Android test")
                restarted.setForeground(true)
                restarted.awaitState { it.vault?.admission?.delivery != null && !it.checking }
                restarted.finishAdmission()
                assertNull(disk.load().admission)
                assertNull(disk.load().invitation)
                assertEquals(Seat.GUEST, restarted.state.value.room?.ownSeat)
                val claims = server.received.filter { it.path.endsWith("/claim") }
                assertEquals(1, claims.size)
                assertNull(claims.single().headers["authorization"])
                val acks = server.received.filter { it.path.endsWith("/ack") }
                assertEquals(listOf(intake.proof, intake.proof), acks.map { it.headers["x-sotto-play-proof"]?.single() })
                assertTrue(acks.all { it.headers["authorization"] == null })
            } finally { nextScope.cancel() }
        }
    }

    @Test fun activationWriteFailureRetainsDeliveryAndNeverAcknowledgesIt() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection()
            val guest = requireNotNull(server.room(Seat.GUEST).guest)
            val delivery = Delivery(DeliveryKind.NATIVE, "delivery-1", "fixture-room", guest, "a-new-principal-bound-device-token")
            configure(server, delivery)
            val disk = MemoryVault(Vault(connection = original, invitation = PlayInvitation(server.origin, "ABCDEFGH2345")))
            disk.beforeCommit = { next -> if (next.connection?.token == delivery.token) throw java.io.IOException("Activation write failed") }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.preview != null && !it.checking }
                coordinator.join(Settings(), "Sam", false, acceptedConduct = true)
                try { coordinator.finishAdmission(); fail("Expected protected write failure") }
                catch (_: java.io.IOException) { }
                assertEquals(original, disk.load().connection)
                assertEquals(delivery, disk.load().admission?.delivery)
                assertTrue(server.received.none { it.path.endsWith("/ack") })
            } finally { scope.cancel() }
        }
    }

    @Test fun existingAdmissionAssertsTheProfileAndKeepsTheOriginalDeviceWithoutAck() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection(Seat.GUEST)
            val delivery = Delivery(DeliveryKind.EXISTING, roomId = "fixture-room", profile = requireNotNull(server.room(Seat.GUEST).guest))
            configure(server, delivery)
            val disk = MemoryVault(Vault(connection = original, invitation = PlayInvitation(server.origin, "ABCDEFGH2345")))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.preview != null && !it.checking }
                coordinator.join(Settings(), "", true, acceptedConduct = true)
                coordinator.finishAdmission()
                assertEquals(original, disk.load().connection)
                assertNull(disk.load().admission)
                assertTrue(server.received.none { it.path.endsWith("/ack") })
                val intake = server.received.single { it.path == "/api/v1/play/invitations" && it.method == "POST" }
                val body = SottoJson.parseToJsonElement(intake.body).jsonObject
                assertEquals(original.profile.id, body.getValue("candidate").jsonObject["expectedProfileId"]?.jsonPrimitive?.content)
                assertEquals(listOf("Bearer ${original.token}"), intake.headers["authorization"])
                assertEquals(listOf(original.profile.id), intake.headers["x-sotto-play-profile"])
            } finally { scope.cancel() }
        }
    }

    @Test fun overlyBroadDeliveredCredentialIsPreservedButCannotBecomeTheActiveProfile() = runBlocking {
        PlayScenario().use { server ->
            val guest = requireNotNull(server.room(Seat.GUEST).guest)
            val delivery = Delivery(DeliveryKind.NATIVE, "delivery-1", "fixture-room", guest, "a-new-principal-bound-device-token")
            configure(server, delivery, broad = true)
            val disk = MemoryVault(Vault(invitation = PlayInvitation(server.origin, "ABCDEFGH2345")))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.preview != null && !it.checking }
                coordinator.join(Settings(), "Sam", false, acceptedConduct = true)
                try { coordinator.finishAdmission(); fail("A broad credential must not be activated") }
                catch (_: IllegalArgumentException) { }
                assertNull(disk.load().connection)
                assertEquals(delivery, disk.load().admission?.delivery)
                assertTrue(server.received.none { it.path.endsWith("/ack") })
            } finally { scope.cancel() }
        }
    }
}
