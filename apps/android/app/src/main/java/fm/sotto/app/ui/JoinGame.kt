package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.qr.InviteScanner
import fm.sotto.app.ui.platform.localNetworkAccess

@Composable fun JoinGame(coordinator: PlayCoordinator, state: PlayState) {
    val invite = state.vault?.admission?.invitation ?: state.vault?.invitation
    var server by remember { mutableStateOf(state.vault?.connection?.server.orEmpty()) }
    var code by remember { mutableStateOf("") }
    var scanning by remember { mutableStateOf(false) }
    var settings by remember(invite) { mutableStateOf(Settings()) }
    var name by remember(invite) { mutableStateOf("") }
    var existing by remember(invite) { mutableStateOf(false) }
    var consent by remember(invite) { mutableStateOf(false) }
    val ready = state.active && !state.busy && !state.checking
    Text("Join a game", style = MaterialTheme.typography.headlineMedium)
    val network = localNetworkAccess(invite?.server ?: PlayInvitation.parse(code)?.server ?: PlayInvitation.typedServer(server))
    if (invite == null) {
        Text("Paste an invitation, or enter its server and game code.")
        Field("Invitation link or game code", code, ready) { code = it }
        Field("Server address", server, ready) { server = it }
        Action("Open invitation", ready && code.isNotBlank()) {
            coordinator.run {
                val parsed = PlayInvitation.parse(code) ?: PlayInvitation(
                    requireNotNull(PlayInvitation.typedServer(server)) { "Enter the inviting server address." },
                    requireNotNull(PlayInvitation.normalizeCode(code)) { "Use a valid 12-character game code." })
                acceptInvitation(parsed)
            }
        }
        Action(if (scanning) "Close scanner" else "Scan invitation QR", ready, true) { scanning = !scanning }
        if (scanning) InviteScanner { scanned ->
            code = scanned
            scanning = false
        }
        return
    }
    Text(invite.server, style = MaterialTheme.typography.titleLarge)
    Text("Game ${invite.formattedCode}")
    state.preview?.let {
        Text("${it.hostName} invited you to ${it.kind.title.lowercase()}.")
        Text(if (it.hostWaiting) "The host is waiting." else "The host must open this game before you can enter.")
    }
    val pending = state.vault?.admission
    if (pending != null) {
        Text(state.joinStatus?.name?.humanize() ?: "Checking your request…", style = MaterialTheme.typography.titleLarge)
        Text("New profiles need the server owner's approval. The game host must also be present and accept you.")
        if (pending.existingConnection != null && pending.existingConnection != state.vault.connection)
            Action("Restore original profile", ready && fm.sotto.app.network.NetworkAccess.allowedFor(pending.existingConnection.server)) { coordinator.run { switchConnection(pending.existingConnection) } }
        Action("Retry join request", ready && network && pending.delivery == null) { coordinator.run { retryIntake() } }
        Action(if (pending.delivery != null) "Finish saving profile" else "Enter accepted game",
            ready && network && (pending.delivery != null || state.joinStatus in listOf(JoinStatus.ACCEPTED, JoinStatus.CLAIMED))) {
            coordinator.run { finishAdmission() }
        }
        if (pending.delivery != null) Action("Keep recovery and open another invitation", ready, true) { coordinator.run { retainAdmission() } }
        else Action("Discard invitation", ready, true) { coordinator.run { discardInvitation() } }
        return
    }
    val canUseExisting = state.vault?.connection?.server == invite.server
    if (canUseExisting) LabeledToggle("Join as ${state.vault.connection.profile.name}", existing, ready) { existing = it }
    else Action("Pair an existing profile on this server", ready, true) { coordinator.navigate(Screen.Pair) }
    if (!existing) Field("Your name", name, ready) { name = it.take(80) }
    SettingsFields(settings, ready) { settings = it }
    if (!existing) LabeledToggle("Create my own persistent learner profile on this server.", consent, ready) { consent = it }
    Action(if (existing) "Request to join as ${state.vault?.connection?.profile?.name}" else "Request a profile and join",
        ready && network && settings.valid && (existing && canUseExisting || !existing && consent && name.isNotBlank())) {
        coordinator.run { join(settings, name, existing) }
    }
    Action("Choose another invitation", ready, true) { coordinator.run { discardInvitation() } }
}
