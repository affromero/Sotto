package fm.sotto.app

import androidx.test.platform.app.InstrumentationRegistry
import fm.sotto.app.model.*
import kotlinx.serialization.json.*

class PlayUIFixture : AutoCloseable {
    val server = LocalServer()
    val invite = PlayInvitation(server.origin, "ABCDEFGH2345")
    private val fixture = SottoJson.parseToJsonElement(InstrumentationRegistry.getInstrumentation().context.assets
        .open("contract.json").use { it.readBytes().toString(Charsets.UTF_8) }).jsonObject
    private val safetyFixture = SottoJson.parseToJsonElement(InstrumentationRegistry.getInstrumentation().context.assets
        .open("safety.json").use { it.readBytes().toString(Charsets.UTF_8) }).jsonObject
    private val base: PlayRoom = SottoJson.decodeFromJsonElement(fixture.getValue("rooms").jsonArray
        .first { it.jsonObject["name"]?.jsonPrimitive?.content == "playing-GUEST" }.jsonObject.getValue("room"))
    private var current = base
    private var phrases = emptyList<Phrase>()
    private var requestID: String? = null
    var conductAccepted = true
    private var blocks = emptyList<PlayerBlock>()
    private var reports = emptyList<SafetyReport>()
    val token = "a-fixture-principal-bound-native-token"

    fun round(name: String): PlayRound = SottoJson.decodeFromJsonElement(fixture.getValue("rounds").jsonArray
        .first { it.jsonObject["name"]?.jsonPrimitive?.content == name }.jsonObject.getValue("round"))
    fun room(): PlayRoom = base

    @Synchronized fun respondToReports() {
        reports = reports.map { it.copy(status = ReportStatus.RESOLVED, revision = it.revision + 1,
            response = "I have reviewed your report and closed the game.", respondedAt = "2026-10-21T12:00:00Z") }
    }

    @Synchronized fun advance(name: String) {
        current = current.copy(revision = current.revision + 1, round = round(name))
    }
    init { server.respond = ::respond }

