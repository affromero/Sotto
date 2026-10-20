package fm.sotto.app

import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import fm.sotto.app.model.*
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayInvitationUITest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val application get() = instrumentation.targetContext.applicationContext as SottoApplication
    private var activity: ActivityScenario<MainActivity>? = null

    @Before fun freshDevice() { runBlocking { application.protectedStore.erase() } }
    @After fun cleanup() { activity?.close(); runBlocking { application.protectedStore.erase() } }

    @Test fun decliningCameraPermissionKeepsPastedInvitationsAvailableWithoutSubmittingAJoin() = with(NativeUIActions(compose)) {
        PlayUIFixture().use { fixture ->
            activity = ActivityScenario.launch(MainActivity::class.java)
            click("Join with a code or link")
            click("Scan invitation QR")
            click("Allow camera for QR scanning")
            val deny = UiDevice.getInstance(instrumentation).wait(Until.findObject(
                By.res("com.android.permissioncontroller", "permission_deny_button")), 10_000)
            requireNotNull(deny).click()
            visible("Camera access is off. You can paste a link or type the code.")
            fill("Invitation link or game code", fixture.invite.appLink)
            click("Open invitation")
            visible(fixture.invite.server)
            assertEquals(fixture.invite, runBlocking { application.protectedStore.load() }.invitation)
            assertNull(runBlocking { application.protectedStore.load() }.admission)
            assertTrue(fixture.server.received.none { it.method == "POST" })
        }
    }

    @Test fun coldInvitationCreatesAnIsolatedProfileAndPlaysCardsCluesAndMission() = with(NativeUIActions(compose)) {
        PlayUIFixture().use { fixture ->
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fixture.invite.appLink))
                .setPackage(instrumentation.targetContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity = ActivityScenario.launch(intent)
            activity?.onActivity { assertTrue(it.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) }
            visible("Join a game")
            visible(fixture.invite.server)
            allowLocalNetwork()
            fill("Your name", "Sam")
            click("Create my own persistent learner profile on this server.")
            click("Request a profile and join")
            click("Enter accepted game")
            visible("A game for two", absent = true)
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("play.room.fixture-room").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("play.room.fixture-room").performScrollTo().assertIsDisplayed()
            val choices = (fixture.round("initial-0-GUEST").content as Prediction).choices
            visible(choices.first().supportText.orEmpty(), absent = true)
            click("Show meanings")
            visible(choices.first().supportText.orEmpty())
            click("Hide meanings")
            visible(choices.first().supportText.orEmpty(), absent = true)
            click("${choices.first().symbol} ${choices.first().text}")
            visible("You picked the same card!")

            fixture.advance("clue-2-GUEST")
            fill("What is the word?", "Brot")
            click("Make your guess")
            click("I understood")
            visible("You understood each other.")

            fixture.advance("message-1-4-GUEST")
            val secondLine = (fixture.round("message-2-4-GUEST").content as Mission).messages.last().text
            fill("Your next line", secondLine)
            click("Send message")
            visible("You: $secondLine")
            fixture.advance("message-3-4-GUEST")
            val twist = requireNotNull((fixture.round("message-3-4-GUEST").content as Mission).twist)
            visible("A twist: $twist")
            fill("Your next line", (fixture.round("message-4-4-GUEST").content as Mission).messages.last().text)
            click("Send message")
            click("Mission achieved")
            click("I understood")
            visible("A little more of each other's language")
            visible("Your partner achieved their mission.")
            visible("Your picks matched.")
            click("Keep language · round 1")
            click(choices.first().text)
            click("Save privately")
            visible("Saved privately to your notebook.")
            click("Back to Play")
            click("Your phrase notebook")
            visible(choices.first().text)
            val saved = runBlocking { application.protectedStore.load() }
            assertEquals(fixture.token, saved.connection?.token)
            assertNull(saved.admission)
            assertTrue(fixture.server.received.any { it.path.endsWith("/ack") })
            assertTrue(fixture.server.received.filter { it.path.startsWith("/api/v1/play/") }
                .all { it.headers["cookie"] == null && it.headers["origin"] == null })
            assertTrue(fixture.server.protocolFailures.joinToString { it.message.orEmpty() }, fixture.server.protocolFailures.isEmpty())
        }
    }

}
