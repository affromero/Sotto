package fm.sotto.app.ui.games

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.*

@Composable fun RoundGame(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom, round: PlayRound, ready: Boolean) {
    val header = round.header
    Text("ROUND ${header.order + 1} · ${header.targetLang.uppercase()} · ${header.level} · ${header.role.name.humanize()}",
        style = MaterialTheme.typography.labelLarge)
    Text(header.prompt, style = MaterialTheme.typography.headlineMedium)
    Text(header.instruction)
    Text(header.guidance, style = MaterialTheme.typography.bodyMedium)
    when (val content = round.content) {
        is Prediction -> PredictionGame(coordinator, state, room, round, content, ready)
        is Describe -> DescribeGame(coordinator, state, room, round, content, ready)
        is Mission -> MissionGame(coordinator, state, room, round, content, ready)
    }
    header.hints.forEach { Text("Hint: ${it.text}") }
    if (ActionType.FEEDBACK in header.allowedActions) Feedback(coordinator, state, room, round, ready)
    if (ActionType.HINT in header.allowedActions) TextCommand(coordinator, state, room, round, ActionType.HINT,
        "Give your partner a hint", "Send hint", ready)
    if (ActionType.SKIP in header.allowedActions) Action("Skip this round", ready, true) {
        coordinator.run { command(Command(ActionType.SKIP), room) }
    }
    header.result?.let { result ->
        Text(when {
            result.skipped -> "Round skipped"
            result.matched == true -> "You picked the same card!"
            result.matched == false -> "Different picks. Something new to remember."
            result.understood == true -> "You understood each other."
            else -> "Round complete"
        }, style = MaterialTheme.typography.titleLarge)
        result.correction?.let { Text("A natural way to say it: $it") }
        Text("${result.points} shared points")
    }
    PhraseCapture(coordinator, room, round, ready)
}

@Composable private fun PredictionGame(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom,
                                       round: PlayRound, value: Prediction, ready: Boolean) {
    if (value.questionStyle == QuestionStyle.CHOICES) ChoiceCards(value.choices,
        selected = value.ownAnswer, enabled = ready && ActionType.CHOOSE in round.header.allowedActions) { option ->
        coordinator.run { command(Command(ActionType.CHOOSE, optionId = option), room) }
    }
    else if (ActionType.ANSWER in round.header.allowedActions)
        TextCommand(coordinator, state, room, round, ActionType.ANSWER, "Your answer", "Commit your answer", ready)
    value.ownAnswer?.let { Text("Your pick: ${value.label(it)}") }
    value.otherAnswer?.let { Text("Your partner: ${value.label(it)}") }
    if (value.ownAnswer != null && value.otherAnswer == null) Text("Your pick is hidden. Waiting for your partner.")
    else if (value.otherCommitted && value.ownAnswer == null) Text("Your partner has committed a hidden pick.")
}

@Composable private fun DescribeGame(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom,
                                     round: PlayRound, value: Describe, ready: Boolean) {
    if (ActionType.SET_TARGET in round.header.allowedActions) {
        if (!value.targetSuggestions.isNullOrEmpty()) ChoiceCards(value.targetSuggestions, null, ready) { option ->
            val target = value.targetSuggestions.first { it.id == option }.text
            coordinator.run { command(Command(ActionType.SET_TARGET, text = target), room) }
        }
        TextCommand(coordinator, state, room, round, ActionType.SET_TARGET, "Your own word or phrase", "Use this target", ready)
    }
    value.target?.let { Text(if (round.header.revealed) "The target: $it" else "Your private target: $it", style = MaterialTheme.typography.titleLarge) }
    value.clue?.let { Text("Clue: $it") }
    value.guess?.let { Text("Guess: $it") }
    if (ActionType.GIVE_CLUE in round.header.allowedActions)
        TextCommand(coordinator, state, room, round, ActionType.GIVE_CLUE, "A clue without the target word", "Send clue", ready)
    if (ActionType.GUESS in round.header.allowedActions)
        TextCommand(coordinator, state, room, round, ActionType.GUESS, "What is the word?", "Make your guess", ready)
}

@Composable private fun MissionGame(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom,
                                    round: PlayRound, value: Mission, ready: Boolean) {
    Text("Your secret mission", style = MaterialTheme.typography.titleLarge)
    Text(value.ownObjective)
    value.otherObjective?.let { Text("Your partner's mission: $it") }
    value.twist?.let { Text("A twist: $it", style = MaterialTheme.typography.titleLarge) }
    Text("${value.remainingMessages} messages left together")
    value.messages.forEach { message ->
        Text("${if (message.seat == room.ownSeat) "You" else "Partner"}: ${message.text}")
    }
    if (ActionType.MESSAGE in round.header.allowedActions)
        TextCommand(coordinator, state, room, round, ActionType.MESSAGE, "Your next line", "Send message", ready)
    else if (round.header.phase == Phase.EXCHANGE) Text("Your partner's turn.")
    if (ActionType.MISSION_DONE in round.header.allowedActions) {
        Text("Did you achieve your mission?")
        Action("Mission achieved", ready) { coordinator.run { command(Command(ActionType.MISSION_DONE, achieved = true), room) } }
        Action("Not this time", ready, true) { coordinator.run { command(Command(ActionType.MISSION_DONE, achieved = false), room) } }
    }
    value.ownOutcome?.let { Text(if (it) "Your mission is marked achieved." else "Your mission is marked incomplete.") }
    value.otherOutcome?.let { Text(if (it) "Your partner achieved their mission." else "Your partner did not achieve their mission.") }
}
