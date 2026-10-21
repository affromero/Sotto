package fm.sotto.app

import androidx.test.platform.app.InstrumentationRegistry
import fm.sotto.app.model.*
import kotlinx.serialization.json.*

class HostUIFixture : AutoCloseable {
    val server = LocalServer()
    val token = "a-real-owner-fixture-device-token"
    val profile = Profile("host-profile", "Alex", true, "USER")
    private val fixture = SottoJson.parseToJsonElement(InstrumentationRegistry.getInstrumentation().context.assets
        .open("contract.json").use { it.readBytes().toString(Charsets.UTF_8) }).jsonObject
    private val original: PlayRoom = SottoJson.decodeFromJsonElement(fixture.getValue("rooms").jsonArray[0].jsonObject.getValue("room"))
    private var current: PlayRoom? = null
    private var invitation: InvitationView? = null
    private val nonces = mutableSetOf<String>()
    private var admitted = false
    init { server.respond = ::respond }

    @Synchronized private fun respond(request: NativeRequest): NativeReply {
        fun <T> encoded(serializer: kotlinx.serialization.SerializationStrategy<T>, value: T): NativeReply =
            NativeReply(body = SottoJson.encodeToString(serializer, value))
        if (request.path.startsWith("/api/v1/play/")) require(request.headers["authorization"] == "Bearer $token" &&
            request.headers["cookie"] == null && request.headers["origin"] == null)
        return when {
            request.path == "/api/v1/access/open-household" -> {
                require(request.headers["origin"] == server.origin)
                NativeReply(body = "{}", headers = mapOf("Set-Cookie" to "access=ephemeral-fixture; Path=/"))
            }
            request.path == "/api/v1/profiles" -> {
                require(request.headers["authorization"] == "Bearer $token" || request.headers["cookie"] == "access=ephemeral-fixture")
                encoded(ProfileList.serializer(), ProfileList(listOf(profile)))
            }
            request.path == "/api/v1/profiles/switch" -> NativeReply(body = "{\"ok\":true,\"profileId\":\"host-profile\"}")
            request.path == "/api/v1/auth/pair" -> NativeReply(201, "{\"token\":\"one-time-fixture\",\"serverUrl\":\"${server.origin}\"}")
            request.path == "/api/v1/auth/pair/redeem" -> NativeReply(body = "{\"token\":\"$token\"}")
            request.path == "/api/v1/play/rooms" && request.method == "POST" -> {
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                val settings = SottoJson.decodeFromJsonElement<Settings>(body.getValue("settings"))
                current = original.copy(status = RoomStatus.WAITING, revision = 0, guest = null, round = null,
                    host = original.host.copy(settings = settings), completedRounds = emptyList(), points = 0,
                    allowedActions = listOf(RoomAction.CANCEL))
                encoded(PlayRoom.serializer(), requireNotNull(current))
            }
            request.path == "/api/v1/play/rooms" -> encoded(RoomList.serializer(), RoomList(listOfNotNull(current)))
            request.path == "/api/v1/play/enrollments" -> encoded(PendingList.serializer(), PendingList(emptyList()))
            request.path.endsWith("/presence") -> {
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                val nonce = body.getValue("viewNonce").jsonPrimitive.content
                if (body.getValue("type").jsonPrimitive.content == "RENEW") nonces.add(nonce) else nonces.remove(nonce)
                encoded(Presence.serializer(), Presence(nonces.isNotEmpty(), "2026-10-30T00:00:00Z", "2026-10-20T00:00:00Z"))
            }
            request.path.endsWith("/invitations") && request.method == "POST" -> {
                val room = requireNotNull(current)
                current = room.copy(revision = room.revision + 1)
                invitation = InvitationView(room.id, "ABCDEFGH2345", 1, "2026-10-30T00:00:00Z")
                encoded(InvitationView.serializer(), requireNotNull(invitation))
            }
            request.path.endsWith("/invitations") -> NativeReply(body = invitation?.let { SottoJson.encodeToString(it) } ?: "null")
            request.path.endsWith("/join-requests") -> encoded(PendingList.serializer(), PendingList(
                if (invitation == null || admitted) emptyList() else listOf(PendingRequest("fixture-request", original.id,
                    requireNotNull(current).revision, "Mia", CandidateKind.NEW, Settings(), JoinStatus.WAITING_FOR_OWNER,
                    allowedActions = if (nonces.isNotEmpty()) listOf(Approval.ACCEPT, Approval.DECLINE) else emptyList(),
                    expiresAt = "2026-10-30T00:00:00Z", serverTime = "2026-10-20T00:00:00Z"))))
            request.path.endsWith("/approve") -> {
                require(nonces.isNotEmpty())
                val room = requireNotNull(current)
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                require(body.getValue("expectedRevision").jsonPrimitive.int == room.revision)
                require(body.getValue("type").jsonPrimitive.content == "ACCEPT")
                admitted = true
                current = room.copy(revision = room.revision + 1, guest = Member("mia-profile", "Mia", Settings()),
                    allowedActions = listOf(RoomAction.START, RoomAction.CANCEL))
                encoded(PendingRequest.serializer(), PendingRequest("fixture-request", room.id, room.revision + 1, "Mia",
                    CandidateKind.NEW, Settings(), JoinStatus.ACCEPTED, "mia-profile", emptyList(),
                    "2026-10-30T00:00:00Z", "2026-10-20T00:00:00Z"))
            }
            request.path.endsWith("/actions") -> {
                val room = requireNotNull(current)
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                require(admitted && body.getValue("type").jsonPrimitive.content == "START")
                current = room.copy(status = RoomStatus.PLAYING, revision = room.revision + 1, round = original.round,
                    allowedActions = listOf(RoomAction.CANCEL))
                encoded(PlayRoom.serializer(), requireNotNull(current))
            }
            request.path == "/api/v1/play/rooms/${original.id}" -> encoded(PlayRoom.serializer(), requireNotNull(current))
            else -> NativeReply(404, "{\"error\":\"Unavailable\"}")
        }
    }
    override fun close() { server.close() }
}
