package fm.sotto.app.ui.platform

import android.Manifest
import android.content.Intent
import androidx.core.net.toUri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.network.NetworkAccess
import fm.sotto.app.ui.Action

@Composable fun localNetworkAccess(server: String?, manual: Boolean = false): Boolean {
    if (Build.VERSION.SDK_INT < 37) return true
    val local = server?.let(PlayInvitation::localServer) == true
    if (!local && !manual) return true
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(NetworkAccess.permissionGranted()) }
    var requested by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { allowed = NetworkAccess.permissionGranted() }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        allowed = NetworkAccess.permissionGranted()
        requested = true
    }
    if (!allowed) {
        Text(if (local) "${server} is on a local network. Android requires local network access to connect. This permission covers local networks for Sotto."
            else "If your server's hostname points to this network, you can allow Sotto local network access here.")
        Action("Allow local network access", secondary = true) { permission.launch(Manifest.permission.ACCESS_LOCAL_NETWORK) }
        if (requested) {
            Text("Access is still off. Your saved profiles and requests are kept. You can change the permission in Android Settings.")
            Action("Open Android permissions", secondary = true) {
                try { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())) }
                catch (_: Exception) { error = "Android Settings could not be opened." }
            }
        }
    }
    error?.let { Text(it) }
    return !local || allowed
}
