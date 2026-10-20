package fm.sotto.app.play

import fm.sotto.app.model.*
import fm.sotto.app.network.SottoClient
import fm.sotto.app.storage.OperationResponse
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*

suspend fun PlayCoordinator.loadPhrases(older: Boolean = false) {
    val connection = requireNotNull(state.value.vault?.connection)
    val generation = epoch
    val cursor = if (older) state.value.phrasesCursor else null
    val query = cursor?.let { "?beforeId=${SottoClient.id(it)}" }.orEmpty()
    try {
        val value = api(connection).get<PhraseList>("/api/v1/play/phrases$query")
        checkEpoch(generation, connection)
        mutable.update { it.copy(phrases = if (older) it.phrases + value.phrases.filterNot { next -> it.phrases.any { old -> old.id == next.id } }
            else value.phrases, phrasesCursor = value.nextCursor) }
    } catch (error: Exception) { memberFailure(error, generation, connection) }
}

suspend fun PlayCoordinator.loadOlderRooms() {
    val connection = requireNotNull(state.value.vault?.connection)
    val generation = epoch
    val cursor = state.value.roomsCursor ?: return
    val value = api(connection).get<RoomList>("/api/v1/play/rooms?beforeId=${SottoClient.id(cursor)}")
    checkEpoch(generation, connection)
    val added = value.rooms.filterNot { next -> state.value.rooms.any { it.id == next.id } }
    olderRooms += added; olderRoomsOpened = true
    mutable.update { it.copy(rooms = it.rooms + added, roomsCursor = value.nextCursor) }
}

suspend fun PlayCoordinator.keep(text: String, context: String, kind: PhraseKind, round: PlayRound, displayed: PlayRoom) {
    val connection = requireNotNull(state.value.vault?.connection)
    val current = requireNotNull(state.value.room)
    require(current.id == displayed.id && current.ownMember?.id == connection.profile.id)
    require((listOfNotNull(current.round) + current.completedRounds).any { it.id == round.id })
    val trimmed = text.trim()
    require(trimmed.length in 1..500 && round.visibleTexts.any { trimmed in it }) { "Choose visible words or a sentence from this round." }
    operation("/api/v1/play/phrases", buildJsonObject {
        put("roomId", current.id); put("roundId", round.id); put("kind", kind.name); put("text", trimmed)
        put("contextText", context.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
    }.toString(), OperationResponse.PHRASE)
}

suspend fun PlayCoordinator.loadStudyCourses() {
    val connection = requireNotNull(state.value.vault?.connection)
    val generation = epoch
    val value = api(connection).get<CourseList>("/api/v1/courses")
    checkEpoch(generation, connection)
    mutable.update { it.copy(courses = value.courses) }
}

suspend fun PlayCoordinator.addToStudy(phrase: Phrase, course: Course) {
    val connection = requireNotNull(state.value.vault?.connection)
    val generation = epoch
    require(course.targetLang == phrase.targetLang)
    val courses = api(connection).get<CourseList>("/api/v1/courses").courses
    checkEpoch(generation, connection)
    require(courses.any { it.id == course.id && it.targetLang == phrase.targetLang }) { "Choose your own course in this language." }
    api(connection).post<JsonObject>("/api/v1/courses/${SottoClient.id(course.id)}/learning-targets", buildJsonObject {
        put("text", phrase.text); put("kind", phrase.kind.name)
        put("contextText", phrase.contextText?.let(::JsonPrimitive) ?: JsonNull)
        put("sourceType", "MANUAL"); put("sourceId", phrase.id); put("sourceLabel", "Partner play")
    }.toString())
    checkEpoch(generation, connection)
    mutable.update { it.copy(notice = "Added to study.") }
}
