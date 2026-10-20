package fm.sotto.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import fm.sotto.app.network.NetworkAccess
import androidx.test.espresso.Espresso

class NativeUIActions(private val compose: ComposeTestRule) {
    fun allowLocalNetwork() {
        if (android.os.Build.VERSION.SDK_INT < 37 || NetworkAccess.permissionGranted()) return
        click("Allow local network access")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val allow = device.wait(Until.findObject(By.res("com.android.permissioncontroller", "permission_allow_button")), 10_000)
        requireNotNull(allow) { "Android did not show its local network permission request." }.click()
        compose.waitUntil(10_000) { NetworkAccess.permissionGranted() }
    }
    fun visible(text: String, absent: Boolean = false) {
        compose.waitUntil(15_000) {
            val nodes = compose.onAllNodesWithText(text, substring = false).fetchSemanticsNodes()
            if (absent) nodes.isEmpty() else nodes.isNotEmpty()
        }
        if (!absent) compose.onAllNodesWithText(text).onFirst().performScrollTo().assertIsDisplayed()
    }
    fun click(text: String) {
        val matcher = hasText(text) and hasClickAction() and isEnabled()
        compose.waitUntil(15_000) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodes(matcher).onFirst().performScrollTo().assertIsDisplayed().performClick()
    }
    fun fill(label: String, text: String) {
        val matcher = hasText(label) and hasSetTextAction() and isEnabled()
        compose.waitUntil(15_000) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        compose.onNode(matcher).performScrollTo().assertIsDisplayed().performTextReplacement(text)
        Espresso.closeSoftKeyboard()
    }
}
