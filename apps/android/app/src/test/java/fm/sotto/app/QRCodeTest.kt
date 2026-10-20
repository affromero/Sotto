package fm.sotto.app

import com.google.zxing.BarcodeFormat
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.qrcode.QRCodeWriter
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.ui.qr.decodeQR
import org.junit.Assert.*
import org.junit.Test

class QRCodeTest {
    private fun source(value: String, rotated: Boolean = false): PlanarYUVLuminanceSource {
        val matrix = QRCodeWriter().encode(value, BarcodeFormat.QR_CODE, 600, 600)
        val luma = ByteArray(matrix.width * matrix.height) {
            val x = it % matrix.width
            val y = it / matrix.width
            if (if (rotated) matrix[y, matrix.width - 1 - x] else matrix[x, y]) 0 else 255.toByte()
        }
        return PlanarYUVLuminanceSource(luma, matrix.width, matrix.height, 0, 0, matrix.width, matrix.height, false)
    }
    @Test fun aRotatedCameraFrameRecoversTheSameCanonicalInvitation() {
        val invite = PlayInvitation("https://languages.example", "ABCDEFGH2345")
        val decoded = decodeQR(source(invite.webLink, rotated = true))
        assertEquals(invite, PlayInvitation.parse(requireNotNull(decoded)))
    }
    @Test fun anOversizedQrPayloadIsNotReturnedToTheInvitationFlow() {
        assertNull(decodeQR(source("1".repeat(4200))))
    }
}
