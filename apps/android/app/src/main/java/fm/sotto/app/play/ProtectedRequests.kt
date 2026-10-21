package fm.sotto.app.play

import fm.sotto.app.model.Connection
import fm.sotto.app.storage.Vault

/** Both lanes use the same atomic identity and no-overwrite boundary. */
internal suspend fun <T> PlayCoordinator.stageProtectedRequest(
    connection: Connection, request: T, current: (Vault) -> T?, replace: (Vault, T) -> Vault,
) {
    checkEpoch(epoch, connection)
    persist {
        require(it.connection == connection && current(it) == null) { "Recover the saved request first." }
        replace(it, request)
    }
}

internal suspend fun <T> PlayCoordinator.completeProtectedRequest(
    request: T, current: (Vault) -> T?, replace: (Vault) -> Vault,
) {
    persist {
        require(current(it) == request) { "The saved request changed. Its recovery is kept." }
        replace(it)
    }
}
