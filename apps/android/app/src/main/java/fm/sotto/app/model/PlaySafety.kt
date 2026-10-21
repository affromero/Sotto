package fm.sotto.app.model

import kotlinx.serialization.Serializable

const val CONDUCT_VERSION = 1

@Serializable data class ConductPolicy(
    val version: Int, val title: String, val paragraphs: List<String>, val operatorContactUrl: String? = null,
    val termsPath: String, val privacyPath: String, val reviewPath: String,
)
@Serializable data class SafetyStatus(
    val profileId: String, val acceptedVersion: Int? = null, val acceptedAt: String? = null,
    val sharingRestricted: Boolean, val canReviewReports: Boolean, val serverTime: String,
)
@Serializable data class SafetyAck(val actionId: String, val completed: Boolean)
@Serializable data class PendingConductAck(val requestId: String, val version: Int)
@Serializable data class PlayerBlock(val blockedUserId: String, val name: String, val createdAt: String)
@Serializable data class BlockList(val blocks: List<PlayerBlock>, val nextCursor: String? = null)
@Serializable enum class ReportCategory { HARASSMENT, THREATS, HATE, SEXUAL_CONTENT, VIOLENCE, IMPERSONATION, OTHER }
@Serializable enum class ReportField { TARGET, CLUE, GUESS, OTHER_ANSWER, MESSAGE, HINT, CORRECTION }
@Serializable enum class SelectorKind { PARTNER_NAME, ROUND_TEXT }
@Serializable data class ReportSelector(
    val kind: SelectorKind, val roundId: String? = null, val field: ReportField? = null, val index: Int? = null,
)
@Serializable data class ReportEvidence(val selector: ReportSelector, val text: String)
@Serializable enum class ReportStatus { OPEN, RESOLVED }
@Serializable data class SafetyReport(
    val id: String, val roomId: String? = null, val category: ReportCategory, val detail: String,
    val evidence: ReportEvidence, val status: ReportStatus, val revision: Long, val createdAt: String,
    val response: String? = null, val respondedAt: String? = null,
)
@Serializable data class ReportList(val reports: List<SafetyReport>, val nextCursor: String? = null)

/** Only text already visible and attributable to the other participant. */
fun PlayRoom.reportableEvidence(): List<ReportEvidence> = buildList {
    val seat = ownSeat
    val partner = if (seat == Seat.HOST) guest else host
    partner?.let { add(ReportEvidence(ReportSelector(SelectorKind.PARTNER_NAME), it.name)) }
    (completedRounds + listOfNotNull(round)).distinctBy { it.id }.forEach { item ->
        fun addText(field: ReportField, text: String?, index: Int? = null) {
            if (!text.isNullOrEmpty()) add(ReportEvidence(ReportSelector(SelectorKind.ROUND_TEXT, item.id, field, index), text))
        }
        when (val content = item.content) {
            is Describe -> {
                if (item.header.learner != seat) {
                    addText(ReportField.TARGET, content.target)
                    addText(ReportField.CLUE, content.clue)
                } else addText(ReportField.GUESS, content.guess)
            }
            is Prediction -> if (content.questionStyle == QuestionStyle.OPEN)
                addText(ReportField.OTHER_ANSWER, content.otherAnswer)
            is Mission -> content.messages.forEachIndexed { index, message ->
                if (message.seat != seat) addText(ReportField.MESSAGE, message.text, index)
            }
        }
        item.header.hints.forEachIndexed { index, hint ->
            if (hint.seat != seat) addText(ReportField.HINT, hint.text, index)
        }
        if (item.header.learner == seat) addText(ReportField.CORRECTION, item.header.result?.correction)
    }
}
