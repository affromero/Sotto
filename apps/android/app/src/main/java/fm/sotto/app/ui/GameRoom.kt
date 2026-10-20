package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.games.RoundGame
import fm.sotto.app.ui.qr.InviteCode
import fm.sotto.app.ui.platform.localNetworkAccess

@Composable fun GameRoom(coordinator: PlayCoordinator, state: PlayState) {
    val network = localNetworkAccess(state.vault?.connection?.server)
    val room = state.room
    if (room == null) { Text(if (state.accessRevoked) "This profile can no longer open the game." else "Opening game…"); return }
    val ready = state.active && network && !state.busy && !state.checking && !state.accessRevoked && state.vault?.pending == null
    Text(room.kind.title, style = MaterialTheme.typography.headlineMedium)
    Text("${room.host.name} + ${room.guest?.name ?: "your partner"} · ${room.points} shared points")
    if (room.status == RoomStatus.WAITING) {
        Text("A seat for your partner", style = MaterialTheme.typography.titleLarge)
        Text(if (state.leaseReady) "Stay here while your partner enters." else if (room.ownSeat == Seat.HOST)
            "Connecting your waiting presence…" else "The host will start when you are both ready.")
        if (room.ownSeat == Seat.HOST) {
            state.invitation?.let { link -> state.vault?.connection?.let { connection ->
                InviteCode(PlayInvitation(connection.server, link.code))
            } }
            Action(if (state.invitation == null) "Create invitation" else "Replace invitation", ready) { coordinator.run { rotateInvitation() } }
            state.requests.forEach { PendingPerson(coordinator, it, ready && state.leaseReady) }
        }
    }
    room.round?.let { round -> key(round.id) {
        RoundGame(coordinator, state, room, round, ready)
    } }
    if (room.status == RoomStatus.COMPLETED) {
        Text("A little more of each other's language", style = MaterialTheme.typography.titleLarge)
        Text("${room.points} shared points. Keep words you want to use again.")
        room.completedRounds.forEach { round ->
            RoundSummary(room, round)
            PhraseCapture(coordinator, room, round, ready)
        }
        room.rematchRoomId?.let { next -> Action("Open your rematch", ready) { coordinator.navigate(Screen.Room(next)) } }
    }
    room.allowedActions.forEach { action ->
        val label = when (action) {
            RoomAction.START -> "Start playing"
            RoomAction.NEXT_ROUND -> "Next round"
            RoomAction.REMATCH -> "Play again"
            RoomAction.LEAVE -> "Leave game"
            RoomAction.CANCEL -> "Close game"
        }
        Action(label, ready, action in listOf(RoomAction.LEAVE, RoomAction.CANCEL)) { coordinator.run { roomAction(action, room) } }
    }
    if (room.status in listOf(RoomStatus.EXPIRED, RoomStatus.CANCELLED)) Text(room.status.name.humanize())
}

@Composable private fun RoundSummary(room: PlayRoom, round: PlayRound) {
    Text("Round ${round.header.order + 1} · ${round.header.targetLang.uppercase()}", style = MaterialTheme.typography.titleLarge)
    Text(round.header.prompt)
    when (val value = round.content) {
        is Prediction -> {
            value.ownAnswer?.let { Text("You: ${value.label(it)}") }
            value.otherAnswer?.let { Text("Partner: ${value.label(it)}") }
        }
        is Describe -> {
            value.target?.let { Text("Target: $it") }
            value.clue?.let { Text("Clue: $it") }
            value.guess?.let { Text("Guess: $it") }
        }
        is Mission -> {
            Text("Your mission: ${value.ownObjective}")
            value.otherObjective?.let { Text("Partner's mission: $it") }
            value.messages.forEach { Text("${if (it.seat == room.ownSeat) "You" else "Partner"}: ${it.text}") }
            value.ownOutcome?.let { Text(if (it) "You achieved your mission." else "Your mission stayed unfinished.") }
            value.otherOutcome?.let { Text(if (it) "Your partner achieved their mission." else "Your partner's mission stayed unfinished.") }
        }
    }
    round.header.result?.let { result ->
        Text(when {
            result.skipped -> "Skipped"
            result.matched == true -> "Your picks matched."
            result.matched == false -> "Your picks were different."
            result.understood == true -> "You understood each other."
            else -> "More practice together next time."
        })
        result.correction?.let { Text("A natural way to say it: $it") }
        Text("${result.points} shared points")
    }
}
