package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.platform.localNetworkAccess

@Composable fun Lobby(coordinator: PlayCoordinator, state: PlayState) {
    var settings by remember { mutableStateOf(Settings()) }
    var kind by remember { mutableStateOf(GameKind.MIXED) }
    var theme by remember { mutableStateOf(Theme.EVERYDAY) }
    var open by remember { mutableStateOf(false) }
    val ready = state.active && !state.busy && !state.checking && !state.accessRevoked && state.vault?.pending == null
    Text("A game for two", style = MaterialTheme.typography.headlineMedium)
    val network = localNetworkAccess(state.vault?.connection?.server)
    Text("Pick for each other, give a clue, or try a secret mission. Swap languages as you go.")
    Action("Join with a code or link", !state.busy) { coordinator.navigate(Screen.Join) }
    Action(if (state.vault?.connection == null) "Pair with your server" else "Pair another server", !state.busy, true) { coordinator.navigate(Screen.Pair) }
    if (state.vault?.connection != null) {
        Text("Start a game", style = MaterialTheme.typography.titleLarge)
        Menu("Game", kind, GameKind.entries.map { it to it.title }, ready) { kind = it }
        Menu("Theme", theme, Theme.entries.map { it to it.name.humanize() }, ready) { theme = it }
        SettingsFields(settings, ready) { settings = it }
        if (kind in listOf(GameKind.MIXED, GameKind.KNOW_ME)) {
            LabeledToggle("Use open questions instead of cards", open, ready) { open = it }
        }
        Text(if (kind == GameKind.MIXED) "Six short rounds, two of each game." else "Two rounds, with learning roles reversed.")
        Action("Create game", ready && network && settings.valid) { coordinator.run { create(kind, theme, settings, open) } }
        if (state.requests.isNotEmpty()) {
            Text("Profile requests", style = MaterialTheme.typography.titleLarge)
            state.requests.forEach { PendingPerson(coordinator, it, ready && network) }
        }
        if (state.rooms.isNotEmpty()) Text("Your games", style = MaterialTheme.typography.titleLarge)
        state.rooms.forEach { room ->
            Action("${room.kind.title} · ${room.status.name.humanize()} · ${room.guest?.name ?: "Waiting for a partner"}",
                !state.busy, true) { coordinator.navigate(Screen.Room(room.id)) }
        }
        if (state.roomsCursor != null) Action("Older games", ready && network, true) { coordinator.run { loadOlderRooms() } }
        Action("Your phrase notebook", !state.busy, true) { coordinator.navigate(Screen.Notebook) }
    }
    Action("Saved connections and recoveries", !state.busy, true) { coordinator.navigate(Screen.Saved) }
}

@Composable fun PendingPerson(coordinator: PlayCoordinator, request: PendingRequest, ready: Boolean) {
    Text("${request.name} · ${request.settings.targetLang.uppercase()} · ${request.status.name.humanize()}")
    request.allowedActions.forEach { type ->
        val label = when (type) {
            Approval.APPROVE_PROFILE -> "Approve ${request.name}'s profile"
            Approval.ACCEPT -> if (request.candidateKind == CandidateKind.NEW && request.profileId == null)
                "Create profile and admit ${request.name}" else "Admit ${request.name}"
            Approval.DECLINE -> "Decline ${request.name}"
        }
        Action(label, ready, type == Approval.DECLINE) { coordinator.run { approve(request, type) } }
    }
}
