package fm.sotto.app.transport

import androidx.test.ext.junit.runners.AndroidJUnit4
import fm.sotto.app.LocalServer
import fm.sotto.app.NativeReply
import java.io.IOException
import java.net.Socket
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalServerSocketTest {
    @Test fun cancelledRequestsLeaveTheServerAvailable() {
        LocalServer().use { server ->
            server.respond = { NativeReply(body = "retained response") }
            for (request in listOf("", "GET /cancelled HTTP/1.1\r\nX-Partial:",
                "POST /cancelled HTTP/1.1\r\nContent-Length: 5\r\n\r\nhi")) {
                connect(server).use { socket ->
                    socket.getOutputStream().write(request.toByteArray())
                    socket.shutdownOutput()
                    assertEquals(-1, socket.getInputStream().read())
                }
                server.awaitConnectionsSettled()
                assertTrue(exchange(server).endsWith("retained response"))
            }
            assertTrue(server.protocolFailures.toString(), server.protocolFailures.isEmpty())
            assertTrue(server.received.none { it.path == "/cancelled" })
        }
    }

    @Test fun disconnectedResponseReadersLeaveTheServerAvailable() {
        LocalServer().use { server ->
            val entered = CountDownLatch(1)
            val release = CountDownLatch(1)
            server.respond = { request ->
                if (request.path == "/cancelled") {
                    entered.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                    NativeReply(body = "x".repeat(65_536))
                } else NativeReply(body = "subsequent response")
            }
            try {
                connect(server).use { socket ->
                    socket.getOutputStream().write("GET /cancelled HTTP/1.1\r\n\r\n".toByteArray())
                    assertTrue(entered.await(5, TimeUnit.SECONDS))
                    socket.setSoLinger(true, 0)
                }
            } finally { release.countDown() }
            server.awaitConnectionsSettled()
            assertTrue(exchange(server).endsWith("subsequent response"))
            assertTrue(server.protocolFailures.toString(), server.protocolFailures.isEmpty())
        }
    }

    @Test fun responderFailuresRemainVisibleAsServerErrors() {
        LocalServer().use { server ->
            server.respond = { throw IOException("Responder fixture failed") }
            val response = exchange(server)
            server.awaitConnectionsSettled()
            assertTrue(response.startsWith("HTTP/1.1 500 "))
            assertTrue(response.contains("Test server protocol failure"))
            assertEquals("Responder fixture failed", server.protocolFailures.single().message)
        }
    }

    @Test fun malformedRequestsAreRecordedWithoutStoppingTheServer() {
        LocalServer().use { server ->
            server.respond = { NativeReply(body = "valid response") }
            connect(server).use { socket ->
                socket.getOutputStream().write("GET /invalid HTTP/1.1\r\ninvalid-header\r\n\r\n".toByteArray())
                assertEquals(-1, socket.getInputStream().read())
            }
            server.awaitConnectionsSettled()
            assertTrue(exchange(server).endsWith("valid response"))
            assertTrue(server.protocolFailures.single() is IllegalArgumentException)
        }
    }

    private fun connect(server: LocalServer): Socket {
        val address = URI(server.origin)
        return Socket(address.host, address.port).apply { soTimeout = 5_000 }
    }

    private fun exchange(server: LocalServer): String = connect(server).use { socket ->
        socket.getOutputStream().write("GET /valid HTTP/1.1\r\n\r\n".toByteArray())
        socket.getInputStream().bufferedReader().readText()
    }
}
