package fm.sotto.app.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

val SottoJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

@Serializable enum class Seat { HOST, GUEST }
@Serializable enum class GameKind(val title: String) {
    MIXED("A little of everything"), KNOW_ME("Pick for each other"),
    DESCRIBE("Describe and guess"), MISSION("Secret mission")
}
@Serializable enum class Theme { EVERYDAY, FOOD, TRAVEL, SILLY, GET_TO_KNOW_YOU, AFFECTIONATE }
@Serializable enum class Level { A1, A2, B1, B2, C1, C2 }
@Serializable enum class QuestionStyle { CHOICES, OPEN }
@Serializable enum class RoomStatus { WAITING, PLAYING, COMPLETED, CANCELLED, EXPIRED }
@Serializable enum class RoomAction { START, NEXT_ROUND, REMATCH, LEAVE, CANCEL }
@Serializable enum class PhraseKind { WORD, PHRASE, SENTENCE }

@Serializable data class Settings(
    val nativeLang: String = "en", val targetLang: String = "es", val level: Level = Level.A1,
) {
    val valid: Boolean get() = nativeLang.matches(Regex("[a-z]{2,3}")) &&
        targetLang.matches(Regex("[a-z]{2,3}")) && nativeLang != targetLang
}
@Serializable data class Member(val id: String, val name: String, val settings: Settings)
@Serializable data class PlayRoom(
    val id: String, val status: RoomStatus, val revision: Int, val rematchRoomId: String? = null,
    val kind: GameKind, val theme: Theme, val questionStyle: QuestionStyle, val ownSeat: Seat,
    val host: Member, val guest: Member? = null, val hostWaiting: Boolean,
    val allowedActions: List<RoomAction>, val round: PlayRound? = null,
    val completedRounds: List<PlayRound>, val points: Int, val serverTime: String,
) {
    val ownMember: Member? get() = if (ownSeat == Seat.HOST) host else guest
}
@Serializable data class RoomList(val rooms: List<PlayRoom>, val nextCursor: String? = null)
@Serializable data class Phrase(
    val id: String, val roomId: String, val roundId: String, val kind: PhraseKind,
    val text: String, val contextText: String? = null, val targetLang: String, val createdAt: String,
)
@Serializable data class PhraseList(val phrases: List<Phrase>, val nextCursor: String? = null)
@Serializable data class Course(val id: String, val nativeLang: String, val targetLang: String,
    val currentLevel: Level, val startLevel: Level)
@Serializable data class CourseList(val courses: List<Course>)
