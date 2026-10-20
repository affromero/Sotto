package fm.sotto.app.model

import kotlinx.serialization.Serializable

@Serializable data class Profile(
    val id: String, val name: String, val isOwner: Boolean, val role: String,
    val isActive: Boolean? = null,
)
@Serializable data class ProfileList(val profiles: List<Profile>)
@Serializable data class Connection(val server: String, val token: String, val profile: Profile) {
    fun sameIdentity(other: Connection): Boolean =
        server == other.server && token == other.token && profile.id == other.profile.id

    init {
        require(PlayInvitation.origin(server) == server) { "Invalid saved server." }
        require(token.isNotBlank() && token.length <= 512 && !token.any { it.isISOControl() })
        require(profile.id.matches(Regex("[A-Za-z0-9_-]{1,100}")))
    }
}
