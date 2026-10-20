package fm.sotto.app.ui.qr

import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import androidx.core.graphics.createBitmap
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.ui.Action
import kotlinx.coroutines.launch

@Composable fun InviteCode(invite: PlayInvitation) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    val bitmap = remember(invite) {
        runCatching {
            val matrix = QRCodeWriter().encode(invite.webLink, BarcodeFormat.QR_CODE, 512, 512)
            createBitmap(512, 512, Bitmap.Config.ARGB_8888).apply {
                val pixels = IntArray(512 * 512) { index -> if (matrix[index % 512, index / 512]) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
                setPixels(pixels, 0, 512, 0, 0, 512, 512)
            }
        }.getOrNull()
    }
    Text(invite.formattedCode)
    if (bitmap != null) Image(bitmap.asImageBitmap(), "Game invitation QR code", Modifier.fillMaxWidth().height(220.dp))
    else Text("QR creation failed. You can still share the invitation link.")
    Action("Share invitation", secondary = true) {
        try {
            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"; putExtra(Intent.EXTRA_TEXT, invite.webLink)
            }, "Share game invitation"))
        } catch (_: Exception) { error = "Sharing is unavailable. Copy the invitation instead." }
    }
    Action("Copy invitation", secondary = true) {
        scope.launch {
            try { clipboard.setClipEntry(ClipEntry(android.content.ClipData.newPlainText("Sotto game invitation", invite.webLink))) }
            catch (_: Exception) { error = "The invitation could not be copied." }
        }
    }
    error?.let { Text(it) }
}
