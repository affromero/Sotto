package fm.sotto.app.network

import fm.sotto.app.model.Connection
import fm.sotto.app.model.ProfileList
import fm.sotto.app.model.SottoJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl

class HouseholdPairing(val server: String) {
    private val jar = OriginCookieJar(server)
    private val api = SottoClient(server, transport = SottoClient.privateTransport.newBuilder()
        .cookieJar(jar).build(), pairing = true)

    suspend fun open(password: String): ProfileList {
        if (password.isEmpty()) api.raw("/api/v1/access/open-household", "{}")
        else api.raw("/api/v1/access/household", buildJsonObject { put("password", password) }.toString())
        return api.get("/api/v1/profiles")
    }
    suspend fun complete(profileID: String, deviceName: String): Connection {
        val profiles = api.get<ProfileList>("/api/v1/profiles").profiles
        val profile = requireNotNull(profiles.firstOrNull { it.id == profileID }) { "Choose a listed learner." }
        val selected = SottoJson.decodeFromString<Selection>(api.raw("/api/v1/profiles/switch",
            buildJsonObject { put("profileId", profile.id) }.toString()))
        require(selected.ok && selected.profileId == profile.id) { "Profile selection was not confirmed." }
        val issued = api.post<PairingToken>("/api/v1/auth/pair",
            buildJsonObject { put("name", deviceName.take(80)) }.toString())
        require(fm.sotto.app.model.PlayInvitation.origin(issued.serverUrl) == server)
        val redeemed = api.post<Redemption>("/api/v1/auth/pair/redeem",
            buildJsonObject { put("token", issued.token) }.toString())
        val next = Connection(server, redeemed.token, profile)
        val verified = SottoClient(server, next).get<ProfileList>("/api/v1/profiles")
        return next.copy(profile = requireNotNull(verified.profiles.firstOrNull { it.id == profile.id }))
    }
    fun close() { jar.clear() }

    @Serializable private data class Selection(val ok: Boolean, val profileId: String)
    @Serializable private data class PairingToken(val token: String, val serverUrl: String)
    @Serializable private data class Redemption(val token: String)
}

private class OriginCookieJar(server: String) : CookieJar {
    private val origin = server.toHttpUrl()
    private var cookies = listOf<Cookie>()
    private fun matches(url: HttpUrl): Boolean =
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port

    @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!matches(url)) return
        val next = this.cookies.associateBy { it.name }.toMutableMap()
        for (cookie in cookies) {
            if (cookie.matches(url)) next[cookie.name] = cookie
        }
        this.cookies = next.values.filter { it.expiresAt > System.currentTimeMillis() }
    }
    @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> =
        if (matches(url)) cookies.filter { it.matches(url) && it.expiresAt > System.currentTimeMillis() } else emptyList()
    @Synchronized fun clear() { cookies = emptyList() }
}
