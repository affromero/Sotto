package fm.sotto.app

import android.graphics.Bitmap
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.storage.Vault
import fm.sotto.app.ui.SottoTheme
import fm.sotto.app.ui.games.RoundGame
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class GameLayoutTest {
    @get:Rule val compose = createComposeRule()

    @Test fun cardsAndMissionsStayReadableOnPhonesAndTabletsWithLargeTypeInBothThemes() {
        PlayUIFixture().use { fixture ->
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val application = instrumentation.targetContext.applicationContext as SottoApplication
            val scope = CoroutineScope(SupervisorJob())
            val coordinator = PlayCoordinator(application.protectedStore, scope, "Layout fixture")
            val dark = mutableStateOf(false)
            val large = mutableStateOf(false)
            val mission = mutableStateOf(false)
            val width = mutableStateOf(375)
            val widths = if (instrumentation.targetContext.resources.configuration.screenWidthDp >= 640) listOf(375, 640) else listOf(375)
            val room = fixture.room()
            try {
                compose.setContent {
                    val density = LocalDensity.current
                    CompositionLocalProvider(LocalDensity provides Density(density.density, if (large.value) 1.6f else 1f)) {
                        SottoTheme(dark.value) {
                            Surface(color = MaterialTheme.colorScheme.background) {
                                Column(Modifier.width(width.value.dp).height(740.dp).verticalScroll(rememberScrollState()).padding(20.dp)) {
                                    val round = fixture.round(if (mission.value) "message-3-4-GUEST" else "initial-0-GUEST")
                                    RoundGame(coordinator, PlayState(vault = Vault()), room.copy(round = round), round, true)
                                }
                            }
                        }
                    }
                }
                for (layoutWidth in widths) for (theme in listOf(false, true)) for (textSize in listOf(false, true)) for (mode in listOf(false, true)) {
                    compose.runOnIdle { width.value = layoutWidth; dark.value = theme; large.value = textSize; mission.value = mode }
                    compose.waitForIdle()
                    val prompt = fixture.round(if (mode) "message-3-4-GUEST" else "initial-0-GUEST").header.prompt
                    compose.onNodeWithText(prompt).performScrollTo().assertIsDisplayed()
                    val bounds = compose.onNodeWithText(prompt).fetchSemanticsNode().boundsInRoot
                    assertTrue(bounds.width > 0 && bounds.left >= 0)
                    assertTrue(bounds.right <= compose.onRoot().fetchSemanticsNode().boundsInRoot.right)
                    if (!mode) {
                        val first = (fixture.round("initial-0-GUEST").content as Prediction).choices.first()
                        compose.onNodeWithText("${first.symbol} ${first.text}").performScrollTo().assertIsDisplayed()
                        assertTrue(compose.onNodeWithText("${first.symbol} ${first.text}").fetchSemanticsNode().boundsInRoot.height >=
                            instrumentation.targetContext.resources.displayMetrics.density * 48)
                    }
                    val file = File(instrumentation.targetContext.cacheDir, "play-layout-$layoutWidth-$theme-$textSize-$mode.png")
                    file.outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it) }
                }
            } finally { scope.cancel() }
        }
    }
}
