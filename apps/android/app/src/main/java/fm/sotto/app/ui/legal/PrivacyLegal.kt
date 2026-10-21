package fm.sotto.app.ui.legal

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable fun PrivacyLegal(onClose: () -> Unit) {
    val context = LocalContext.current
    val browser = LocalUriHandler.current
    var error by remember { mutableStateOf<String?>(null) }
    var showLicenses by remember { mutableStateOf(false) }
    val notices by produceState<Result<String>?>(null) {
        value = withContext(Dispatchers.IO) {
            runCatching { context.assets.open("legal/notices.txt").bufferedReader().use { it.readText() } }
        }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState())
                .widthIn(max = 720.dp).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("Privacy and licenses", style = MaterialTheme.typography.headlineMedium)
                TextButton(onClick = onClose) { Text("Close") }
                Text("Your server and your data", style = MaterialTheme.typography.titleLarge)
                Text("Sotto connects to the server you choose. Its operator stores your profile, game answers, messages, phrase notebook and study activity. The Sotto project does not receive data from independently operated servers.")
                Text("On this device", style = MaterialTheme.typography.titleLarge)
                Text("QR codes are scanned locally after camera permission. Device credentials, invitation recovery, drafts and pending actions are encrypted with Android Keystore protection and excluded from backups. Sotto includes no advertising or tracking SDKs.")
                Text("Learning and other players", style = MaterialTheme.typography.titleLarge)
                Text("Games work without AI requests. Your partner sees content revealed by the game. Your phrase notebook stays private. Add to study explicitly saves a phrase to your profile's learning tools. Ask your server operator about any configured AI, speech or storage providers before using those tools.")
                Text("Game safety", style = MaterialTheme.typography.titleLarge)
                Text("Accept the conduct rules before sharing game content. You can report a partner's visible content to your server operator and block further games with that profile. Reports include the selected text, category and detail you submit. The operator can respond, end a room or restrict sharing. Game safety shows your own report responses and private block list. Unblocking requires a new invitation to play again.")
                Text("Connections", style = MaterialTheme.typography.titleLarge)
                Text("Public servers require HTTPS. Private and local servers may use HTTP, which does not encrypt the connection.")
                Text("Delete your profile", style = MaterialTheme.typography.titleLarge)
                Text("Open Saved connections and recoveries, then Delete learner profile. Confirm the named profile and server. This requests deletion of the profile and its associated learning and game data. Associated game reports and blocks are removed when a linked profile is deleted. Your operator controls retention in backups, logs and connected providers. Unpair and erase saved game data removes this device's saved data; it does not delete server data.")
                TextButton(onClick = {
                    try { browser.openUri("https://sotto.fm/privacy#delete-profile") }
                    catch (failure: Exception) { error = failure.message ?: "Could not open the privacy page." }
                }) { Text("Privacy and deletion help on the web") }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = { showLicenses = !showLicenses }) { Text(if (showLicenses) "Hide license notices" else "Read license notices") }
                if (showLicenses) {
                    val result = notices
                    when {
                        result == null -> CircularProgressIndicator()
                        result.isFailure -> Text("License notices could not be read. ${result.exceptionOrNull()?.message.orEmpty()}", color = MaterialTheme.colorScheme.error)
                        else -> Text(result.getOrThrow(), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
