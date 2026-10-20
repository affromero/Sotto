package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.platform.localNetworkAccess
import fm.sotto.app.network.NetworkAccess

@Composable fun SavedData(coordinator: PlayCoordinator, state: PlayState) {
    var erase by remember { mutableStateOf(false) }
    var removeConnection by remember { mutableStateOf<fm.sotto.app.model.Connection?>(null) }
    var removeRecovery by remember { mutableStateOf<String?>(null) }
    var removeDraft by remember { mutableStateOf<String?>(null) }
    var deletion by remember { mutableStateOf<fm.sotto.app.model.Connection?>(null) }
    val ready = !state.busy && !state.checking
    Text("Saved connections", style = MaterialTheme.typography.headlineMedium)
    localNetworkAccess(state.vault?.connection?.server, manual = true)
    state.vault?.archivedConnections?.forEach { connection ->
        Action("Use ${connection.profile.name} on ${connection.server}", ready && NetworkAccess.allowedFor(connection.server), true) { coordinator.run { switchConnection(connection) } }
        Action("Remove saved ${connection.profile.name}", ready, true) { removeConnection = connection }
    }
    state.vault?.retainedAdmissions?.forEach { recovery ->
        Text("Invitation recovery · ${recovery.invitation.server}")
        Action("Resume ${recovery.command.candidate.name ?: "profile"}", ready, true) { coordinator.run { resumeAdmission(recovery) } }
        Action("Remove this recovery", ready, true) { removeRecovery = recovery.command.requestId }
    }
    state.vault?.drafts?.filterKeys { key ->
        val connection = state.vault.connection
        connection != null && key.startsWith("${connection.server}/${connection.profile.id}/")
    }?.forEach { (key, text) ->
        Text(text)
        Action("Remove this saved draft", ready, true) { removeDraft = key }
    }
    Action("Unpair and erase saved game data", ready, true) { erase = true }
    state.vault?.connection?.let { connection ->
        Action("Delete learner profile", ready && state.active && !state.accessRevoked && NetworkAccess.allowedFor(connection.server), true) { deletion = connection }
    }
    deletion?.let { connection ->
        AlertDialog(onDismissRequest = { deletion = null },
            title = { Text("Delete ${connection.profile.name}?") },
            text = { Text("This requests permanent deletion of this profile, learning data and game history from ${connection.server}. Other profiles stay. Your operator controls retention in backups and connected providers. A failed or uncertain request keeps your saved access so you can check with the operator.") },
            confirmButton = { TextButton({ deletion = null; coordinator.confirm { deleteProfile(connection) } }, enabled = ready) { Text("Delete profile") } },
            dismissButton = { TextButton({ deletion = null }) { Text("Keep profile") } })
    }
    val confirming = erase || removeConnection != null || removeRecovery != null || removeDraft != null
    if (confirming) AlertDialog(onDismissRequest = { erase = false; removeConnection = null; removeRecovery = null; removeDraft = null },
        title = { Text(if (erase) "Erase saved data on this device?" else "Remove this saved item?") },
        text = { Text("Server profiles and game history stay on the server. A removed credential or recovery may be impossible to recover.") },
        confirmButton = { TextButton({
            val connection = removeConnection; val recovery = removeRecovery; val draft = removeDraft; val all = erase
            erase = false; removeConnection = null; removeRecovery = null; removeDraft = null
            coordinator.confirm {
                if (all) eraseSavedData()
                else persist {
                    require(connection == null || it.pending?.connection != connection) { "Recover the pending action before removing its credential." }
                    it.copy(archivedConnections = it.archivedConnections.filterNot { saved -> saved == connection },
                        retainedAdmissions = it.retainedAdmissions.filterNot { saved -> saved.command.requestId == recovery },
                        drafts = if (draft == null) it.drafts else it.drafts - draft)
                }
            }
        }, enabled = ready) { Text("Remove") } },
        dismissButton = { TextButton({ erase = false; removeConnection = null; removeRecovery = null; removeDraft = null }) { Text("Keep saved data") } })
}
