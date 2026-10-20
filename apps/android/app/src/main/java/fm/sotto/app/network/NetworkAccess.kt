package fm.sotto.app.network

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import fm.sotto.app.model.PlayInvitation
import java.io.IOException

class LocalNetworkPermissionRequired(server: String) : IOException(
    "Allow local network access to connect to $server. Your saved profile and requests are kept.",
)

object NetworkAccess {
    @Volatile private var application: Context? = null

    fun initialize(context: Context) { application = context.applicationContext }

    fun permissionGranted(): Boolean {
        if (Build.VERSION.SDK_INT < 37) return true
        val context = checkNotNull(application) { "Sotto's network permission service is not initialized." }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED
    }

    fun allowedFor(server: String): Boolean =
        Build.VERSION.SDK_INT < 37 || !PlayInvitation.localServer(server) || permissionGranted()

    fun requirePermission(server: String) {
        if (!allowedFor(server)) throw LocalNetworkPermissionRequired(server)
    }
}