    @Synchronized private fun respond(request: NativeRequest): NativeReply {
        fun <T> encoded(serializer: kotlinx.serialization.SerializationStrategy<T>, value: T): NativeReply =
            NativeReply(body = SottoJson.encodeToString(serializer, value))
        if (request.path.startsWith("/api/v1/play/")) {
            require(request.headers["cookie"] == null && request.headers["origin"] == null)
        }
        return when {
            request.path == "/api/v1/play/policy" -> NativeReply(body = safetyFixture.getValue("policy").toString())
            request.path == "/api/v1/play/safety" -> NativeReply(body = JsonObject(safetyFixture.getValue(if (conductAccepted) "accepted" else "unaccepted").jsonObject +
                ("profileId" to JsonPrimitive(base.guest?.id))).toString())
            request.path == "/api/v1/play/safety/blocks" -> encoded(BlockList.serializer(), BlockList(blocks))
            request.path == "/api/v1/play/safety/reports" -> encoded(ReportList.serializer(), ReportList(reports))
            request.path.endsWith("/conduct") || request.path.endsWith("/block") ||
                request.path.endsWith("/unblock") || request.path.endsWith("/reports") && request.method == "POST" -> {
                require(request.headers["authorization"] == "Bearer $token")
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                val id = body.getValue("actionId").jsonPrimitive.content
                when {
                    request.path.endsWith("/conduct") -> conductAccepted = true
                    request.path.endsWith("/block") -> {
                        blocks = listOf(PlayerBlock(base.host.id, base.host.name, "2026-10-21T12:00:00Z"))
                        current = current.copy(status = RoomStatus.CANCELLED, revision = current.revision + 1, round = null)
                    }
                    request.path.endsWith("/unblock") -> blocks = emptyList()
                    else -> reports = reports + SafetyReport(id, base.id,
                        SottoJson.decodeFromJsonElement(body.getValue("category")), body.getValue("detail").jsonPrimitive.content,
                        ReportEvidence(SottoJson.decodeFromJsonElement(body.getValue("selector")), body.getValue("expectedVisibleText").jsonPrimitive.content),
                        ReportStatus.OPEN, 0, "2026-10-21T12:00:00Z")
                }
                encoded(SafetyAck.serializer(), SafetyAck(id, true))
            }
            request.path == "/api/v1/play/invitations" && request.method == "GET" -> encoded(Preview.serializer(),
                Preview(current.id, "Alex", GameKind.MIXED, Theme.EVERYDAY, QuestionStyle.CHOICES, true,
                    "2026-10-30T00:00:00Z", "2026-10-20T00:00:00Z"))
            request.path == "/api/v1/play/invitations" && request.method == "POST" -> {
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                requestID = body.getValue("requestId").jsonPrimitive.content
                require(body.getValue("candidate").jsonObject["consentToProfile"] == JsonPrimitive(true))
                require(body["acceptedConductVersion"] == JsonPrimitive(CONDUCT_VERSION))
                encoded(JoinStatusView.serializer(), status())
            }
            request.path.startsWith("/api/v1/play/join-requests/") && request.method == "GET" ->
                if (requestID == null) NativeReply(404, "{\"error\":\"Request has not arrived yet\"}")
                else encoded(JoinStatusView.serializer(), status())
            request.path.endsWith("/claim") -> {
                require(request.headers["authorization"] == null && request.headers["x-sotto-play-proof"]?.length == 43)
                encoded(Delivery.serializer(), Delivery(DeliveryKind.NATIVE, "fixture-delivery", current.id,
                    requireNotNull(base.guest), token))
            }
            request.path == "/api/v1/profiles" -> {
                require(request.headers["authorization"] == "Bearer $token")
                encoded(ProfileList.serializer(), ProfileList(listOf(Profile(requireNotNull(base.guest).id, "Sam", false, "USER"))))
            }
            request.path.endsWith("/ack") -> NativeReply(body = "{\"acknowledged\":true}")
            request.path == "/api/v1/play/rooms/${base.id}" -> encoded(PlayRoom.serializer(), current)
            request.path == "/api/v1/play/rooms" -> encoded(RoomList.serializer(), RoomList(
                if (current.status == RoomStatus.CANCELLED) emptyList() else listOf(current)))
            request.path == "/api/v1/play/enrollments" -> NativeReply(403, "{\"error\":\"Owner required\"}")
            request.path.endsWith("/actions") -> {
                require(request.headers["authorization"] == "Bearer $token")
                require(request.headers["x-sotto-play-profile"] == base.guest?.id)
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                if (body.getValue("expectedRevision").jsonPrimitive.int != current.revision)
                    return NativeReply(409, "{\"error\":\"The game changed\"}")
                val command = body.getValue("command").jsonObject
                val type = command.getValue("type").jsonPrimitive.content
                when (type) {
                    "CHOOSE" -> advance("finished-0-GUEST")
                    "GUESS" -> advance("guessed-2-GUEST")
                    "MESSAGE" -> advance(if (current.round?.content.let { it is Mission && it.messages.size == 1 })
                        "message-2-4-GUEST" else "message-4-4-GUEST")
                    "MISSION_DONE" -> advance("both-outcomes-4-GUEST")
                    "FEEDBACK" -> if (current.round?.header?.mode == GameKind.DESCRIBE) advance("finished-2-GUEST")
                        else current = current.copy(status = RoomStatus.COMPLETED, revision = current.revision + 1,
                            round = null, completedRounds = listOf(round("finished-0-GUEST"), round("finished-2-GUEST"), round("finished-4-GUEST")),
                            points = 6, allowedActions = listOf(RoomAction.LEAVE))
                    else -> error("Unexpected native UI action")
                }
                encoded(PlayRoom.serializer(), current)
            }
            request.path == "/api/v1/play/phrases" && request.method == "POST" -> {
                val body = SottoJson.parseToJsonElement(request.body).jsonObject
                val phrase = Phrase("kept-phrase", base.id, body.getValue("roundId").jsonPrimitive.content,
                    PhraseKind.valueOf(body.getValue("kind").jsonPrimitive.content), body.getValue("text").jsonPrimitive.content,
                    targetLang = "de", createdAt = "2026-10-20T00:00:00Z")
                phrases = listOf(phrase)
                encoded(Phrase.serializer(), phrase)
            }
            request.path == "/api/v1/play/phrases" -> encoded(PhraseList.serializer(), PhraseList(phrases))
            request.path == "/api/v1/courses" -> encoded(CourseList.serializer(), CourseList(emptyList()))
            else -> NativeReply(404, "{\"error\":\"Unavailable\"}")
        }
    }
    private fun status() = JoinStatusView(requireNotNull(requestID), JoinStatus.ACCEPTED,
        "2026-10-30T00:00:00Z", "2026-10-20T00:00:00Z")
    override fun close() { server.close() }
}
