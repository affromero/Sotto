package fm.sotto.app.network

import fm.sotto.app.model.Connection
import fm.sotto.app.model.PlayInvitation
import fm.sotto.app.model.SottoJson
import fm.sotto.app.io.readBounded
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiError(val status: Int, message: String) : IOException(message)
class ConnectionFailure(cause: IOException) : IOException("Could not reach the server. ${cause.message.orEmpty().take(200)}", cause)

class SottoClient(
    val server: String,
    private val connection: Connection? = null,
    private val transport: OkHttpClient = privateTransport,
    private val pairing: Boolean = false,
) {
    init {
        require(PlayInvitation.origin(server) == server)
        require(connection == null || connection.server == server)
        require(!pairing || connection == null)
    }

    suspend inline fun <reified T> get(path: String, proof: String? = null): T =
        SottoJson.decodeFromString(raw(path, proof = proof))

    suspend inline fun <reified T> post(path: String, body: String, proof: String? = null): T =
        SottoJson.decodeFromString(raw(path, body, proof))

    suspend fun raw(path: String, body: String? = null, proof: String? = null): String {
        NetworkAccess.requirePermission(server)
        require(path.length <= 2048 && path.startsWith("/api/v1/") && !path.startsWith("//"))
        val relative = URI(path)
        require(relative.scheme == null && relative.rawAuthority == null && relative.rawFragment == null)
        require(!path.contains('\\') && !path.any { it.isISOControl() })
        val url = URI(server).resolve(relative)
        require(PlayInvitation.origin(URI(url.scheme, url.rawAuthority, null, null, null).toString()) == server)
        if (pairing) require(relative.path in pairingPaths)
        require(proof == null || proof.matches(Regex("[A-Za-z0-9_-]{43}")))
        val request = Request.Builder().url(url.toString())
            .header("Accept", "application/json").header("Cache-Control", "no-store")
        if (body != null) {
            require(body.toByteArray().size <= 16_384)
            request.post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
            if (pairing) request.header("Origin", server)
        }
        connection?.let {
            request.header("Authorization", "Bearer ${it.token}")
                .header("X-Sotto-Profile-Id", it.profile.id)
            if (relative.path.startsWith("/api/v1/play/"))
                request.header("X-Sotto-Play-Profile", it.profile.id)
        }
        proof?.let { request.header("X-Sotto-Play-Proof", it) }
        return execute(transport.newCall(request.build()))
    }

    companion object {
        val privateTransport: OkHttpClient = OkHttpClient.Builder()
            .cookieJar(CookieJar.NO_COOKIES).cache(null).followRedirects(false)
            .followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS).build()
        val pairingPaths = setOf(
            "/api/v1/access/open-household", "/api/v1/access/household", "/api/v1/profiles",
            "/api/v1/profiles/switch", "/api/v1/auth/pair", "/api/v1/auth/pair/redeem",
        )
        fun id(value: String): String = value.also { require(it.matches(Regex("[A-Za-z0-9_-]{1,100}"))) }

        private suspend fun execute(call: Call): String = suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(ConnectionFailure(e))
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val text = response.use {
                            val body = it.body
                            if (body.contentLength() > 1_048_576) throw IOException("The server response is too large.")
                            val bytes = body.byteStream().use { input -> input.readBounded(1_048_576) }
                            bytes.toString(Charsets.UTF_8)
                        }
                        if (response.code !in listOf(200, 201)) {
                            val message = runCatching {
                                SottoJson.decodeFromString<JsonObject>(text)["error"]?.jsonPrimitive?.content
                            }.getOrNull()?.take(300)?.filterNot { it.isISOControl() }
                            throw ApiError(response.code, message ?: "Server refused the request (${response.code}).")
                        }
                        if (continuation.isActive) continuation.resume(text)
                    } catch (error: Exception) {
                        if (continuation.isActive) continuation.resumeWithException(error)
                    }
                }
            })
        }
    }
}
