package fm.sotto.app.ui.qr

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.*
import com.google.zxing.common.HybridBinarizer
import fm.sotto.app.ui.Action
import java.util.concurrent.Executors

@Composable fun InviteScanner(onResult: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val main = remember(context) { ContextCompat.getMainExecutor(context) }
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var error by remember { mutableStateOf<String?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        if (!it) error = "Camera access is off. You can paste a link or type the code."
    }
    val callback by rememberUpdatedState(onResult)
    if (!granted) {
        Action("Allow camera for QR scanning", secondary = true) { permission.launch(Manifest.permission.CAMERA) }
        error?.let { Text(it) }
        return
    }
    val previewView = remember(context) { PreviewView(context) }
    AndroidView({ previewView }, Modifier.fillMaxWidth().height(280.dp))
    error?.let { Text(it) }
    DisposableEffect(owner, previewView) {
        val executor = Executors.newSingleThreadExecutor()
        val future = ProcessCameraProvider.getInstance(context)
        val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        var disposed = false
        var delivered = false
        analysis.setAnalyzer(executor) { image ->
            try {
                if (!delivered) {
                    val plane = image.planes[0]
                    val data = ByteArray(image.width * image.height)
                    val buffer = plane.buffer
                    for (row in 0 until image.height) for (column in 0 until image.width) {
                        data[row * image.width + column] = buffer.get(row * plane.rowStride + column * plane.pixelStride)
                    }
                    val source = PlanarYUVLuminanceSource(data, image.width, image.height, 0, 0, image.width, image.height, false)
                    val text = decodeQR(source)
                    if (text != null) {
                        delivered = true
                        main.execute { if (!disposed) callback(text) }
                    }
                }
            } catch (_: Exception) { /* An incomplete camera frame is not an invitation. */ }
            finally { image.close() }
        }
        future.addListener({
            if (!disposed) try {
                future.get().bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
            } catch (_: Exception) { error = "The camera is unavailable. Paste a link or type the code." }
        }, main)
        onDispose {
            disposed = true
            analysis.clearAnalyzer()
            if (future.isDone) runCatching { future.get().unbind(preview, analysis) }
            executor.shutdown()
        }
    }
}

fun decodeQR(source: LuminanceSource): String? {
    var rotated = source
    repeat(4) {
        val result = runCatching { MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(rotated)),
            mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true)) }.getOrNull()
        if (result != null) return result.text.takeIf { it.length <= 4096 }
        if (!rotated.isRotateSupported) return null
        rotated = rotated.rotateCounterClockwise()
    }
    return null
}
