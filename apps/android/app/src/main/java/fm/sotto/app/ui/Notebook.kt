package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import fm.sotto.app.model.*
import fm.sotto.app.play.*
import fm.sotto.app.ui.platform.localNetworkAccess

@Composable fun PhraseCapture(coordinator: PlayCoordinator, room: PlayRoom, round: PlayRound, ready: Boolean) {
    var expanded by remember(room.id, round.id) { mutableStateOf(false) }
    var text by remember(room.id, round.id) { mutableStateOf("") }
    var context by remember(room.id, round.id) { mutableStateOf("") }
    var kind by remember(room.id, round.id) { mutableStateOf(PhraseKind.PHRASE) }
    if (round.visibleTexts.isEmpty()) return
    Action(if (expanded) "Close phrase picker · round ${round.header.order + 1}" else "Keep language · round ${round.header.order + 1}",
        ready, true) { expanded = !expanded }
    if (!expanded) return
    Text("Choose visible language, then keep the word or sentence you want.")
    round.visibleTexts.forEach { value -> Action(value, ready, true) { text = value } }
    Field("Word or sentence to keep", text, ready, false) { text = it.take(500) }
    Field("Your note (optional)", context, ready, false) { context = it.take(500) }
    Menu("Kind", kind, PhraseKind.entries.map { it to it.name.humanize() }, ready) { kind = it }
    Action("Save privately", ready && text.isNotBlank()) { coordinator.run { keep(text, context, kind, round, room) } }
}

@Composable fun Notebook(coordinator: PlayCoordinator, state: PlayState) {
    val network = localNetworkAccess(state.vault?.connection?.server)
    val ready = state.active && network && !state.busy && !state.checking && !state.accessRevoked && state.vault?.pending == null
    Text("Your phrase notebook", style = MaterialTheme.typography.headlineMedium)
    Text("Words and sentences you chose to keep from your games.")
    if (state.phrases.isEmpty() && !state.checking) Text("Keep a phrase during a game to find it here.")
    Action("Find your study courses", ready, true) { coordinator.run { loadStudyCourses() } }
    state.phrases.forEach { phrase ->
        Text(phrase.text, style = MaterialTheme.typography.titleLarge)
        Text("${phrase.targetLang.uppercase()} · ${phrase.kind.name.humanize()}")
        phrase.contextText?.let { Text(it) }
        state.courses.filter { it.targetLang == phrase.targetLang }.forEach { course ->
            Action("Add to ${course.nativeLang.uppercase()} → ${course.targetLang.uppercase()} · ${course.currentLevel} · ${course.id.takeLast(6)}",
                ready, true) { coordinator.run { addToStudy(phrase, course) } }
        }
    }
    if (state.phrasesCursor != null) Action("Older phrases", ready, true) { coordinator.run { loadPhrases(older = true) } }
}
