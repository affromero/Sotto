package fm.sotto.app.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject

@Serializable enum class Phase { SETUP, CLUE, GUESS, ANSWER, EXCHANGE, FEEDBACK, FINISHED }
@Serializable enum class Role { LEARNER, PARTNER }
@Serializable enum class ActionType {
    SET_TARGET, GIVE_CLUE, GUESS, ANSWER, CHOOSE, MESSAGE, MISSION_DONE, HINT, FEEDBACK, SKIP
}
@Serializable enum class Option { A, B, C, D }
@Serializable data class Choice(val id: Option, val text: String, val supportText: String? = null, val symbol: String)
@Serializable data class Message(val seat: Seat, val text: String)
@Serializable data class Result(
    val skipped: Boolean, val understood: Boolean? = null, val matched: Boolean? = null,
    val correction: String? = null, val points: Int,
)
@Serializable data class RoundHeader(
    val id: String, val order: Int, val learner: Seat, val targetLang: String, val supportLang: String,
    val level: Level, val prompt: String, val guidance: String, val phase: Phase, val role: Role,
    val instruction: String, val revealed: Boolean, val allowedActions: List<ActionType>,
    val hints: List<Message>, val result: Result? = null, val mode: GameKind,
)
sealed interface RoundContent
@Serializable data class Describe(
    val targetSuggestions: List<Choice>? = null, val target: String? = null,
    val clue: String? = null, val guess: String? = null,
) : RoundContent
@Serializable data class Prediction(
    val questionStyle: QuestionStyle, val choices: List<Choice>, val ownAnswer: String? = null,
    val otherAnswer: String? = null, val otherCommitted: Boolean,
) : RoundContent {
    fun label(answer: String): String = if (questionStyle == QuestionStyle.CHOICES)
        choices.firstOrNull { it.id.name == answer }?.text ?: answer else answer
}
@Serializable data class Mission(
    val ownObjective: String, val otherObjective: String? = null, val messages: List<Message>,
    val remainingMessages: Int, val twist: String? = null,
    val ownOutcome: Boolean? = null, val otherOutcome: Boolean? = null,
) : RoundContent

@Serializable(with = RoundSerializer::class)
data class PlayRound(val header: RoundHeader, val content: RoundContent) {
    val id: String get() = header.id
    val visibleTexts: List<String> get() = buildList {
        addAll(header.hints.map { it.text })
        header.result?.correction?.let { add(it) }
        when (val value = content) {
            is Describe -> {
                addAll(value.targetSuggestions.orEmpty().map { it.text })
                addAll(listOfNotNull(value.target, value.clue, value.guess))
            }
            is Prediction -> if (value.questionStyle == QuestionStyle.CHOICES)
                addAll(value.choices.map { it.text })
            else addAll(listOfNotNull(value.ownAnswer, value.otherAnswer))
            is Mission -> addAll(value.messages.map { it.text })
        }
    }.distinct()
}

object RoundSerializer : KSerializer<PlayRound> {
    override val descriptor: SerialDescriptor = RoundHeader.serializer().descriptor
    override fun deserialize(decoder: Decoder): PlayRound {
        require(decoder is JsonDecoder)
        val value = decoder.decodeJsonElement()
        val header = decoder.json.decodeFromJsonElement<RoundHeader>(value)
        val content = when (header.mode) {
            GameKind.DESCRIBE -> decoder.json.decodeFromJsonElement<Describe>(value)
            GameKind.KNOW_ME -> decoder.json.decodeFromJsonElement<Prediction>(value)
            GameKind.MISSION -> decoder.json.decodeFromJsonElement<Mission>(value)
            GameKind.MIXED -> error("A round needs one game.")
        }
        return PlayRound(header, content)
    }
    override fun serialize(encoder: Encoder, value: PlayRound) {
        require(encoder is JsonEncoder)
        val content = when (val data = value.content) {
            is Describe -> encoder.json.encodeToJsonElement(data)
            is Prediction -> encoder.json.encodeToJsonElement(data)
            is Mission -> encoder.json.encodeToJsonElement(data)
        }
        encoder.encodeJsonElement(JsonObject(
            encoder.json.encodeToJsonElement(value.header).jsonObject + content.jsonObject,
        ))
    }
}
