package fm.sotto.app.storage

import fm.sotto.app.model.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable data class Admission(
    val invitation: PlayInvitation, val command: JoinCommand, val proof: String,
    val existingConnection: Connection? = null, val delivery: Delivery? = null,
)
@Serializable enum class OperationResponse { ROOM, INVITATION, APPROVAL, PHRASE }
@Serializable data class PendingOperation(
    val id: String, val connection: Connection, val path: String, val body: String,
    val response: OperationResponse, val baseline: PlayRoom? = null, val reconciled: Boolean = false,
)
@Serializable data class Vault(
    val version: Int = 1, val serial: Long = 0, val connection: Connection? = null, val invitation: PlayInvitation? = null,
    val admission: Admission? = null, val retainedAdmissions: List<Admission> = emptyList(),
    val archivedConnections: List<Connection> = emptyList(), val pending: PendingOperation? = null,
    val drafts: Map<String, String> = emptyMap(),
) {
    fun archive(value: Connection): Vault {
        if (value in archivedConnections) return this
        require(archivedConnections.size < 16) { "Remove a saved connection before adding another." }
        return copy(archivedConnections = archivedConnections + value)
    }
    fun validate() {
        require(version == 1 && serial >= 0 && archivedConnections.size <= 16 && retainedAdmissions.size <= 16 && drafts.size <= 64)
        require(drafts.all { it.key.length <= 500 && it.value.length <= 500 })
        for (value in listOfNotNull(admission) + retainedAdmissions) {
            require(value.proof.matches(Regex("[A-Za-z0-9_-]{43}")))
            require(value.command.code == value.invitation.code && value.command.candidate.settings.valid)
            require(value.command.deviceName.length in 1..80)
            require((value.command.candidate.kind == CandidateKind.EXISTING) == (value.existingConnection != null))
            value.existingConnection?.let {
                require(it.server == value.invitation.server && it.profile.id == value.command.candidate.expectedProfileId)
            }
        }
        pending?.let {
            require(it.path.startsWith("/api/v1/play/") && it.body.toByteArray().size <= 16_384)
            SottoJson.decodeFromString<JsonObject>(it.body)
        }
    }
}

interface VaultPersistence {
    suspend fun load(): Vault
    suspend fun update(transform: (Vault) -> Vault): Vault
    suspend fun retryLoad(): Vault
    suspend fun erase()
}
