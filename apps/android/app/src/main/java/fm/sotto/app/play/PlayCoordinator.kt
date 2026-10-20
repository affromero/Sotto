package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.network.HouseholdPairing
import fm.sotto.app.network.SottoClient
import fm.sotto.app.network.ConnectionFailure
import fm.sotto.app.storage.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class PlayCoordinator(val store: VaultPersistence, val scope: CoroutineScope, val deviceName: String) {
    internal val mutable = MutableStateFlow(PlayState())
    val state = mutable.asStateFlow()
    internal var epoch = 0L
    internal var foreground = false
    internal var polling: Job? = null
    internal var work: Job? = null
    internal var lease: Lease? = null
    internal var pairing: HouseholdPairing? = null
    internal var olderRooms = emptyList<PlayRoom>()
    internal var olderRoomsOpened = false
    internal var confirmation: DeferredConfirmation? = null

    fun confirm(block: suspend PlayCoordinator.() -> Unit) {
        if (state.value.busy) return
        if (foreground) { run(block); return }
        val pending = DeferredConfirmation(newID(), epoch, state.value.screen,
            state.value.vault?.connection, System.nanoTime() + 3_000_000_000L, block)
        confirmation = pending
        scope.launch {
            delay(3000)
            if (confirmation?.id == pending.id) clearConfirmation()
        }
    }

    internal fun clearConfirmation() {
        if (confirmation == null) return
        confirmation = null
        mutable.update { it.copy(notice = "The confirmation expired or the screen changed. Please confirm again.") }
    }

    fun run(block: suspend PlayCoordinator.() -> Unit) {
        if (state.value.busy) return
        val generation = epoch
        val connection = state.value.vault?.connection
        val screen = state.value.screen
        mutable.update { it.copy(busy = true, error = null, notice = null, networkHelp = false) }
        work = scope.launch {
            try {
                checkEpoch(generation, connection)
                if (state.value.screen != screen) throw CancellationException()
                block()
            }
            catch (_: CancellationException) { }
            catch (error: Exception) { if (epoch == generation) report(error) }
            finally { if (epoch == generation) mutable.update { it.copy(busy = false) } }
        }
    }

    internal fun report(error: Exception) {
        mutable.update { it.copy(error = error.message ?: "The request failed. Please retry.", networkHelp = error is ConnectionFailure) }
    }

    internal fun checkEpoch(generation: Long, connection: Connection? = state.value.vault?.connection) {
        if (!foreground || generation != epoch || connection != state.value.vault?.connection)
            throw CancellationException()
    }

    internal suspend fun persist(transform: (Vault) -> Vault): Vault {
        val next = store.update(transform)
        publish(next)
        return next
    }

    internal fun publish(next: Vault) {
        val before = state.value
        if (next.serial < (before.vault?.serial ?: -1)) return
        if (before.vault?.connection != next.connection) {
            clearConfirmation()
            releasePresence()
            olderRooms = emptyList(); olderRoomsOpened = false
            mutable.update { PlayState(vault = next, screen = it.screen, busy = it.busy, active = foreground,
                error = it.error, identityGeneration = it.identityGeneration + 1) }
        } else mutable.update { it.copy(vault = next) }
    }

    internal fun api(connection: Connection = requireNotNull(state.value.vault?.connection)) =
        SottoClient(connection.server, connection)

    fun navigate(screen: Screen) {
        stopLifetime()
        if (screen != Screen.Pair) { pairing?.close(); pairing = null }
        mutable.update { it.copy(screen = screen, room = null, invitation = null, preview = null,
            requests = emptyList(), error = null, pairingProfiles = emptyList(), pairingServer = null) }
        if (foreground) startLifetime()
    }

    internal fun moveToRoom(value: PlayRoom) {
        if (!acceptsRoom(value)) return
        if (state.value.screen != Screen.Room(value.id)) {
            releasePresence()
            mutable.update { it.copy(room = null, invitation = null, requests = emptyList()) }
        }
        mutable.update { it.copy(screen = Screen.Room(value.id), room = value) }
    }

    internal fun acceptsRoom(value: PlayRoom): Boolean {
        require(value.ownMember?.id == state.value.vault?.connection?.profile?.id) {
            "The server returned another profile's room."
        }
        val previous = state.value.room?.takeIf { it.id == value.id } ?: return true
        if (value.revision < previous.revision) return false
        return value.revision != previous.revision ||
            java.time.Instant.parse(value.serverTime) >= java.time.Instant.parse(previous.serverTime)
    }

    internal fun applyRoom(value: PlayRoom): Boolean {
        if (!acceptsRoom(value)) return false
        mutable.update { it.copy(room = value) }
        return true
    }

    internal fun clearMemberData() {
        olderRooms = emptyList(); olderRoomsOpened = false
        mutable.update { before -> PlayState(vault = before.vault, screen = before.screen, active = foreground,
            busy = before.busy, error = before.error, identityGeneration = before.identityGeneration + 1) }
    }

    suspend fun acceptInvitation(value: PlayInvitation) {
        persist {
            require(it.admission == null || it.admission.invitation == value) {
                "Finish or keep the current invitation recovery before opening another."
            }
            it.copy(invitation = value)
        }
        navigate(Screen.Join)
    }

    suspend fun openPairing(serverText: String, password: String) {
        val server = requireNotNull(PlayInvitation.typedServer(serverText)) { "Use HTTPS or a private local server address." }
        val generation = epoch
        val connection = state.value.vault?.connection
        pairing?.close()
        val session = HouseholdPairing(server)
        pairing = session
        try {
            val profiles = session.open(password)
            checkEpoch(generation, connection)
            require(profiles.profiles.isNotEmpty()) { "Create a learner on the server first." }
            mutable.update { it.copy(pairingProfiles = profiles.profiles, pairingServer = server) }
        } catch (error: Exception) { session.close(); if (pairing === session) pairing = null; throw error }
    }

    suspend fun finishPairing(profileID: String) {
        val session = requireNotNull(pairing)
        val generation = epoch
        val original = state.value.vault?.connection
        val next = session.complete(profileID, deviceName)
        checkEpoch(generation, original)
        activate(next)
        session.close(); pairing = null
        mutable.update { it.copy(screen = if (it.vault?.invitation != null) Screen.Join else Screen.Lobby) }
    }

    internal suspend fun activate(next: Connection) {
        persist {
            require(it.pending == null || it.pending.connection == next) { "Recover the original pending action first." }
            val archived = it.connection?.takeIf { before -> before != next }?.let(it::archive) ?: it
            archived.copy(connection = next)
        }
        polling?.cancel()
        if (foreground) startLifetime()
    }

    suspend fun switchConnection(next: Connection) {
        val generation = epoch
        val original = state.value.vault?.connection
        val profiles = api(next).get<ProfileList>("/api/v1/profiles")
        checkEpoch(generation, original)
        val profile = requireNotNull(profiles.profiles.firstOrNull { it.id == next.profile.id }) {
            "This saved device no longer has access to its profile."
        }
        val originalPending = state.value.vault?.pending?.connection?.takeIf { it.sameIdentity(next) }
        activate(originalPending ?: next.copy(profile = profile))
        mutable.update { it.copy(screen = Screen.Lobby) }
    }

    suspend fun eraseSavedData() {
        stopLifetime(cancelWork = false)
        pairing?.close(); pairing = null
        withContext(NonCancellable) {
            store.erase()
            mutable.value = PlayState(vault = store.load(), active = foreground, identityGeneration = state.value.identityGeneration + 1)
        }
        if (foreground) startLifetime()
    }

    suspend fun retrySavedData() {
        publish(store.retryLoad())
        mutable.update { it.copy(error = null) }
        polling?.cancel()
        if (foreground) startLifetime()
    }

    suspend fun saveDraft(key: String, text: String) {
        persist { it.copy(drafts = if (text.isEmpty()) it.drafts - key else it.drafts + (key to text.take(500))) }
    }

    fun draftKey(room: PlayRoom, round: PlayRound, action: ActionType): String {
        val count = (round.content as? Mission)?.messages?.count { it.seat == room.ownSeat } ?: 0
        return "${state.value.vault?.connection?.server}/${room.ownMember?.id}/${room.id}/${round.id}/${round.header.phase}/$action/$count"
    }
}
