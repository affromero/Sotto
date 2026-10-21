package fm.sotto.app.process

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import fm.sotto.app.MainActivity
import fm.sotto.app.NativeUIActions
import fm.sotto.app.SottoApplication
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.network.NetworkAccess
import kotlinx.coroutines.runBlocking
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI

@ExternalProcessTest
@RunWith(AndroidJUnit4::class)
class PlayProcessDeathTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val application get() = instrumentation.targetContext.applicationContext as SottoApplication
    private var activity: ActivityScenario<MainActivity>? = null
    @After fun closeActivity() { activity?.close() }

    @Test fun saveDeliveredCredentialAndUncertainActionBeforeTheProcessIsKilled() = with(NativeUIActions(compose)) {
        val invite = requireNotNull(PlayInvitation.parse(requireNotNull(InstrumentationRegistry.getArguments().getString("invitation"))))
        require(URI(invite.server).host == "10.0.2.2") { "The external fixture must use the emulator's local-network host bridge." }
        runBlocking { application.protectedStore.erase() }
        activity = ActivityScenario.launch(Intent(Intent.ACTION_VIEW, Uri.parse(invite.appLink))
            .setPackage(instrumentation.targetContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        visible("Join a game")
        if (Build.VERSION.SDK_INT >= 37 && !NetworkAccess.permissionGranted()) {
            val destination = URI(invite.server)
            val blocked = runCatching { Socket().use { it.connect(InetSocketAddress(destination.host, destination.port), 2000) } }.isFailure
            assertTrue("A local-network socket must be blocked before permission is granted", blocked)
            click("Allow local network access")
            denyPermission()
            visible("Access is still off. Your saved profiles and requests are kept. You can change the permission in Android Settings.")
            assertNull(runBlocking { application.protectedStore.load() }.admission)
            assertNull(runBlocking { application.protectedStore.load() }.connection)
        }
        allowLocalNetwork()
        click("I agree to this conduct policy before sharing my name or game content.")
        fill("Your name", "Sam")
        click("Create my own persistent learner profile on this server.")
        click("Request a profile and join")
        click("Enter accepted game")
        click("Keep recovery and open another invitation")
        click("Create game")
        visible("An action needs recovery. Its original request is saved.")
        val saved = runBlocking { application.protectedStore.load() }
        assertNotNull(saved.pending)
        val recovery = saved.retainedAdmissions.single()
        assertEquals(recovery.delivery?.token, saved.connection?.token)
        assertTrue(recovery.proof.matches(Regex("[A-Za-z0-9_-]{43}")))
        assertNull(saved.admission)
        reportProcess("before")
    }

    @Test fun recoverTheOriginalActionAndCredentialAfterARealProcessRestart() = with(NativeUIActions(compose)) {
        val before = runBlocking { application.protectedStore.load() }
        val pending = requireNotNull(before.pending)
        val delivery = requireNotNull(before.retainedAdmissions.single().delivery)
        assertEquals(delivery.token, before.connection?.token)
        activity = ActivityScenario.launch(MainActivity::class.java)
        visible("An action needs recovery. Its original request is saved.")
        allowLocalNetwork()
        click("Retry saved action")
        visible("A seat for your partner")
        val recovered = runBlocking { application.protectedStore.load() }
        assertNull(recovered.pending)
        assertEquals(pending.connection, recovered.connection)
        click("Back to Play")
        click("Saved connections and recoveries")
        click("Resume Sam")
        click("Finish saving profile")
        val finished = runBlocking {
            kotlinx.coroutines.withTimeout(10_000) {
                var saved = application.protectedStore.load()
                while (saved.admission != null) { kotlinx.coroutines.delay(20); saved = application.protectedStore.load() }
                saved
            }
        }
        assertEquals(delivery.token, finished.connection?.token)
        assertTrue(finished.retainedAdmissions.isEmpty())
        assertNull(finished.pending)
        reportProcess("after")
        runBlocking { application.protectedStore.erase() }
    }

    private fun reportProcess(stage: String) {
        instrumentation.sendStatus(0, Bundle().apply {
            putString("processStage", stage)
            putInt("processPid", Process.myPid())
        })
    }
}
