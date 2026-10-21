package fm.sotto.app

import com.sun.net.httpserver.HttpServer
import fm.sotto.app.model.*
import fm.sotto.app.play.PlayCoordinator
import fm.sotto.app.play.PlayState
import fm.sotto.app.storage.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList

data class RecordedRequest(val path: String, val method: String, val body: String, val headers: Map<String, List<String>>)
data class HttpReply(val status: Int, val body: String)

class PlayScenario : AutoCloseable {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    val origin: String get() = "http://127.0.0.1:${server.address.port}"
    val received = CopyOnWriteArrayList<RecordedRequest>()
    @Volatile var respond: (RecordedRequest) -> HttpReply = { HttpReply(404, "{\"error\":\"Unavailable\"}") }
    private var executor: java.util.concurrent.ExecutorService? = null
    val fixture: JsonObject = SottoJson.parseToJsonElement(requireNotNull(javaClass.classLoader?.getResourceAsStream("contract.json"))
        .use { it.readBytes().toString(Charsets.UTF_8) }).jsonObject
    fun round(name: String): PlayRound = SottoJson.decodeFromJsonElement(fixture.getValue("rounds").jsonArray
        .first { it.jsonObject["name"]?.jsonPrimitive?.content == name }.jsonObject.getValue("round"))
    fun room(seat: Seat = Seat.HOST): PlayRoom = SottoJson.decodeFromJsonElement(fixture.getValue("rooms").jsonArray
        .first { it.jsonObject["name"]?.jsonPrimitive?.content == "playing-$seat" }.jsonObject.getValue("room"))
    fun connection(seat: Seat = Seat.HOST): Connection {
        val member = requireNotNull(room(seat).ownMember)
        return Connection(origin, "a-real-device-token-for-$seat", Profile(member.id, member.name, false, "USER"))
    }
    fun normal(request: RecordedRequest): HttpReply = when {
        request.path == "/api/v1/play/rooms" && request.method == "GET" -> HttpReply(200, "{\"rooms\":[],\"nextCursor\":null}")
        request.path == "/api/v1/play/enrollments" -> HttpReply(403, "{\"error\":\"Owner required\"}")
        request.path.startsWith("/api/v1/play/join-requests/") && request.method == "GET" -> HttpReply(200,
            "{\"requestId\":\"request-1\",\"status\":\"ACCEPTED\",\"expiresAt\":\"2026-10-30T00:00:00Z\",\"serverTime\":\"2026-10-20T00:00:00Z\"}")
        else -> HttpReply(404, "{\"error\":\"Unavailable\"}")
    }
    init {
        server.executor = java.util.concurrent.Executors.newCachedThreadPool().also { executor = it }
        server.createContext("/api/v1/") { exchange ->
            val request = RecordedRequest(exchange.requestURI.path, exchange.requestMethod,
                exchange.requestBody.use { it.readBytes().toString(Charsets.UTF_8) },
                exchange.requestHeaders.entries.associate { it.key.lowercase() to it.value.toList() })
            received.add(request)
            val reply = respond(request)
            val bytes = reply.body.toByteArray()
            exchange.sendResponseHeaders(reply.status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        respond = ::normal
        server.start()
    }
    override fun close() { server.stop(0); executor?.shutdownNow() }
}

class MemoryVault(initial: Vault) : VaultPersistence {
    private val mutex = Mutex()
    private var value = initial
    var failWrites = false
    var beforeCommit: ((Vault) -> Unit)? = null
    var afterCommit: ((Vault) -> Unit)? = null
    override suspend fun load(): Vault = mutex.withLock { value }
    override suspend fun retryLoad(): Vault = load()
    override suspend fun update(transform: (Vault) -> Vault): Vault = mutex.withLock {
        if (failWrites) throw java.io.IOException("Protected disk write failed")
        val next = transform(value).copy(serial = value.serial + 1)
        next.validate()
        beforeCommit?.invoke(next)
        value = next
        afterCommit?.invoke(next)
        next
    }
    override suspend fun erase() { mutex.withLock { value = Vault() } }
}

suspend fun PlayCoordinator.awaitState(predicate: (PlayState) -> Boolean): PlayState =
    withTimeout(10_000) { state.first(predicate) }
