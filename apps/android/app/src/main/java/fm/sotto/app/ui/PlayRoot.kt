package fm.sotto.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import fm.sotto.app.play.*
import fm.sotto.app.network.NetworkAccess
import fm.sotto.app.ui.legal.PrivacyLegal

@Composable fun PlayRoot(coordinator: PlayCoordinator) {
    val state by coordinator.state.collectAsStateWithLifecycle()
    var discardID by remember { mutableStateOf<String?>(null) }
    var discardSafetyID by remember { mutableStateOf<String?>(null) }
    var privacy by remember { mutableStateOf(false) }
    BackHandler(state.screen != Screen.Lobby) { coordinator.navigate(Screen.Lobby) }
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Sotto", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
                Action("Privacy and licenses", secondary = true) { privacy = true }
                state.vault?.connection?.let { Text("${it.profile.name} · ${it.server}", style = MaterialTheme.typography.labelLarge) }
                if (state.screen != Screen.Lobby) Action("Back to Play", secondary = true) { coordinator.navigate(Screen.Lobby) }
                if (state.checking || state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                state.error?.let { Text(it, color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }) }
                if (state.error != null && state.networkHelp && android.os.Build.VERSION.SDK_INT >= 37 && !NetworkAccess.permissionGranted())
                    Text("If your server's hostname points to this network, allow local network access in Saved connections and retry.")
                state.notice?.let { Text(it, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
                if (state.vault == null) {
                    Text("Your saved game data stays protected until it can be read.")
                    Action("Retry saved data", !state.busy) { coordinator.run { retrySavedData() } }
                    SavedData(coordinator, state)
                    return@Column
                }
                state.vault?.pending?.let { pending ->
                    Text("An action needs recovery. Its original request is saved.", style = MaterialTheme.typography.titleMedium)
                    if (pending.connection == state.vault?.connection)
                        Action("Retry saved action", state.active && !state.busy && !state.checking && !state.accessRevoked && state.vault?.pendingSafety == null && NetworkAccess.allowedFor(pending.connection.server)) { coordinator.run { retryAction() } }
                    else Action("Restore original profile", state.active && !state.busy && !state.checking && NetworkAccess.allowedFor(pending.connection.server)) { coordinator.run { switchConnection(pending.connection) } }
                    Action("Discard pending action", !state.busy, secondary = true) { discardID = pending.id }
                }
                state.vault?.pendingSafety?.let { pending ->
                    Text("A safety action needs recovery. Its exact request is protected.")
                    if (pending.connection == state.vault?.connection)
                        Action("Retry saved safety action", state.active && !state.busy && !state.accessRevoked && NetworkAccess.allowedFor(pending.connection.server)) {
                            coordinator.runSafety { retrySafety() }
                        }
                    else Action("Restore safety action profile", state.active && !state.busy && NetworkAccess.allowedFor(pending.connection.server)) {
                        coordinator.run { switchConnection(pending.connection) }
                    }
                    Action("Discard saved safety action", !state.busy, true) { discardSafetyID = pending.id }
                }
                key(state.identityGeneration) {
                    when (state.screen) {
                        Screen.Lobby -> Lobby(coordinator, state)
                        Screen.Join -> JoinGame(coordinator, state)
                        Screen.Pair -> PairServer(coordinator, state)
                        Screen.Notebook -> Notebook(coordinator, state)
                        Screen.Saved -> SavedData(coordinator, state)
                        Screen.Safety -> PlaySafety(coordinator, state)
                        is Screen.Room -> GameRoom(coordinator, state)
                    }
                }
            }
        }
    }
    if (privacy) PrivacyLegal { privacy = false }
    discardSafetyID?.let { id -> AlertDialog(onDismissRequest = { discardSafetyID = null },
        title = { Text("Discard this saved safety action?") },
        text = { Text("It may already have saved. Check your reports and blocks before submitting again. The original connection and drafts are kept.") },
        confirmButton = { TextButton({ discardSafetyID = null; coordinator.discardPendingSafety(id) }, enabled = !state.busy) { Text("Discard safety action") } },
        dismissButton = { TextButton({ discardSafetyID = null }) { Text("Keep recovery") } }) }
    discardID?.let { id -> AlertDialog(onDismissRequest = { discardID = null },
        title = { Text("Discard this pending action?") },
        text = { Text("It may already have saved. Your draft and original connection are kept. Check the game before submitting again.") },
        confirmButton = { TextButton({ discardID = null; coordinator.discardPendingAction(id) }, enabled = !state.busy) { Text("Discard action") } },
        dismissButton = { TextButton({ discardID = null }) { Text("Keep recovery") } }) }
}
