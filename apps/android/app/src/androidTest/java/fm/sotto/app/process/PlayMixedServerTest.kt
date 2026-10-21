package fm.sotto.app.process

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.view.ViewTreeObserver
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleCallback
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import fm.sotto.app.MainActivity
import fm.sotto.app.NativeUIActions
import fm.sotto.app.SottoApplication
import fm.sotto.app.io.readBounded
import fm.sotto.app.model.*
import fm.sotto.app.network.SottoClient
import fm.sotto.app.network.ConnectionFailure
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.io.EOFException

@ExternalProcessTest
@RunWith(AndroidJUnit4::class)
class PlayMixedServerTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val application get() = instrumentation.targetContext.applicationContext as SottoApplication
    private var activity: ActivityScenario<MainActivity>? = null
    private val lifecycleTrace = ActivityLifecycleCallback { current, stage ->
        if (current is MainActivity) trace("activity $stage")
    }
    private val focusTrace = ViewTreeObserver.OnWindowFocusChangeListener { trace("window focus=$it") }
    private val ui get() = NativeUIActions(compose)
    private val control by lazy {
        requireNotNull(InstrumentationRegistry.getArguments().getString("control")).also {
            val uri = URI(it)
            require(uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port > 0)
        }
    }

    @After fun closeActivity() {
        ActivityLifecycleMonitorRegistry.getInstance().removeLifecycleCallback(lifecycleTrace)
        activity?.close()
    }

    @Test fun normalNativeAdmissionAndAllGamesInteroperateWithAnotherRealClient() = runBlocking {
        ActivityLifecycleMonitorRegistry.getInstance().addLifecycleCallback(lifecycleTrace)
        activity = ActivityScenario.launch(MainActivity::class.java)
        activity?.onActivity { it.window.decorView.viewTreeObserver.addOnWindowFocusChangeListener(focusTrace) }
        ui.visible("Sotto")
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText("Back to Play").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithText("Saved connections and recoveries").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithText("Back to Play").fetchSemanticsNodes().isNotEmpty()) ui.click("Back to Play")
        ui.visible("A game for two")
        eraseThroughUI()
        ui.click("Saved connections and recoveries")
        ui.allowLocalNetwork()
        ui.click("Back to Play")
        val configuration = SottoJson.decodeFromString<Configuration>(exchange())
        require(PlayInvitation.origin(configuration.server) == configuration.server)
        val invitation: PlayInvitation
        val roomID: String
        if (configuration.role == "HOST") {
            ui.click("Pair with your server")
            ui.fill("Server address", configuration.server)
            ui.fill("Access password", "browser test household password")
            ui.click("Open server")
            ui.click("Browser learner")
            ui.click("Learning language: Spanish")
            ui.click("German")
            ui.click("Create game")
            ui.click("Create invitation")
            ui.click("Copy invitation")
            val clipboard = instrumentation.targetContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val copied = withTimeout(10_000) {
                var result: PlayInvitation? = null
                while (result == null) {
                    var link: String? = null
                    instrumentation.runOnMainSync { link = clipboard.primaryClip?.getItemAt(0)?.text?.toString() }
                    val candidate = link?.let(PlayInvitation::parse)
                    if (candidate?.server == configuration.server &&
                        compose.onAllNodesWithText(candidate.formattedCode).fetchSemanticsNodes().isNotEmpty()) result = candidate
                    else delay(20)
                }
                result
            }
            invitation = requireNotNull(copied)
            val preview = observe<Preview>(SottoClient(invitation.server), "/api/v1/play/invitations?code=${invitation.code}")
            roomID = preview.roomId
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("play.room.$roomID").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("play.room.$roomID").performScrollTo().assertIsDisplayed()
            event("invitation", invitation.webLink, roomId = roomID)
            ui.click("Approve ${configuration.partnerName}'s profile", timeoutMillis = 120_000)
            ui.click("Start playing")
        } else {
            val ready = withTimeout(180_000) {
                var current = configuration
                while (current.invitation == null) { delay(100); current = SottoJson.decodeFromString(exchange()) }
                current
            }
            invitation = requireNotNull(PlayInvitation.parse(requireNotNull(ready.invitation)))
            activity?.close()
            activity = ActivityScenario.launch(Intent(Intent.ACTION_VIEW, Uri.parse(invitation.appLink))
                .setPackage(instrumentation.targetContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            ui.fill("Your name", configuration.name)
            ui.click("Create my own persistent learner profile on this server.")
            ui.click("Request a profile and join")
            ui.click("Enter accepted game")
            roomID = requireNotNull(ready.roomId)
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("play.room.$roomID").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("play.room.$roomID").performScrollTo().assertIsDisplayed()
        }
        event("joined")
        val connection = requireNotNull(application.protectedStore.load().connection)
        val api = SottoClient(connection.server, connection)
        val savedRounds = mutableSetOf<Int>()
        val reportedRounds = mutableSetOf<Int>()
        withTimeout(300_000) {
            while (true) {
                val room = observe<PlayRoom>(api, "/api/v1/play/rooms/${SottoClient.id(roomID)}")
                if (room.status == RoomStatus.COMPLETED) {
                    assertEquals(6, room.completedRounds.size)
                    assertEquals(12, room.points)
                    break
                }
                val round = room.round
                if (round == null) { delay(1000); continue }
                val actions = round.header.allowedActions
                val target = if (round.header.order == 2) "Brot" else "pan"
                ui.visible("ROUND ${round.header.order + 1} · ${round.header.targetLang.uppercase()} · ${round.header.level} · ${round.header.role.name.lowercase().replaceFirstChar { it.uppercase() }}")
                if (round.header.phase == Phase.FINISHED) {
                    if (round.header.mode == GameKind.DESCRIBE && round.header.role == Role.LEARNER && round.header.order !in savedRounds) {
                        ui.click("Keep language · round ${round.header.order + 1}")
                        ui.click(target)
                        ui.click("Save privately")
                        ui.visible("Saved privately to your notebook.")
                        savedRounds += round.header.order
                    }
                    if (reportedRounds.add(round.header.order)) event("round", round = round.header.order)
                    val partner = SottoJson.decodeFromString<Configuration>(exchange())
                    if (configuration.role == "HOST" && RoomAction.NEXT_ROUND in room.allowedActions && partner.partnerRound >= round.header.order) {
                        trace("Next round ${round.header.order} revision ${room.revision}")
                        ui.click("Next round")
                        if (round.header.order == 5) ui.visible("A little more of each other's language")
                        else compose.waitUntil(15_000) {
                            compose.onAllNodesWithText("ROUND ${round.header.order + 2} ·", substring = true)
                                .fetchSemanticsNodes().isNotEmpty()
                        }
                        awaitRevision(api, room)
                    } else delay(1000)
                    continue
                }
                var submitted = true
                when {
                    ActionType.CHOOSE in actions -> {
                        val card = (round.content as Prediction).choices.first()
                        ui.click("${card.symbol} ${card.text}")
                        ui.visible("Your pick: ${card.text}")
                    }
                    ActionType.SET_TARGET in actions -> {
                        ui.fill("Your own word or phrase", target); ui.click("Use this target")
                        ui.visible("Your private target: $target")
                    }
                    ActionType.GIVE_CLUE in actions -> {
                        ui.fill("A clue without the target word", "Ein Wort zum Essen."); ui.click("Send clue")
                        ui.visible("Clue: Ein Wort zum Essen.")
                    }
                    ActionType.GUESS in actions -> {
                        ui.fill("What is the word?", target); ui.click("Make your guess")
                        ui.visible("Guess: $target")
                    }
                    ActionType.MISSION_DONE in actions -> {
                        ui.click("Mission achieved"); ui.visible("Your mission is marked achieved.")
                    }
                    ActionType.MESSAGE in actions -> {
                        val mission = round.content as Mission
                        if (mission.messages.size >= 4 || (mission.messages.isEmpty() && round.header.role == Role.PARTNER)) {
                            submitted = false
                            delay(1000)
                        } else {
                            assertNull(mission.otherObjective)
                            if (mission.messages.size >= 3) assertNotNull(mission.twist)
                            ui.visible("${mission.remainingMessages} messages left together")
                            ui.fill("Your next line", "Zusammen planen wir ${mission.messages.size + 1}.")
                            ui.click("Send message")
                            ui.visible("You: Zusammen planen wir ${mission.messages.size + 1}.")
                        }
                    }
                    ActionType.FEEDBACK in actions -> { ui.click("I understood"); ui.visible("You understood each other.") }
                    else -> { submitted = false; delay(1000) }
                }
                if (submitted) awaitRevision(api, room)
            }
        }
        val notebook = observe<PhraseList>(api, "/api/v1/play/phrases")
        val ownWord = if (configuration.role == "HOST") "Brot" else "pan"
        val partnerWord = if (configuration.role == "HOST") "pan" else "Brot"
        assertTrue(notebook.phrases.any { it.roomId == roomID && it.text == ownWord })
        assertTrue(notebook.phrases.none { it.roomId == roomID && it.text == partnerWord })
        event("completed")
        if (configuration.role == "HOST") ui.click("Play again") else ui.click("Open your rematch")
        ui.visible("A seat for your partner")
        val rematch = withTimeout(15_000) {
            var room = observe<PlayRoom>(api, "/api/v1/play/rooms/${SottoClient.id(roomID)}")
            while (room.rematchRoomId == null) { delay(1000); room = observe(api, "/api/v1/play/rooms/${SottoClient.id(roomID)}") }
            requireNotNull(room.rematchRoomId)
        }
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("play.room.$rematch").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("play.room.$rematch").performScrollTo().assertIsDisplayed()
        event("done", rematchId = rematch)
        ui.click("Back to Play")
        eraseThroughUI()
    }

    private suspend fun eraseThroughUI() {
        ui.click("Saved connections and recoveries")
        ui.click("Unpair and erase saved game data")
        trace("touch Remove")
        compose.onNodeWithText("Remove").assertIsDisplayed().assertIsEnabled().performTouchInput { click() }
        compose.waitForIdle()
        trace("Remove delivered")
        try {
            withTimeout(10_000) {
                while (application.protectedStore.load().connection != null ||
                    compose.onAllNodesWithText("A game for two").fetchSemanticsNodes().isEmpty()) delay(20)
            }
        } catch (error: Exception) {
            runCatching { System.err.println(compose.onRoot().printToString()) }
                .onFailure { error.addSuppressed(it) }
            throw error
        }
        ui.visible("A game for two")
    }

    private fun trace(event: String) { System.err.println("Mixed UI ${SystemClock.elapsedRealtime()} $event") }

    private suspend fun awaitRevision(api: SottoClient, before: PlayRoom) {
        var latest = before
        try {
            withTimeout(15_000) {
                do {
                    latest = observe(api, "/api/v1/play/rooms/${SottoClient.id(before.id)}")
                    if (latest.revision <= before.revision) delay(1000)
                } while (latest.revision <= before.revision)
            }
        } catch (error: TimeoutCancellationException) {
            throw AssertionError("No revision after round ${before.round?.header?.order}, revision ${before.revision}; " +
                "latest ${latest.revision}, ${latest.status}, ${latest.round?.header?.phase}.\n${compose.onRoot().printToString()}", error)
        }
    }

    private suspend inline fun <reified T> observe(api: SottoClient, path: String): T = withTimeout(15_000) {
        try { api.get<T>(path) }
        catch (error: ConnectionFailure) {
            if (generateSequence<Throwable>(error) { it.cause }.none { it is EOFException }) throw error
            System.err.println("Observer GET $path ended before response headers. Retrying this read once.")
            error.printStackTrace()
            delay(100)
            try { api.get<T>(path) }
            catch (retry: Exception) { retry.addSuppressed(error); throw retry }
        }
    }

    private fun event(type: String, invitation: String? = null, round: Int? = null, roomId: String? = null, rematchId: String? = null) {
        exchange(buildJsonObject { put("type", type); invitation?.let { put("invitation", it) }; round?.let { put("round", it) }
            roomId?.let { put("roomId", it) }; rematchId?.let { put("rematchId", it) } }.toString())
    }

    private fun exchange(body: String? = null): String {
        val connection = URL(control).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 5000; connection.readTimeout = 5000
            connection.instanceFollowRedirects = false
            if (body != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            check(connection.responseCode == 200) { "The external test controller refused the request." }
            return connection.inputStream.use { it.readBounded(8192).toString(Charsets.UTF_8) }
        } finally { connection.disconnect() }
    }

    @Serializable private data class Configuration(val server: String, val role: String, val name: String,
        val partnerName: String, val invitation: String? = null, val partnerRound: Int = -1, val roomId: String? = null)
}
