package fm.sotto.app

import com.sun.net.httpserver.HttpServer
import fm.sotto.app.model.Connection
import fm.sotto.app.model.Profile
import fm.sotto.app.model.ProfileList
import fm.sotto.app.network.ApiError
import fm.sotto.app.network.HouseholdPairing
import fm.sotto.app.network.SottoClient
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.LinkedBlockingQueue

class PlayTransportTest {
    @Test fun structuredSafetyErrorsKeepTheirReasonAndActualHttpStatus() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            for (fixture in server.safetyFixture.getValue("errors").let { it as kotlinx.serialization.json.JsonArray }) {
                val value = fixture as kotlinx.serialization.json.JsonObject
                val status = value.getValue("status").toString().toInt()
                val body = value.getValue("body") as kotlinx.serialization.json.JsonObject
                server.respond = { HttpReply(status, body.toString()) }
                try { SottoClient(connection.server, connection).raw("/api/v1/play/safety"); fail("Expected safety rejection") }
                catch (error: ApiError) {
                    assertEquals(status, error.status)
                    assertEquals(body.getValue("reason").toString().removeSurrounding("\""), error.reason)
                    assertTrue(error.status != 401 && error.status != 403)
                }
            }
        }
    }

    @Test fun profileDeletionUsesConfirmedAuthenticatedDeleteAndAcceptsQueuedCleanup() = runBlocking {
        PlayScenario().use { server ->
            val connection = server.connection()
            for (status in listOf(200, 202)) {
                server.respond = { HttpReply(status, "{\"success\":true,\"cleanup\":{\"phase\":\"pending\"}}") }
                SottoClient(connection.server, connection).deleteAccount()
                val request = server.received.last()
                assertEquals("/api/v1/users/me", request.path)
                assertEquals("DELETE", request.method)
                assertEquals("{\"confirm\":\"DELETE\"}", request.body)
                assertEquals(listOf("Bearer ${connection.token}"), request.headers["authorization"])
                assertEquals(listOf(connection.profile.id), request.headers["x-sotto-profile-id"])
                assertNull(request.headers["cookie"])
                assertNull(request.headers["origin"])
            }
            server.respond = { HttpReply(202, "{\"success\":false}") }
            try { SottoClient(connection.server, connection).deleteAccount(); fail("Deletion must be confirmed") }
            catch (_: IllegalArgumentException) { }
            server.respond = { HttpReply(403, "{\"error\":\"Protected profile\"}") }
            try { SottoClient(connection.server, connection).deleteAccount(); fail("Forbidden deletion must fail") }
            catch (error: ApiError) { assertEquals(403, error.status) }
        }
    }

    @Test fun privateRequestsKeepSecretsInBoundHeadersWithoutCookiesOriginOrRedirects() = runBlocking {
        val received = LinkedBlockingQueue<Map<String, List<String>>>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/v1/play/") { exchange ->
            received.add(exchange.requestHeaders.entries.associate { it.key.lowercase() to it.value.toList() })
            exchange.responseHeaders.add("Set-Cookie", "household=do-not-use; Path=/")
            val redirect = exchange.requestURI.path.endsWith("redirect")
            if (redirect) exchange.responseHeaders.add("Location", "/api/v1/play/leaked")
            val bytes = "{}".toByteArray()
            exchange.sendResponseHeaders(if (redirect) 307 else 200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        try {
            val origin = "http://127.0.0.1:${server.address.port}"
            val connection = Connection(origin, "a-member-device-token", Profile("p1", "Ada", false, "USER"))
            val client = SottoClient(origin, connection)
            client.raw("/api/v1/play/rooms", "{}", "a".repeat(43))
            client.raw("/api/v1/play/rooms")
            val first = received.take()
            assertEquals(listOf("Bearer a-member-device-token"), first["authorization"])
            assertEquals(listOf("p1"), first["x-sotto-profile-id"])
            assertEquals(listOf("p1"), first["x-sotto-play-profile"])
            assertEquals(listOf("a".repeat(43)), first["x-sotto-play-proof"])
            assertNull(first["origin"])
            assertNull(first["cookie"])
            assertNull(received.take()["cookie"])
            try { client.raw("/api/v1/play/redirect"); fail("Redirect must be refused") }
            catch (error: ApiError) { assertEquals(307, error.status) }
            received.take()
            assertTrue(received.isEmpty())
            for (path in listOf("//other.example/api/v1/play/rooms", "https://other.example/api/v1/play/rooms")) {
                try { client.raw(path); fail("Foreign destination must be refused") }
                catch (_: IllegalArgumentException) { }
            }
            assertTrue(received.isEmpty())
        } finally { server.stop(0) }
    }

    @Test fun householdPairingUsesAnEphemeralOriginBoundSession() = runBlocking {
        val headers = LinkedBlockingQueue<Pair<String, Map<String, List<String>>>>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val profile = "{\"id\":\"p1\",\"name\":\"Ada\",\"isOwner\":true,\"role\":\"USER\"}"
        server.createContext("/api/v1/") { exchange ->
            val path = exchange.requestURI.path
            headers.add(path to exchange.requestHeaders.entries.associate { it.key.lowercase() to it.value.toList() })
            exchange.requestBody.close()
            val response = when (path) {
                "/api/v1/access/household" -> { exchange.responseHeaders.add("Set-Cookie", "access=ephemeral; Path=/"); "{}" }
                "/api/v1/profiles" -> "{\"profiles\":[$profile]}"
                "/api/v1/profiles/switch" -> "{\"ok\":true,\"profileId\":\"p1\"}"
                "/api/v1/auth/pair" -> "{\"token\":\"one-time\",\"serverUrl\":\"http://127.0.0.1:${server.address.port}\"}"
                else -> "{\"token\":\"a-real-member-token\"}"
            }.toByteArray()
            exchange.sendResponseHeaders(200, response.size.toLong())
            exchange.responseBody.use { it.write(response) }
        }
        server.start()
        try {
            val origin = "http://127.0.0.1:${server.address.port}"
            val pairing = HouseholdPairing(origin)
            assertEquals("p1", pairing.open("password").profiles.single().id)
            val connection = pairing.complete("p1", "Android")
            assertEquals("a-real-member-token", connection.token)
            pairing.close()
            val observed = headers.toList()
            val select = observed.first { it.first == "/api/v1/profiles/switch" }.second
            assertEquals(listOf(origin), select["origin"])
            assertEquals(listOf("access=ephemeral"), select["cookie"])
            val bearerRequest = observed.last().second
            assertEquals(listOf("Bearer a-real-member-token"), bearerRequest["authorization"])
            assertNull(bearerRequest["cookie"])
            assertNull(bearerRequest["origin"])
            assertEquals("p1", SottoClient(origin, connection).get<ProfileList>("/api/v1/profiles").profiles.single().id)
        } finally { server.stop(0) }
    }
}
