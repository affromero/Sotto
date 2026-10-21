package fm.sotto.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import fm.sotto.app.model.Level
import fm.sotto.app.model.Settings
import fm.sotto.app.play.PlayCoordinator
import fm.sotto.app.play.PlayState
import kotlinx.coroutines.launch

@Composable fun protectedDraft(coordinator: PlayCoordinator, state: PlayState, key: String): Pair<String, (String) -> Unit> {
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

@Composable fun Action(label: String, enabled: Boolean = true, secondary: Boolean = false, onClick: () -> Unit) {
    if (secondary) OutlinedButton(onClick, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) { Text(label) }
    else Button(onClick, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) { Text(label) }
}

@Composable fun Field(label: String, value: String, enabled: Boolean = true, singleLine: Boolean = true,
                      keyboard: KeyboardType = KeyboardType.Text, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, Modifier.fillMaxWidth(), enabled = enabled, label = { Text(label) },
        singleLine = singleLine, minLines = if (singleLine) 1 else 2,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard))
}

@Composable fun <T> Menu(label: String, selected: T, choices: List<Pair<T, String>>, enabled: Boolean = true,
                       onChange: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        OutlinedButton({ expanded = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp), enabled = enabled) {
            Text("$label: ${choices.firstOrNull { it.first == selected }?.second ?: selected}")
        }
        DropdownMenu(expanded, { expanded = false }) {
            choices.forEach { (value, title) -> DropdownMenuItem(text = { Text(title) }, onClick = { expanded = false; onChange(value) }) }
        }
    }
}

val Languages = listOf("en" to "English", "de" to "German", "es" to "Spanish", "fr" to "French",
    "pt" to "Portuguese", "it" to "Italian", "ja" to "Japanese", "zh" to "Chinese", "ko" to "Korean")

@Composable fun SettingsFields(settings: Settings, enabled: Boolean, onChange: (Settings) -> Unit) {
    Menu("Support language", settings.nativeLang, Languages, enabled) { onChange(settings.copy(nativeLang = it)) }
    Menu("Learning language", settings.targetLang, Languages, enabled) { onChange(settings.copy(targetLang = it)) }
    Menu("Your level", settings.level, Level.entries.map { it to it.name }, enabled) { onChange(settings.copy(level = it)) }
}

fun String.humanize(): String = lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }

@Composable fun LabeledToggle(label: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = checked, enabled = enabled,
        role = Role.Checkbox, onValueChange = onChange),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        Checkbox(checked, null, enabled = enabled)
        Text(label, Modifier.weight(1f))
    }
}
