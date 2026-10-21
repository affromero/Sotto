package fm.sotto.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import fm.sotto.app.model.*
import fm.sotto.app.storage.*
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlaySafetyUITest {
    @get:Rule val compose = createEmptyComposeRule()
    private val application get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as SottoApplication
    private var activity: ActivityScenario<MainActivity>? = null
    @Before fun freshDevice() { runBlocking { application.protectedStore.erase() } }
    @After fun cleanup() { activity?.close(); runBlocking { application.protectedStore.erase() } }

    @Test fun conductBlockingReportingAndOwnerResponsesRemainAvailableDuringTurnRecovery() = with(NativeUIActions(compose)) {
        PlayUIFixture().use { fixture ->
            fixture.conductAccepted = false
            val member = requireNotNull(fixture.room().guest)
            val connection = Connection(fixture.server.origin, fixture.token, Profile(member.id, member.name, false, "USER"))
            val normal = PendingOperation(newID(), connection, "/api/v1/play/rooms/${fixture.room().id}/actions", "{}", OperationResponse.ROOM)
            runBlocking { application.protectedStore.update { it.copy(connection = connection, pending = normal,
                drafts = mapOf("turn" to "An unsent private turn")) } }
            activity = ActivityScenario.launch(MainActivity::class.java)
            allowLocalNetwork()
            visible("An action needs recovery. Its original request is saved.")
            compose.onNodeWithText("Create game").performScrollTo().assertIsNotEnabled()
            click("Game safety, reports and blocks")
            click("I agree to this conduct policy.")
            click("Accept conduct policy")
            visible("You accepted the current conduct policy.")
            click("Back to Play")
            click("${fixture.room().kind.title} · Playing · ${member.name}")
            click("Game safety, report or block")
            click("Block partner")
            compose.onNodeWithText("Block this partner?").assertIsDisplayed()
            compose.onAllNodesWithText("Block partner").filterToOne(hasAnyAncestor(isDialog())).performClick()
            visible("Unblock ${fixture.room().host.name}")
            compose.onNodeWithText("Partner blocked").performScrollTo().assertIsNotEnabled()
            fill("Explanation (optional, up to 500 characters)", "Please review this player name.")
            click("Send report")
            visible("Harassment · Open")
            fixture.respondToReports()
            click("Refresh safety settings")
            visible("Server owner: I have reviewed your report and closed the game.")
            click("Unblock ${fixture.room().host.name}")
            compose.onNode(hasText("Unblock") and hasAnyAncestor(isDialog())).assertIsEnabled().performClick()
            visible("You have no saved blocks.")
            click("Back to Play")
            visible("${fixture.room().kind.title} · Playing · ${member.name}", absent = true)
            val saved = runBlocking { application.protectedStore.load() }
            assertEquals(normal, saved.pending)
            assertNull(saved.pendingSafety)
            assertEquals(connection, saved.connection)
            assertEquals("An unsent private turn", saved.drafts["turn"])
            val report = fixture.server.received.single { it.path.endsWith("/reports") && it.method == "POST" }
            assertTrue(report.body.contains("PARTNER_NAME"))
            assertTrue(report.body.contains("Please review this player name."))
            assertTrue(fixture.server.protocolFailures.joinToString { it.message.orEmpty() }, fixture.server.protocolFailures.isEmpty())
        }
    }
}
