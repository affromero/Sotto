package fm.sotto.app

import java.io.BufferedInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.Phaser
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

data class NativeRequest(val method: String, val path: String, val headers: Map<String, String>, val body: String)
data class NativeReply(val status: Int = 200, val body: String, val headers: Map<String, String> = emptyMap())

class LocalServer : AutoCloseable {
    private val listener = ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"))
    private val executor = Executors.newCachedThreadPool()
    private val connections = Phaser(1)
    val origin = "http://127.0.0.1:${listener.localPort}"
    val received = CopyOnWriteArrayList<NativeRequest>()
    val protocolFailures = CopyOnWriteArrayList<Exception>()
    @Volatile var respond: (NativeRequest) -> NativeReply = { NativeReply(404, "{\"error\":\"Unavailable\"}") }
    @Volatile private var closed = false

    init {
        executor.execute {
            while (!closed) try {
                val socket = listener.accept()
                connections.register()
                try { executor.execute {
                    try { socket.use {
                        it.soTimeout = 10_000
                        val input = BufferedInputStream(it.getInputStream())
                        val first = input.line().split(' ')
                        val headers = mutableMapOf<String, String>()
                        var headerBytes = 0
                        while (true) {
                            val line = input.line()
                            if (line.isEmpty()) break
                            headerBytes += line.length
                            require(headerBytes <= 32_768)
                            val parts = line.split(':', limit = 2)
                            require(parts.size == 2)
                            headers[parts[0].lowercase()] = parts[1].trim()
                        }
                        val length = headers["content-length"]?.toInt() ?: 0
                        require(length in 0..16_384)
                        val bytes = ByteArray(length)
                        var read = 0
                        while (read < length) {
                            val count = input.read(bytes, read, length - read)
                            if (count < 0) throw IOException("Incomplete test request")
                            read += count
                        }
                        val request = NativeRequest(first[0], first[1].substringBefore('?'), headers, bytes.toString(Charsets.UTF_8))
                        received.add(request)
                        val response = try { respond(request) } catch (error: Exception) {
                            protocolFailures.add(error)
                            NativeReply(500, "{\"error\":\"Test server protocol failure\"}")
                        }
                        val body = response.body.toByteArray()
                        it.getOutputStream().use { output ->
                            val extra = response.headers.entries.joinToString("") { header -> "${header.key}: ${header.value}\r\n" }
                            output.write("HTTP/1.1 ${response.status} Test\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n${extra}Content-Length: ${body.size}\r\n\r\n".toByteArray())
                            output.write(body)
                        }
                    } } catch (_: IOException) {
                        // Foreground cancellation may close a connection before its request or response completes.
                    } catch (error: Exception) {
                        protocolFailures.add(error)
                    } finally {
                        connections.arriveAndDeregister()
                    }
                } } catch (error: RejectedExecutionException) {
                    try { socket.close() } finally { connections.arriveAndDeregister() }
                    if (!closed) throw error
                }
            } catch (_: IOException) { if (!closed) throw IllegalStateException("Test listener failed") }
        }
    }
    fun awaitConnectionsSettled() {
        connections.awaitAdvanceInterruptibly(connections.arrive(), 5, TimeUnit.SECONDS)
    }
    override fun close() { closed = true; listener.close(); executor.shutdownNow() }
}

private fun BufferedInputStream.line(): String {
    val bytes = java.io.ByteArrayOutputStream()
    while (true) {
        val next = read()
        if (next < 0) throw IOException("Incomplete test header")
        if (next == 10) return bytes.toByteArray().toString(Charsets.US_ASCII).removeSuffix("\r")
        require(bytes.size() < 8192)
        bytes.write(next)
    }
}
