package fm.sotto.app.model

import kotlinx.serialization.Serializable
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.Base64
import java.util.Locale

@Serializable data class PlayInvitation(val server: String, val code: String, val version: Int = 1) {
    init {
        require(version == 1 && origin(server) == server && normalizeCode(code) == code) {
            "Use a valid Sotto server and 12-character game code."
        }
    }
    val formattedCode: String get() = code.chunked(4).joinToString("-")
    val webLink: String get() = "$server/play/join?v=1&code=$code"
    val appLink: String get() = "sotto://play/join?v=1&server=${encode(server)}&code=$code"

    companion object {
        fun normalizeCode(value: String): String? = value.filterNot { it.isWhitespace() || it == '-' }
            .uppercase(Locale.ROOT).takeIf { it.matches(Regex("[A-HJ-NP-Z2-9]{12}")) }

        fun origin(value: String): String? = runCatching {
            require(value.length <= 2048 && !value.any { it.isWhitespace() || it.isISOControl() })
            val uri = URI(value)
            val scheme = uri.scheme?.lowercase(Locale.ROOT)
            val host = requireNotNull(uri.host).lowercase(Locale.ROOT)
            require(uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null)
            require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
            require(uri.port == -1 || uri.port in 1..65535)
            require(scheme == "https" || scheme == "http" && privateHost(host))
            val port = uri.port.takeUnless { it == -1 || scheme == "https" && it == 443 || scheme == "http" && it == 80 }
            "$scheme://$host${port?.let { ":$it" }.orEmpty()}"
        }.getOrNull()

        fun typedServer(value: String): String? = origin(value.trim().let {
            if (it.contains("://")) it else "https://$it"
        })

        fun parse(value: String): PlayInvitation? = runCatching {
            require(value.length <= 4096)
            val uri = URI(value)
            require(uri.rawUserInfo == null && uri.rawFragment == null)
            val native = uri.scheme == "sotto" && uri.host == "play" && uri.rawPath == "/join" && uri.port == -1
            val web = uri.scheme in listOf("https", "http") && uri.rawPath == "/play/join"
            require(native || web)
            val pairs = requireNotNull(uri.rawQuery).split('&').map {
                val pair = it.split('=', limit = 2)
                require(pair.size == 2)
                decode(pair[0]) to decode(pair[1])
            }
            require(pairs.map { it.first }.distinct().size == pairs.size)
            require(pairs.all { it.first in listOf("v", "server", "code") })
            val query = pairs.toMap()
            require(query["v"] == "1")
            val explicit = query["server"]
            require(!native || explicit != null)
            val webOrigin = if (web) origin(URI(uri.scheme, uri.rawAuthority, null, null, null).toString()) else null
            require(native || explicit == null || webOrigin == "https://sotto.fm")
            PlayInvitation(requireNotNull(origin(explicit ?: requireNotNull(webOrigin))),
                requireNotNull(normalizeCode(requireNotNull(query["code"]))))
        }.getOrNull()

        fun proof(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also {
            SecureRandom().nextBytes(it)
        })
        fun localServer(server: String): Boolean = origin(server)?.let { privateHost(requireNotNull(URI(it).host)) } == true
        private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())
        private fun decode(value: String): String = URLDecoder.decode(value, Charsets.UTF_8.name())

        private fun privateHost(raw: String): Boolean {
            val host = raw.removePrefix("[").removeSuffix("]")
            if (host == "localhost" || host.endsWith(".local")) return true
            val parts = host.split('.')
            if (parts.size == 4 && parts.all { it.matches(Regex("[0-9]{1,3}")) }) {
                val numbers = parts.map { it.toInt() }
                if (numbers.any { it !in 0..255 }) return false
                return numbers[0] in listOf(10, 127) || numbers[0] == 169 && numbers[1] == 254 ||
                    numbers[0] == 172 && numbers[1] in 16..31 || numbers[0] == 192 && numbers[1] == 168
            }
            if (!host.contains(':') || !host.matches(Regex("[0-9a-f:]+"))) return false
            val bytes = runCatching { java.net.InetAddress.getByName(host).address }.getOrNull() ?: return false
            if (bytes.size != 16) return false
            return bytes.dropLast(1).all { it == 0.toByte() } && bytes.last() == 1.toByte() ||
                bytes[0].toInt() and 0xfe == 0xfc ||
                bytes[0].toInt() and 0xff == 0xfe && bytes[1].toInt() and 0xc0 == 0x80
        }
    }
}
