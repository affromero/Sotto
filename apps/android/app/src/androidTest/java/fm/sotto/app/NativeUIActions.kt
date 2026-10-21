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
    fun denyPermission() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val selector = By.res("com.android.permissioncontroller", "permission_deny_button")
        val dialog = requireNotNull(device.wait(Until.findObject(selector), 10_000)) {
            "Android did not show its permission request."
        }
        val permissionPackage = dialog.applicationPackage
        compose.waitUntil(10_000) {
            instrumentation.uiAutomation.windows.any {
                it.isFocused && it.root?.packageName == permissionPackage
            }
        }
        device.waitForIdle(3000)
        val deny = requireNotNull(device.findObject(By.copy(selector).enabled(true).clickable(true))) {
            "The permission dialog closed before denial."
        }
        deny.click()
        check(device.wait(Until.gone(selector), 10_000)) {
            "Android did not dismiss its permission request after denial."
        }
    }
    fun allowLocalNetwork() {
        if (android.os.Build.VERSION.SDK_INT < 37 || NetworkAccess.permissionGranted()) return
        click("Allow local network access")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val selector = By.res("com.android.permissioncontroller", "permission_allow_button")
        val dialog = requireNotNull(device.wait(Until.findObject(selector), 10_000)) {
            "Android did not show its local network permission request."
        }
        val permissionPackage = dialog.applicationPackage
        val deadline = android.os.SystemClock.uptimeMillis() + 15_000
        while (!NetworkAccess.permissionGranted() && android.os.SystemClock.uptimeMillis() < deadline) {
            device.waitForIdle(3000)
            if (NetworkAccess.permissionGranted()) break
            compose.waitUntil(5000) {
                NetworkAccess.permissionGranted() || instrumentation.uiAutomation.windows.any {
                    it.isFocused && it.root?.packageName == permissionPackage
                }
            }
            if (NetworkAccess.permissionGranted()) break
            val allow = device.findObject(By.copy(selector).enabled(true).clickable(true))
            checkNotNull(allow) { "The local network permission dialog closed without granting access." }.click()
            device.wait(Until.gone(selector), 2000)
        }
        check(NetworkAccess.permissionGranted()) { "Android did not grant the requested local network access." }
        compose.waitUntil(10_000) { !device.hasObject(selector) }
    }
    fun visible(text: String, absent: Boolean = false) {
        try {
            compose.waitUntil(15_000) {
                val nodes = compose.onAllNodesWithText(text, substring = false)
                    .fetchSemanticsNodes(atLeastOneRootRequired = false)
                if (absent) nodes.isEmpty() && compose.onAllNodes(isRoot())
                    .fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty()
                else nodes.isNotEmpty()
            }
        } catch (error: ComposeTimeoutException) {
            val hierarchy = runCatching { compose.onRoot().printToString() }
                .getOrElse { "Compose hierarchy unavailable: ${it.message}" }
            throw AssertionError("Expected ${if (absent) "absent" else "visible"} text: $text\n$hierarchy", error)
        }
        if (!absent) compose.onAllNodesWithText(text).onFirst().performScrollTo().assertIsDisplayed()
    }
    fun click(text: String, timeoutMillis: Long = 15_000) {
        val matcher = hasText(text) and hasClickAction() and isEnabled()
        compose.waitUntil(timeoutMillis) { compose.onAllNodes(matcher)
            .fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty() }
        compose.onAllNodes(matcher).onFirst().performScrollTo().assertIsDisplayed().performClick()
    }
    fun fill(label: String, text: String) {
        val matcher = hasText(label) and hasSetTextAction() and isEnabled()
        compose.waitUntil(15_000) { compose.onAllNodes(matcher)
            .fetchSemanticsNodes(atLeastOneRootRequired = false).isNotEmpty() }
        compose.onNode(matcher).performScrollTo().assertIsDisplayed().performTextReplacement(text)
        Espresso.closeSoftKeyboard()
    }
}
