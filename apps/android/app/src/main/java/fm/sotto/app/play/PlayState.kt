package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.storage.Vault

sealed interface Screen {
    data object Lobby : Screen
    data object Join : Screen
    data object Pair : Screen
    data object Notebook : Screen
    data object Saved : Screen
    data object Safety : Screen
    data class Room(val id: String) : Screen
}

data class PlayState(
    val vault: Vault? = null, val screen: Screen = Screen.Lobby,
    val room: PlayRoom? = null, val rooms: List<PlayRoom> = emptyList(),
    val roomUnavailable: Boolean = false,
    val roomsCursor: String? = null, val requests: List<PendingRequest> = emptyList(),
    val invitation: InvitationView? = null, val preview: Preview? = null, val joinStatus: JoinStatus? = null,
    val phrases: List<Phrase> = emptyList(), val phrasesCursor: String? = null,
    val courses: List<Course> = emptyList(), val pairingProfiles: List<Profile> = emptyList(),
    val policy: ConductPolicy? = null, val safety: SafetyStatus? = null, val safetyRoom: PlayRoom? = null,
    val blocks: List<PlayerBlock> = emptyList(), val blocksCursor: String? = null,
    val reports: List<SafetyReport> = emptyList(), val reportsCursor: String? = null,
    val blocksExpanded: Boolean = false, val reportsExpanded: Boolean = false,
    val pendingConductAccepted: Boolean = false, val legacyRequestMissing: Boolean = false,
    val pairingServer: String? = null, val owner: Boolean? = null, val leaseReady: Boolean = false,
    val busy: Boolean = false, val checking: Boolean = false, val active: Boolean = false, val accessRevoked: Boolean = false,
    val error: String? = null, val notice: String? = null, val networkHelp: Boolean = false, val identityGeneration: Long = 0,
)
