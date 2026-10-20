package fm.sotto.app.play

import fm.sotto.app.model.Connection
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.update

suspend fun PlayCoordinator.deleteProfile(expected: Connection) {
    val current = requireNotNull(state.value.vault?.connection)
    require(current == expected) { "The selected profile changed. Confirm deletion again." }
    checkEpoch(epoch, current)
    api(current).deleteAccount()
    withContext(NonCancellable) {
        persist { saved ->
            fun matches(value: Connection?) = value?.server == current.server && value.profile.id == current.profile.id
            saved.copy(
                connection = saved.connection?.takeUnless(::matches),
                archivedConnections = saved.archivedConnections.filterNot(::matches),
                pending = saved.pending?.takeUnless { matches(it.connection) },
                admission = saved.admission?.takeUnless { matches(it.existingConnection) ||
                    (it.invitation.server == current.server && it.delivery?.profile?.id == current.profile.id) },
                retainedAdmissions = saved.retainedAdmissions.filterNot { matches(it.existingConnection) ||
                    (it.invitation.server == current.server && it.delivery?.profile?.id == current.profile.id) },
                drafts = saved.drafts.filterKeys { !it.startsWith("${current.server}/${current.profile.id}/") },
            )
        }
    }
    if (state.value.vault?.connection == null) {
        releasePresence()
        olderRooms = emptyList(); olderRoomsOpened = false
        mutable.update { it.copy(screen = Screen.Lobby, room = null, rooms = emptyList(),
            requests = emptyList(), phrases = emptyList(), error = null,
            notice = "Profile deletion accepted. Your server is removing its stored files. Other saved profiles are kept.") }
    }
}
