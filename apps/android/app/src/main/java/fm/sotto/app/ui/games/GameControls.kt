package fm.sotto.app.ui.games

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.Action
import fm.sotto.app.ui.Field
import kotlinx.coroutines.launch

@Composable fun ChoiceCards(choices: List<Choice>, selected: String?, enabled: Boolean, onPick: (Option) -> Unit) {
    var meanings by remember(choices) { mutableStateOf(false) }
    choices.forEach { choice ->
        OutlinedButton({ onPick(choice.id) }, Modifier.fillMaxWidth().heightIn(min = 64.dp), enabled = enabled,
            border = BorderStroke(if (selected == choice.id.name) 3.dp else 1.dp, MaterialTheme.colorScheme.primary)) {
            Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${choice.symbol} ${choice.text}", style = MaterialTheme.typography.titleLarge)
                if (meanings) choice.supportText?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            }
        }
    }
    if (choices.any { it.supportText != null }) Action(if (meanings) "Hide meanings" else "Show meanings", secondary = true) { meanings = !meanings }
}

@Composable private fun draft(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom, round: PlayRound,
                              action: ActionType): Pair<String, (String) -> Unit> {
    val key = coordinator.draftKey(room, round, action)
    val saved = state.vault?.drafts?.get(key).orEmpty()
    var text by remember(key) { mutableStateOf(saved) }
    var previous by remember(key) { mutableStateOf(saved) }
    LaunchedEffect(saved) {
        if (text == previous) text = saved
        previous = saved
    }
    val connection = state.vault?.connection
    return text to { next ->
        text = next.take(500)
        val value = text
        val generation = coordinator.epoch
        coordinator.scope.launch {
            try {
                coordinator.checkEpoch(generation, connection)
                coordinator.persist {
                    require(it.connection == connection)
                    it.copy(drafts = if (value.isEmpty()) it.drafts - key else it.drafts + (key to value))
                }
            } catch (_: kotlinx.coroutines.CancellationException) { }
            catch (error: Exception) { if (coordinator.epoch == generation) coordinator.report(error) }
        }
    }
}

@Composable fun TextCommand(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom, round: PlayRound,
                            action: ActionType, label: String, button: String, ready: Boolean) {
    val (text, change) = draft(coordinator, state, room, round, action)
    Field(label, text, ready, false, onChange = change)
    Action(button, ready && text.isNotBlank()) {
        val captured = text.trim()
        coordinator.run { command(Command(action, text = captured), room) }
    }
}

@Composable fun Feedback(coordinator: PlayCoordinator, state: PlayState, room: PlayRoom, round: PlayRound, ready: Boolean) {
    val (text, change) = draft(coordinator, state, room, round, ActionType.FEEDBACK)
    Text("Did you understand?", style = MaterialTheme.typography.titleLarge)
    Field("A correction or natural alternative (optional)", text, ready, false, onChange = change)
    Action("I understood", ready) {
        val correction = text.trim().takeIf { it.isNotBlank() }
        coordinator.run { command(Command(ActionType.FEEDBACK, understood = true, correction = correction), room) }
    }
    Action("Let's practise that again", ready, true) {
        val correction = text.trim().takeIf { it.isNotBlank() }
        coordinator.run { command(Command(ActionType.FEEDBACK, understood = false, correction = correction), room) }
    }
}
