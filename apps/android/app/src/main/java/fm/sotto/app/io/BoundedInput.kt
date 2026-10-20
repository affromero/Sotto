package fm.sotto.app.io

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream

fun InputStream.readBounded(limit: Int): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = read(buffer, 0, minOf(buffer.size, limit - output.size() + 1))
        if (count == -1) return output.toByteArray()
        if (output.size() + count > limit) throw IOException("The supported data size was exceeded.")
        output.write(buffer, 0, count)
    }
}
