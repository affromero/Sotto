package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalUriHandler
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.network.NetworkAccess

@Composable fun ConductText(policy: ConductPolicy?, server: String) {
    val links = LocalUriHandler.current
    if (policy == null) { Text("Loading this server's conduct policy…"); return }
    Text(policy.title, style = MaterialTheme.typography.titleLarge)
    policy.paragraphs.forEach { Text(it) }
    Action("Server terms", secondary = true) { links.openUri("$server/terms") }
    Action("Server privacy policy", secondary = true) { links.openUri("$server/privacy") }
    policy.operatorContactUrl?.takeIf { it.startsWith("mailto:") }?.let { address ->
        Action("Contact this server's operator", secondary = true) { links.openUri(address) }
    }
}

@Composable fun PlaySafety(coordinator: PlayCoordinator, state: PlayState) {
    val connection = state.vault?.connection ?: return
    val links = LocalUriHandler.current
    val ready = state.active && !state.busy && !state.accessRevoked && NetworkAccess.allowedFor(connection.server)
    val canSend = ready && state.vault.pendingSafety == null
    val canConfirm = !state.busy && !state.accessRevoked && state.vault.pendingSafety == null && NetworkAccess.allowedFor(connection.server)
    var accepted by remember(state.policy?.version) { mutableStateOf(false) }
    var confirmBlock by remember { mutableStateOf(false) }
    var unblock by remember { mutableStateOf<PlayerBlock?>(null) }
    var category by remember { mutableStateOf(ReportCategory.HARASSMENT) }
    val evidence = state.safetyRoom?.reportableEvidence().orEmpty()
    var selected by remember(state.safetyRoom) { mutableStateOf(evidence.firstOrNull()) }
    val detailKey = "${connection.server}/${connection.profile.id}/safety/report/${state.safetyRoom?.id}"
    val (detail, changeDetail) = protectedDraft(coordinator, state, detailKey)
    Text("Game safety", style = MaterialTheme.typography.headlineMedium)
    ConductText(state.policy, connection.server)
    if (state.safety?.acceptedVersion != CONDUCT_VERSION) {
        LabeledToggle("I agree to this conduct policy.", accepted, canSend && state.policy != null) { accepted = it }
        Action("Accept conduct policy", canSend && accepted && state.policy != null) { coordinator.runSafety { acceptConduct() } }
    } else Text("You accepted the current conduct policy.")
    if (state.safety?.sharingRestricted == true)
        Text("The server owner has restricted this profile from sharing in partner games. Your private learning remains separate.")
    if (state.safety?.canReviewReports == true) {
        Text("Review reports by signing in as the server owner in your browser.")
        Action("Open owner report review", ready, true) { links.openUri("${connection.server}/play/safety/review") }
    }
    state.safetyRoom?.takeIf { it.guest != null }?.let { room ->
        val partnerId = if (room.ownSeat == Seat.HOST) room.guest?.id else room.host.id
        val blocked = state.blocks.any { it.blockedUserId == partnerId }
        Text("This partner", style = MaterialTheme.typography.titleLarge)
        Action(if (blocked) "Partner blocked" else "Block partner", canSend && !blocked, true) { confirmBlock = true }
        if (evidence.isNotEmpty()) {
            Text("Report selected content or player", style = MaterialTheme.typography.titleLarge)
            Text("The selected visible text and your explanation go to this server's owner.")
            Menu("Content to report", selected ?: evidence.first(), evidence.map { it to it.text }, canSend) { selected = it }
            selected?.let { Text("Selected content: ${it.text}") }
            Menu("Reason", category, ReportCategory.entries.map { it to it.name.humanize() }, canSend) { category = it }
            Field("Explanation (optional, up to 500 characters)", detail, canSend, false, onChange = changeDetail)
            Action("Send report", canSend && selected != null) {
                val chosen = requireNotNull(selected)
                coordinator.runSafety { reportPartner(room, chosen, category, detail) }
            }
        }
    }
    Text("Your blocks", style = MaterialTheme.typography.titleLarge)
    if (state.blocks.isEmpty()) Text("You have no saved blocks.")
    state.blocks.forEach { item ->
        Text(item.name)
        Action("Unblock ${item.name}", canSend, true) { unblock = item }
    }
    if (state.blocksCursor != null) Action("More blocks", ready, true) { coordinator.run { refreshSafety(olderBlocks = true) } }
    Text("Your reports and owner responses", style = MaterialTheme.typography.titleLarge)
    if (state.reports.isEmpty()) Text("No reports to show.")
    state.reports.forEach { item ->
        Text("${item.category.name.humanize()} · ${item.status.name.humanize()}")
        Text(item.evidence.text)
        if (item.detail.isNotEmpty()) Text(item.detail)
        item.response?.let { Text("Server owner: $it") }
    }
    if (state.reportsCursor != null) Action("More reports", ready, true) { coordinator.run { refreshSafety(olderReports = true) } }
    Action("Refresh safety settings", ready, true) { coordinator.run { refreshSafety() } }
    if (confirmBlock) AlertDialog(onDismissRequest = { confirmBlock = false }, title = { Text("Block this partner?") },
        text = { Text("This ends your active games together and prevents new games between these profiles. Unblocking will not reopen old games.") },
        confirmButton = { TextButton({ confirmBlock = false; coordinator.confirm(safety = true) { blockPartner(requireNotNull(state.safetyRoom)) } }, enabled = canConfirm) { Text("Block partner") } },
        dismissButton = { TextButton({ confirmBlock = false }) { Text("Cancel") } })
    unblock?.let { item -> AlertDialog(onDismissRequest = { unblock = null }, title = { Text("Unblock ${item.name}?") },
        text = { Text("You can play together again. Old games stay closed.") },
        confirmButton = { TextButton({ unblock = null; coordinator.confirm(safety = true) { unblockPartner(item) } }, enabled = canConfirm) { Text("Unblock") } },
        dismissButton = { TextButton({ unblock = null }) { Text("Cancel") } }) }
}
