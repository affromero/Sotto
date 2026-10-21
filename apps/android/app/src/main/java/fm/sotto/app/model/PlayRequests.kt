package fm.sotto.app.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

@Serializable data class Command(
    val type: ActionType, val text: String? = null, val optionId: Option? = null,
    val achieved: Boolean? = null, val understood: Boolean? = null, val correction: String? = null,
) {
    fun payload(): JsonObject = buildJsonObject {
        put("type", type.name)
        when (type) {
            ActionType.SKIP -> Unit
            ActionType.CHOOSE -> put("optionId", requireNotNull(optionId).name)
            ActionType.MISSION_DONE -> put("achieved", requireNotNull(achieved))
            ActionType.FEEDBACK -> {
                put("understood", requireNotNull(understood))
                put("correction", correction?.let(::JsonPrimitive) ?: JsonNull)
            }
            else -> put("text", requireNotNull(text))
        }
    }
}
@Serializable enum class CandidateKind { EXISTING, NEW }
@Serializable data class JoinCandidate(
    val kind: CandidateKind, val settings: Settings, val expectedProfileId: String? = null,
    val name: String? = null, val consentToProfile: Boolean? = null,
) {
    fun payload(): JsonObject = buildJsonObject {
        put("kind", kind.name)
        put("settings", SottoJson.encodeToJsonElement(Settings.serializer(), settings))
        if (kind == CandidateKind.EXISTING) put("expectedProfileId", requireNotNull(expectedProfileId))
        else { put("name", requireNotNull(name)); put("consentToProfile", consentToProfile == true) }
    }
}
@Serializable data class JoinCommand(
    val requestId: String, val code: String, val deviceName: String, val candidate: JoinCandidate,
    val acceptedConductVersion: Int? = null,
) {
    fun payload(): String = buildJsonObject {
        put("requestId", requestId); put("code", code); put("client", "NATIVE")
        put("deviceName", deviceName); put("candidate", candidate.payload())
        acceptedConductVersion?.let { put("acceptedConductVersion", it) }
    }.toString()
}
@Serializable enum class JoinStatus {
    WAITING_FOR_OWNER, WAITING_FOR_HOST, HOST_UNAVAILABLE, ACCEPTED, CLAIMED, DECLINED, EXPIRED, REVOKED
}
@Serializable data class JoinStatusView(
    val requestId: String, val status: JoinStatus, val expiresAt: String, val serverTime: String,
)
@Serializable enum class Approval { APPROVE_PROFILE, ACCEPT, DECLINE }
@Serializable data class PendingRequest(
    val requestId: String, val roomId: String, val roomRevision: Int, val name: String,
    val candidateKind: CandidateKind, val settings: Settings, val status: JoinStatus,
    val profileId: String? = null, val allowedActions: List<Approval>, val expiresAt: String, val serverTime: String,
)
@Serializable data class PendingList(val requests: List<PendingRequest>)
@Serializable enum class DeliveryKind { NATIVE, EXISTING }
@Serializable data class Delivery(
    val kind: DeliveryKind, val deliveryId: String? = null, val roomId: String, val profile: Member,
    val token: String? = null, val expiresAt: String? = null,
)
@Serializable data class Presence(val hostWaiting: Boolean, val expiresAt: String? = null, val serverTime: String)
@Serializable data class InvitationView(val roomId: String, val code: String, val generation: Int, val expiresAt: String)
@Serializable data class Preview(
    val roomId: String, val hostName: String, val kind: GameKind, val theme: Theme,
    val questionStyle: QuestionStyle, val hostWaiting: Boolean, val expiresAt: String, val serverTime: String,
)
fun newID(): String = UUID.randomUUID().toString()
