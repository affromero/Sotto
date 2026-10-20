package fm.sotto.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import fm.sotto.app.model.SottoJson
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlayHostUITest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val application get() = instrumentation.targetContext.applicationContext as SottoApplication
    private var activity: ActivityScenario<MainActivity>? = null
    @Before fun freshDevice() { runBlocking { application.protectedStore.erase() } }
    @After fun cleanup() { activity?.close(); runBlocking { application.protectedStore.erase() } }

    @Test fun ownerPairsCreatesAndApprovesOnlyWhileTheirWaitingRoomIsFocused() = with(NativeUIActions(compose)) {
        HostUIFixture().use { fixture ->
            activity = ActivityScenario.launch(MainActivity::class.java)
            click("Pair with your server")
            fill("Server address", fixture.server.origin)
            allowLocalNetwork()
            click("Open server")
            click("Alex")
            visible("A game for two")
            click("Create game")
            visible("Stay here while your partner enters.")
            click("Create invitation")
            compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Game invitation QR code").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Game invitation QR code").performScrollTo().assertIsDisplayed()
            click("Create profile and admit Mia")
            click("Start playing")
            visible("Pick the card your partner will choose. Your picks stay hidden until both commit.")
            val approval = fixture.server.received.single { it.path.endsWith("/approve") }
            assertEquals("ACCEPT", SottoJson.parseToJsonElement(approval.body).jsonObject["type"]?.jsonPrimitive?.content)
            assertTrue(fixture.server.protocolFailures.joinToString { it.message.orEmpty() }, fixture.server.protocolFailures.isEmpty())
        }
    }

    @Test fun leavingTheWaitingAppReleasesPresenceAndReturningUsesANewNonce() = with(NativeUIActions(compose)) {
        HostUIFixture().use { fixture ->
            activity = ActivityScenario.launch(MainActivity::class.java)
            click("Pair with your server"); fill("Server address", fixture.server.origin); allowLocalNetwork(); click("Open server"); click("Alex")
            click("Create game")
            visible("Stay here while your partner enters.")
            UiDevice.getInstance(instrumentation).pressHome()
            compose.waitUntil(10_000) { fixture.server.received.any { it.path.endsWith("/presence") && it.body.contains("RELEASE") } }
            instrumentation.targetContext.startActivity(requireNotNull(instrumentation.targetContext.packageManager
                .getLaunchIntentForPackage(instrumentation.targetContext.packageName)))
            visible("Stay here while your partner enters.")
            compose.waitUntil(10_000) { fixture.server.received.filter { it.path.endsWith("/presence") && it.body.contains("RENEW") }.size >= 2 }
            val renewals = fixture.server.received.filter { it.path.endsWith("/presence") && it.body.contains("RENEW") }
                .map { SottoJson.parseToJsonElement(it.body).jsonObject["viewNonce"] }
            assertNotEquals(renewals.first(), renewals.last())
            assertTrue(fixture.server.protocolFailures.isEmpty())
        }
    }
}
