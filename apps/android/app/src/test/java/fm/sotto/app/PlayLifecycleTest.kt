package fm.sotto.app

import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class PlayLifecycleTest {
    @Test fun returningToGamesKeepsInvitationRecoveryWithoutReopeningJoinOnNavigationOrResume() = runBlocking {
        PlayScenario().use { server ->
            val invite = PlayInvitation(server.origin, "ABCDEFGH2345")
            val command = JoinCommand(newID(), invite.code, "Android test",
                JoinCandidate(CandidateKind.NEW, Settings(), name = "Sam", consentToProfile = true))
            val recovery = Admission(invite, command, PlayInvitation.proof())
            server.respond = { request -> when {
                request.path == "/api/v1/play/invitations" -> HttpReply(200,
                    SottoJson.encodeToString(Preview("fixture-room", "Alex", GameKind.MIXED, Theme.EVERYDAY,
                        QuestionStyle.CHOICES, true, "2099-01-01T00:00:00Z", "2026-10-20T00:00:00Z")))
                request.path.startsWith("/api/v1/play/join-requests/") -> HttpReply(200,
                    SottoJson.encodeToString(JoinStatusView(command.requestId, JoinStatus.WAITING_FOR_HOST,
                        "2099-01-01T00:00:00Z", "2026-10-20T00:00:00Z")))
                else -> server.normal(request)
            } }
            for (admission in listOf(null, recovery)) {
                val original = Vault(connection = server.connection(), invitation = invite, admission = admission)
                val disk = MemoryVault(original)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
                try {
                    val coordinator = PlayCoordinator(disk, scope, "Android test")
                    coordinator.setForeground(true)
                    coordinator.awaitState { it.screen == Screen.Join && !it.checking }
                    coordinator.navigate(Screen.Lobby)
                    coordinator.awaitState { it.screen == Screen.Lobby && !it.checking }
                    coordinator.setForeground(false)
                    coordinator.setForeground(true)
                    coordinator.awaitState { it.screen == Screen.Lobby && !it.checking }
                    coordinator.navigate(Screen.Saved)
                    coordinator.awaitState { it.screen == Screen.Saved && !it.checking }
                    assertEquals(original, disk.load())
                    assertEquals(original, coordinator.state.value.vault)
                } finally { scope.cancel() }
            }
            assertTrue(server.received.none { it.method == "POST" })
        }
    }

    @Test fun anInvitationResponseCannotRestoreWaitingControlsAfterTheGameStarts() = runBlocking {
        PlayScenario().use { server ->
            val playing = server.room().copy(revision = 3)
            val waiting = playing.copy(status = RoomStatus.WAITING, revision = 2, round = null,
                allowedActions = listOf(RoomAction.START, RoomAction.CANCEL))
            val invitationStarted = CompletableDeferred<Unit>()
            val releaseInvitation = java.util.concurrent.CountDownLatch(1)
            val roomReads = java.util.concurrent.atomic.AtomicInteger()
            server.respond = { request -> when {
                request.path.endsWith("/presence") -> HttpReply(200,
                    "{\"hostWaiting\":true,\"expiresAt\":null,\"serverTime\":\"2026-10-20T12:00:00Z\"}")
                request.path.endsWith("/invitations") -> {
                    invitationStarted.complete(Unit)
                    if (releaseInvitation.await(5, java.util.concurrent.TimeUnit.SECONDS)) HttpReply(200,
                        "{\"roomId\":\"${playing.id}\",\"code\":\"ABCDEFGH2345\",\"generation\":1,\"expiresAt\":\"2099-01-01T00:00:00Z\"}")
                    else HttpReply(500, "{\"error\":\"Fixture barrier timed out\"}")
                }
                request.path.endsWith("/join-requests") -> HttpReply(200, "{\"requests\":[]}")
                request.path.endsWith("/actions") -> HttpReply(200, SottoJson.encodeToString(playing))
                request.path == "/api/v1/play/rooms/${playing.id}" -> HttpReply(200,
                    SottoJson.encodeToString(if (roomReads.incrementAndGet() == 1) waiting else playing))
                else -> server.normal(request)
            } }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(MemoryVault(Vault(connection = server.connection())), scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.navigate(Screen.Room(playing.id))
                withTimeout(5000) { invitationStarted.await() }
                coordinator.roomAction(RoomAction.START, waiting)
                assertEquals(playing, coordinator.state.value.room)
                releaseInvitation.countDown()
                withTimeout(5000) { while (roomReads.get() < 2) delay(10) }
                coordinator.awaitState { it.room == playing && !it.leaseReady && !it.checking }
                assertNull(coordinator.state.value.invitation)
                assertTrue(coordinator.state.value.requests.isEmpty())
                assertFalse(coordinator.state.value.leaseReady)
                assertTrue(server.received.none { it.path.endsWith("/join-requests") })
            } finally { releaseInvitation.countDown(); scope.cancel() }
        }
    }

    @Test fun erasingSavedDataClearsTheActiveCredentialEvenWhenBackgroundingCancelsCompletion() = runBlocking {
        PlayScenario().use { server ->
            val disk = MemoryVault(Vault(serial = 20, connection = server.connection(), drafts = mapOf("a" to "Private draft")))
            val erased = CompletableDeferred<Unit>()
            val finish = CompletableDeferred<Unit>()
            val store = object : VaultPersistence by disk {
                override suspend fun erase() {
                    disk.erase()
                    erased.complete(Unit)
                    withContext(NonCancellable) { finish.await() }
                }
            }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(store, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault?.serial == 20L && !it.checking }
                coordinator.run { eraseSavedData() }
                withTimeout(5000) { erased.await() }
                coordinator.setForeground(false)
                finish.complete(Unit)
                val cleared = coordinator.awaitState { it.vault?.connection == null }
                assertTrue(requireNotNull(cleared.vault).drafts.isEmpty())
                coordinator.setForeground(true)
                coordinator.awaitState { !it.checking }
                assertNull(coordinator.state.value.vault?.connection)
                assertNull(disk.load().connection)
            } finally { finish.complete(Unit); scope.cancel() }
        }
    }

    @Test fun recoveredCommittedProfileChangeClearsThePreviousLearnersNotebook() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection()
            val next = Connection(server.origin, "another-real-device-token", Profile("other-profile", "Jo", false, "USER"))
            server.respond = { request -> when (request.path) {
                "/api/v1/profiles" -> HttpReply(200, SottoJson.encodeToString(ProfileList(listOf(next.profile))))
                "/api/v1/play/phrases" -> {
                    val old = request.headers["authorization"]?.single() == "Bearer ${original.token}"
                    HttpReply(200, SottoJson.encodeToString(PhraseList(listOf(Phrase(if (old) "a-phrase" else "b-phrase",
                        "fixture-room", "fixture-KNOW_ME-0", PhraseKind.PHRASE,
                        if (old) "Old learner's secret phrase" else "A new learner's phrase", null, "de", "2026-10-20T00:00:00Z")))))
                }
                else -> server.normal(request)
            } }
            val disk = MemoryVault(Vault(connection = original))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.navigate(Screen.Notebook)
                coordinator.awaitState { it.phrases.any { phrase -> phrase.id == "a-phrase" } }
                disk.afterCommit = { saved -> if (saved.connection == next) throw CancellationException("Process interrupted after disk commit") }
                try { coordinator.switchConnection(next); fail("Expected interrupted completion") }
                catch (_: CancellationException) { }
                assertEquals(next, disk.load().connection)
                coordinator.setForeground(false)
                disk.afterCommit = null
                coordinator.setForeground(true)
                val recovered = coordinator.awaitState { it.vault?.connection == next }
                assertTrue(recovered.phrases.none { it.id == "a-phrase" })
                val refreshed = coordinator.awaitState { it.phrases.any { phrase -> phrase.id == "b-phrase" } }
                assertTrue(refreshed.phrases.none { it.id == "a-phrase" })
            } finally { scope.cancel() }
        }
    }

    @Test fun renamedLearnerCanRestoreTheirExactPendingCredentialAfterCanonicalVerification() = runBlocking {
        PlayScenario().use { server ->
            val original = server.connection()
            val active = Connection(server.origin, "another-real-device-token", Profile("other-profile", "Jo", false, "USER"))
            val renamed = original.profile.copy(name = "New name", isActive = true)
            server.respond = { request -> if (request.path == "/api/v1/profiles")
                HttpReply(200, SottoJson.encodeToString(ProfileList(listOf(renamed)))) else server.normal(request) }
            val pending = PendingOperation(newID(), original, "/api/v1/play/rooms", "{}", OperationResponse.ROOM)
            val disk = MemoryVault(Vault(connection = active, archivedConnections = listOf(original), pending = pending))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.switchConnection(original)
                assertEquals(original, disk.load().connection)
                assertEquals(pending, disk.load().pending)
                assertTrue(active in disk.load().archivedConnections)
            } finally { scope.cancel() }
        }
    }

    @Test fun waitingHostReleasesTheirOwnNonceAndUsesAFreshOneAfterFocusReturns() = runBlocking {
        PlayScenario().use { server ->
            val room = server.room().copy(status = RoomStatus.WAITING, round = null)
            server.respond = { request -> when {
                request.path.endsWith("/presence") -> HttpReply(200,
                    "{\"hostWaiting\":true,\"expiresAt\":\"2026-10-20T00:00:20Z\",\"serverTime\":\"2026-10-20T00:00:00Z\"}")
                request.path.endsWith("/invitations") -> HttpReply(200, "null")
                request.path.endsWith("/join-requests") -> HttpReply(200, "{\"requests\":[]}")
                request.path == "/api/v1/play/rooms/${room.id}" -> HttpReply(200, SottoJson.encodeToString(room))
                else -> server.normal(request)
            } }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(MemoryVault(Vault(connection = server.connection())), scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.navigate(Screen.Room(room.id))
                coordinator.awaitState { it.leaseReady }
                coordinator.setForeground(false)
                withTimeout(5000) { while (server.received.none { it.body.contains("RELEASE") }) delay(10) }
                coordinator.setForeground(true)
                coordinator.awaitState { it.leaseReady }
                val messages = server.received.filter { it.path.endsWith("/presence") }.map { SottoJson.parseToJsonElement(it.body).jsonObject }
                val renewals = messages.filter { it["type"]?.jsonPrimitive?.content == "RENEW" }
                val released = messages.first { it["type"]?.jsonPrimitive?.content == "RELEASE" }
                assertEquals(renewals.first()["viewNonce"], released["viewNonce"])
                assertNotEquals(renewals.first()["viewNonce"], renewals.last()["viewNonce"])
            } finally { scope.cancel() }
        }
    }

    @Test fun dialogConfirmationWaitsForFocusAndAnotherPauseCancelsIt() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            val pending = PendingOperation(newID(), connection, "/api/v1/play/rooms", "{}", OperationResponse.ROOM)
            val disk = MemoryVault(Vault(connection = connection, pending = pending))
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(disk, scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.setForeground(false)
                coordinator.discardPendingAction(pending.id)
                assertEquals(pending, disk.load().pending)
                coordinator.setForeground(false)
                coordinator.setForeground(true)
                coordinator.awaitState { !it.checking }
                assertEquals(pending, disk.load().pending)
                coordinator.setForeground(false)
                coordinator.discardPendingAction(pending.id)
                coordinator.setForeground(true)
                coordinator.awaitState { !it.busy && it.vault?.pending == null }
                assertTrue(server.received.none { it.method == "POST" })
            } finally { scope.cancel() }
        }
    }

    @Test fun oldSuccessfulReceiptCannotReplaceANewerRoomProjection() = runBlocking {
        PlayScenario().use { server ->
            val old = server.room()
            val fresh = old.copy(revision = old.revision + 2, round = server.round("finished-0-HOST"))
            server.respond = { request -> when {
                request.path.endsWith("/actions") -> HttpReply(200, SottoJson.encodeToString(old))
                request.path == "/api/v1/play/rooms/${old.id}" -> HttpReply(200, SottoJson.encodeToString(fresh))
                else -> server.normal(request)
            } }
            val connection = server.connection()
            val pending = PendingOperation(newID(), connection, "/api/v1/play/rooms/${old.id}/actions",
                buildJsonObject { put("actionId", newID()); put("expectedRevision", old.revision); put("command", Command(ActionType.CHOOSE, optionId = Option.A).payload()) }.toString(),
                OperationResponse.ROOM, old)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                val coordinator = PlayCoordinator(MemoryVault(Vault(connection = connection, pending = pending)), scope, "Android test")
                coordinator.setForeground(true)
                coordinator.awaitState { it.vault != null && !it.checking }
                coordinator.navigate(Screen.Room(old.id))
                coordinator.awaitState { it.room == fresh }
                coordinator.retryAction()
                assertEquals(fresh, coordinator.state.value.room)
                assertNull(coordinator.state.value.vault?.pending)
            } finally { scope.cancel() }
        }
    }
}
