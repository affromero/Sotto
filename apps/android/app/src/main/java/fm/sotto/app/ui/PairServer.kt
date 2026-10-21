package fm.sotto.app.ui

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import fm.sotto.app.play.*
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.ui.platform.localNetworkAccess

@Composable fun PairServer(coordinator: PlayCoordinator, state: PlayState) {
    var server by remember { mutableStateOf(state.vault?.invitation?.server ?: state.vault?.connection?.server ?: "") }
    var password by remember { mutableStateOf("") }
    val ready = state.active && !state.busy && !state.checking
    Text("Connect your server", style = MaterialTheme.typography.headlineMedium)
    val network = localNetworkAccess(state.pairingServer ?: PlayInvitation.typedServer(server))
    Text("Enter the server's access password, then choose your learner profile.")
    Field("Server address", server, ready && state.pairingProfiles.isEmpty()) { server = it }
    OutlinedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Access password") },
        visualTransformation = PasswordVisualTransformation(), singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
        enabled = ready && state.pairingProfiles.isEmpty())
    if (state.pairingProfiles.isEmpty()) Action("Open server", ready && network && server.isNotBlank()) {
        val sent = password
        password = ""
        coordinator.run { openPairing(server, sent) }
    }
    else {
        Text("Choose your profile on ${state.pairingServer}", style = MaterialTheme.typography.titleLarge)
        Text("Your previous connection will stay in Saved connections.")
        state.pairingProfiles.forEach { profile ->
            Action(profile.name, ready && network) { coordinator.run { finishPairing(profile.id) } }
        }
    }
}
