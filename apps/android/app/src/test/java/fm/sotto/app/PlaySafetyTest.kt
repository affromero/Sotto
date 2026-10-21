package fm.sotto.app

import fm.sotto.app.model.*
import fm.sotto.app.network.ApiError
import fm.sotto.app.play.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PlaySafetyTest {
    private suspend fun connected(server: PlayScenario, disk: MemoryVault = MemoryVault(Vault(connection = server.connection())),
                                  block: suspend (PlayCoordinator) -> Unit) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val coordinator = PlayCoordinator(disk, scope, "Safety test")
            coordinator.setForeground(true)
            coordinator.awaitState { it.vault != null && !it.checking }
            block(coordinator)
        } finally { scope.cancel() }
    }

    @Test fun exactSharedSafetyFixturesDecodeWithoutChangingTheRoomContract() {
        PlayScenario().use { server ->
            val fixture = server.safetyFixture
            val policy = SottoJson.decodeFromJsonElement<ConductPolicy>(fixture.getValue("policy"))
            assertEquals(CONDUCT_VERSION, policy.version)
            assertTrue(policy.paragraphs.any { it.contains("without AI") })
            val unaccepted = SottoJson.decodeFromJsonElement<SafetyStatus>(fixture.getValue("unaccepted"))
            assertNull(unaccepted.acceptedVersion)
            assertNull(unaccepted.acceptedAt)
            assertTrue(SottoJson.decodeFromJsonElement<SafetyStatus>(fixture.getValue("restricted")).sharingRestricted)
            assertEquals("fixture-partner", SottoJson.decodeFromJsonElement<BlockList>(fixture.getValue("blocks")).blocks.single().blockedUserId)
            val report = SottoJson.decodeFromJsonElement<SafetyReport>(fixture.getValue("report"))
            assertEquals(ReportStatus.RESOLVED, report.status)
            assertEquals(ReportField.MESSAGE, report.evidence.selector.field)
            assertEquals(1, report.evidence.selector.index)
            assertEquals(fixture.getValue("reportRequest").jsonObject["actionId"]?.jsonPrimitive?.content, report.id)
            assertNotNull(report.response)
            assertTrue(SottoJson.decodeFromJsonElement<SafetyAck>(fixture.getValue("completed")).completed)
        }
    }

    @Test fun reportsOfferOnlyVisiblePartnerAuthoredTextAcrossAllThreeModes() {
        PlayScenario().use { server ->
            val room = server.room()
            fun evidence(name: String) = room.copy(round = server.round(name), completedRounds = emptyList()).reportableEvidence()
            assertEquals(listOf(SelectorKind.PARTNER_NAME), evidence("initial-0-HOST").map { it.selector.kind })
            val describing = evidence("clue-2-HOST")
            assertTrue(describing.none { it.selector.field in listOf(ReportField.TARGET, ReportField.CLUE) })
            val partnerDescription = server.room(Seat.GUEST).copy(round = server.round("clue-2-GUEST"), completedRounds = emptyList()).reportableEvidence()
            assertTrue(partnerDescription.any { it.selector.field == ReportField.CLUE })
            assertTrue(partnerDescription.none { it.selector.field == ReportField.TARGET })
            val mission = evidence("message-3-4-HOST")
            val messages = (server.round("message-3-4-HOST").content as Mission).messages
            val selected = mission.filter { it.selector.field == ReportField.MESSAGE }
            assertTrue(selected.isNotEmpty())
            selected.forEach { assertEquals(Seat.GUEST, messages[requireNotNull(it.selector.index)].seat) }
            assertTrue(mission.none { it.text.contains("secret mission", ignoreCase = true) })
            val corrected = server.round("finished-2-HOST").let { it.copy(header = it.header.copy(result = requireNotNull(it.header.result).copy(correction = "A partner's correction"))) }
            assertTrue(room.copy(round = corrected, completedRounds = emptyList()).reportableEvidence().any { it.selector.field == ReportField.CORRECTION })
            assertTrue(server.room(Seat.GUEST).copy(round = corrected, completedRounds = emptyList())
                .reportableEvidence().none { it.selector.field == ReportField.CORRECTION })
        }
    }

    @Test fun uncertainReportSurvivesRestartAlongsideTheExactGameActionAndDraft() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val room = server.room()
            val normal = PendingOperation(newID(), connection, "/api/v1/play/rooms/${room.id}/actions", "{}", OperationResponse.ROOM, room)
            val disk = MemoryVault(Vault(connection = connection, pending = normal, drafts = mapOf("turn" to "Keep my private draft")))
            var fail = true
            server.respond = { request -> if (request.path.endsWith("/reports") && request.method == "POST") {
                if (fail) HttpReply(503, "{\"error\":\"Uncertain report\"}") else {
                    val body = SottoJson.parseToJsonElement(request.body).jsonObject
                    HttpReply(200, "{\"actionId\":${body.getValue("actionId")},\"completed\":true}")
                }
            } else server.normal(request) }
            connected(server, disk) { coordinator ->
                try { coordinator.reportPartner(room, room.reportableEvidence().first(), ReportCategory.HARASSMENT, "Directed at me"); fail("Expected uncertain send") }
                catch (error: ApiError) { assertEquals(503, error.status) }
                assertNotNull(disk.load().pendingSafety)
            }
            val saved = requireNotNull(disk.load().pendingSafety)
            fail = false
            connected(server, disk) { coordinator ->
                coordinator.retrySafety()
                assertNull(disk.load().pendingSafety)
                assertEquals(normal, disk.load().pending)
                assertEquals("Keep my private draft", disk.load().drafts["turn"])
                assertEquals(connection, disk.load().connection)
            }
            val requests = server.received.filter { it.path.endsWith("/reports") && it.method == "POST" }
            assertEquals(listOf(saved.body, saved.body), requests.map { it.body })
            assertTrue(requests.all { it.headers["authorization"] == listOf("Bearer ${connection.token}") &&
                it.headers["cookie"] == null && it.headers["origin"] == null })
            assertEquals(saved.id, SottoJson.parseToJsonElement(saved.body).jsonObject["actionId"]?.jsonPrimitive?.content)
            assertEquals(setOf("kind"), SottoJson.parseToJsonElement(saved.body).jsonObject.getValue("selector").jsonObject.keys)
        }
    }

    @Test fun wrongAcknowledgmentOrProtectedWriteFailureKeepsSafetyRecovery() = runBlocking {
        PlayScenario().use { server ->
            val disk = MemoryVault(Vault(connection = server.connection()))
            server.respond = { request -> if (request.method == "POST") HttpReply(200, "{\"actionId\":\"another-action\",\"completed\":true}") else server.normal(request) }
            connected(server, disk) { coordinator ->
                disk.failWrites = true
                try { coordinator.acceptConduct(); fail("Expected protected write failure") } catch (_: java.io.IOException) { }
                assertTrue(server.received.none { it.method == "POST" })
                disk.failWrites = false
                try { coordinator.acceptConduct(); fail("Expected mismatched receipt") } catch (_: IllegalArgumentException) { }
                assertNotNull(disk.load().pendingSafety)
                assertFalse(coordinator.state.value.accessRevoked)
                try { coordinator.create(GameKind.MIXED, Theme.EVERYDAY, Settings(), false); fail("Safety recovery must finish first") }
                catch (_: IllegalArgumentException) { }
                assertEquals(1, server.received.count { it.method == "POST" })
            }
        }
    }

    @Test fun safetyErrorsDoNotRevokeDeviceAccessOrReconcileTheTurnAsARevisionConflict() = runBlocking {
        PlayScenario().use { server ->
            val room = server.room()
            val disk = MemoryVault(Vault(connection = server.connection(), drafts = mapOf("turn" to "Draft kept")))
            server.respond = { request -> when {
                request.path.endsWith("/actions") -> HttpReply(409, "{\"error\":\"Accept conduct\",\"reason\":\"CONDUCT_REQUIRED\"}")
                request.path == "/api/v1/play/rooms/${room.id}" -> HttpReply(200, SottoJson.encodeToString(room))
                else -> server.normal(request)
            } }
            connected(server, disk) { coordinator ->
                coordinator.navigate(Screen.Room(room.id))
                coordinator.awaitState { it.room != null && !it.checking }
                coordinator.run { command(Command(ActionType.CHOOSE, optionId = Option.A), room) }
                coordinator.awaitState { !it.busy && it.error == "Accept conduct" }
                assertFalse(coordinator.state.value.accessRevoked)
                assertNull(coordinator.state.value.safety?.acceptedVersion)
                assertNull(disk.load().pending)
                assertEquals("Draft kept", disk.load().drafts["turn"])
                assertNotNull(disk.load().connection)
                assertEquals(1, server.received.count { it.path.endsWith("/actions") })
            }
        }
    }

    @Test fun safetySendDrainsTheCancelledTurnAndReleasesPresenceBeforeSending() = runBlocking {
        PlayScenario().use { server ->
            val waiting = server.room().copy(status = RoomStatus.WAITING, round = null)
            val releaseStarted = CountDownLatch(1)
            val allowRelease = CountDownLatch(1)
            server.respond = { request -> when {
                request.path.endsWith("/presence") -> {
                    if (request.body.contains("RELEASE")) { releaseStarted.countDown(); allowRelease.await(5, TimeUnit.SECONDS) }
                    HttpReply(200, "{\"hostWaiting\":true,\"serverTime\":\"2026-10-20T12:00:00Z\"}")
                }
                request.path.endsWith("/invitations") -> HttpReply(200, "null")
                request.path.endsWith("/join-requests") -> HttpReply(200, "{\"requests\":[]}")
                request.path == "/api/v1/play/rooms/${waiting.id}" -> HttpReply(200, SottoJson.encodeToString(waiting))
                request.path.endsWith("/conduct") -> {
                    val id = SottoJson.parseToJsonElement(request.body).jsonObject.getValue("actionId")
                    HttpReply(200, "{\"actionId\":$id,\"completed\":true}")
                }
                else -> server.normal(request)
            } }
            connected(server) { coordinator ->
                coordinator.navigate(Screen.Room(waiting.id))
                coordinator.awaitState { it.leaseReady }
                coordinator.openSafety(waiting)
                coordinator.runSafety { acceptConduct() }
                assertTrue(withContext(Dispatchers.IO) { releaseStarted.await(5, TimeUnit.SECONDS) })
                assertTrue(server.received.none { it.path.endsWith("/conduct") })
                allowRelease.countDown()
                coordinator.awaitState { !it.busy && it.notice == "Safety action saved." }
                assertTrue(server.received.any { it.path.endsWith("/conduct") })
                assertFalse(coordinator.state.value.leaseReady)
            }
            allowRelease.countDown()
        }
    }

    @Test fun legacyRequestConsentKeepsImmutableCommandAndProofAndNeverRepostsTheOldBody() = runBlocking {
        PlayScenario().use { server ->
            val invitation = PlayInvitation(server.origin, "ABCDEFGH2345")
            val original = Admission(invitation, JoinCommand(newID(), invitation.code, "Old device",
                JoinCandidate(CandidateKind.NEW, Settings(), name = "Sam", consentToProfile = true)), PlayInvitation.proof())
            val disk = MemoryVault(Vault(invitation = invitation, admission = original))
            server.respond = { request -> if (request.path.endsWith("/conduct")) HttpReply(200,
                "{\"requestId\":\"${original.command.requestId}\",\"version\":1}") else server.normal(request) }
            connected(server, disk) { coordinator ->
                try { coordinator.retryIntake(); fail("Old intake may not be rewritten") } catch (_: IllegalArgumentException) { }
                coordinator.acceptPendingConduct()
                assertEquals(original, disk.load().admission)
                assertTrue(coordinator.state.value.pendingConductAccepted)
                val request = server.received.single { it.method == "POST" }
                assertEquals("{\"version\":1}", request.body)
                assertEquals(listOf(original.proof), request.headers["x-sotto-play-proof"])
                assertNull(request.headers["authorization"])
            }
        }
    }

    @Test fun absentLegacyRequestIsRetainedUnchangedBeforeCreatingANewConsentedRequest() = runBlocking {
        PlayScenario().use { server ->
            val invitation = PlayInvitation(server.origin, "ABCDEFGH2345")
            val original = Admission(invitation, JoinCommand(newID(), invitation.code, "Old device",
                JoinCandidate(CandidateKind.NEW, Settings(), name = "Sam", consentToProfile = true)), PlayInvitation.proof())
            val disk = MemoryVault(Vault(invitation = invitation, admission = original))
            server.respond = { request -> when {
                request.path.startsWith("/api/v1/play/join-requests/") -> HttpReply(404, "{\"error\":\"Absent\"}")
                request.path == "/api/v1/play/invitations" && request.method == "POST" -> {
                    val id = SottoJson.parseToJsonElement(request.body).jsonObject.getValue("requestId")
                    HttpReply(200, "{\"requestId\":$id,\"status\":\"WAITING_FOR_HOST\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"serverTime\":\"2026-10-21T12:00:00Z\"}")
                }
                else -> server.normal(request)
            } }
            connected(server, disk) { coordinator ->
                assertTrue(coordinator.state.value.legacyRequestMissing)
                try { coordinator.retainLegacyAdmission(false); fail("New request requires explicit conduct acceptance") } catch (_: IllegalArgumentException) { }
                coordinator.retainLegacyAdmission(true)
                assertEquals(listOf(original), disk.load().retainedAdmissions)
                assertNull(disk.load().admission)
                assertTrue(server.received.none { it.method == "POST" })
                coordinator.join(Settings(), "Sam", false, acceptedConduct = true)
                val next = requireNotNull(disk.load().admission)
                assertNotEquals(original.command.requestId, next.command.requestId)
                assertNotEquals(original.proof, next.proof)
                assertEquals(CONDUCT_VERSION, next.command.acceptedConductVersion)
                assertEquals(listOf(original), disk.load().retainedAdmissions)
                assertEquals(1, server.received.count { it.method == "POST" })
            }
        }
    }

    @Test fun savedBlockAndUnblockReceiptsReplayWithoutRequiringTheOldRoomOrCurrentBlockEntry() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            for (path in listOf("/api/v1/play/rooms/deleted-room/block", "/api/v1/play/safety/blocks/removed-partner/unblock")) {
                val id = newID()
                val pending = PendingSafety(id, connection, path, "{\"actionId\":\"$id\"}")
                val disk = MemoryVault(Vault(connection = connection, pendingSafety = pending))
                server.respond = { request -> if (request.path == path && request.method == "POST")
                    HttpReply(200, "{\"actionId\":\"$id\",\"completed\":true}") else server.normal(request) }
                connected(server, disk) { coordinator ->
                    assertTrue(coordinator.state.value.blocks.isEmpty())
                    coordinator.retrySafety()
                    assertNull(disk.load().pendingSafety)
                    assertEquals(connection, disk.load().connection)
                }
                assertEquals(pending.body, server.received.last { it.path == path }.body)
            }
            assertTrue(server.received.none { it.method == "GET" && it.path.contains("deleted-room") })
        }
    }

    @Test fun backgroundingAnUncertainSafetySendKeepsItsExactRequestWithoutAutomaticReplay() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val disk = MemoryVault(Vault(connection = connection))
            val requestStarted = CompletableDeferred<Unit>()
            val allowResponse = CountDownLatch(1)
            server.respond = { request -> if (request.path.endsWith("/conduct")) {
                requestStarted.complete(Unit)
                allowResponse.await(5, TimeUnit.SECONDS)
                val id = SottoJson.parseToJsonElement(request.body).jsonObject.getValue("actionId")
                HttpReply(200, "{\"actionId\":$id,\"completed\":true}")
            } else server.normal(request) }
            connected(server, disk) { coordinator ->
                coordinator.openSafety()
                coordinator.runSafety { acceptConduct() }
                withTimeout(5000) { requestStarted.await() }
                val saved = requireNotNull(disk.load().pendingSafety)
                coordinator.setForeground(false)
                allowResponse.countDown()
                coordinator.setForeground(true)
                coordinator.awaitState { it.active && !it.checking }
                assertEquals(saved, disk.load().pendingSafety)
                assertEquals(connection, disk.load().connection)
                assertEquals(1, server.received.count { it.path.endsWith("/conduct") })
            }
            allowResponse.countDown()
        }
    }

    @Test fun confirmedBlockClearsCachedGamesWhileKeepingReportContextAndUnavailableRoomsKeepSafetyAccess() = runBlocking {
        PlayScenario().use { server ->
            val room = server.room()
            val connection = server.connection()
            val normal = PendingOperation(newID(), connection, "/api/v1/play/rooms/${room.id}/actions", "{}", OperationResponse.ROOM)
            val disk = MemoryVault(Vault(connection = connection, pending = normal, drafts = mapOf("turn" to "Keep this turn")))
            var blocked = false
            server.respond = { request -> when {
                request.path.endsWith("/block") -> {
                    blocked = true
                    val id = SottoJson.parseToJsonElement(request.body).jsonObject.getValue("actionId")
                    HttpReply(200, "{\"actionId\":$id,\"completed\":true}")
                }
                request.path == "/api/v1/play/rooms/${room.id}" -> if (blocked)
                    HttpReply(404, "{\"error\":\"This game is unavailable.\",\"reason\":\"PLAY_UNAVAILABLE\"}")
                    else HttpReply(200, SottoJson.encodeToString(room))
                request.path == "/api/v1/play/rooms" -> HttpReply(200, SottoJson.encodeToString(RoomList(if (blocked) emptyList() else listOf(room))))
                else -> server.normal(request)
            } }
            connected(server, disk) { coordinator ->
                coordinator.awaitState { it.rooms == listOf(room) }
                coordinator.navigate(Screen.Room(room.id))
                coordinator.awaitState { it.room == room && !it.checking }
                coordinator.openSafety(room)
                coordinator.runSafety { blockPartner(room) }
                coordinator.awaitState { !it.busy && it.notice == "Safety action saved." }
                val safe = coordinator.state.value
                assertEquals(Screen.Safety, safe.screen)
                assertNull(safe.room)
                assertTrue(safe.rooms.isEmpty())
                assertNull(safe.invitation)
                assertTrue(safe.requests.isEmpty())
                assertEquals(room, safe.safetyRoom)
                assertEquals(normal, disk.load().pending)
                assertEquals("Keep this turn", disk.load().drafts["turn"])
                coordinator.navigate(Screen.Room(room.id))
                val unavailable = coordinator.awaitState { it.roomUnavailable && !it.checking }
                assertNull(unavailable.room)
                assertFalse(unavailable.accessRevoked)
                assertEquals(connection, unavailable.vault?.connection)
                coordinator.openSafety()
                coordinator.awaitState { !it.checking && it.safety?.profileId == connection.profile.id }
            }
        }
    }
}
