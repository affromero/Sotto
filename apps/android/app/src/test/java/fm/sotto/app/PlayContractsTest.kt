package fm.sotto.app

import fm.sotto.app.model.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class PlayContractsTest {
    @Serializable private data class Fixtures(val version: Int, val rounds: List<RoundFixture>, val rooms: List<RoomFixture>)
    @Serializable private data class RoundFixture(val name: String, val seat: Seat, val round: PlayRound, val visibleTexts: List<String>)
    @Serializable private data class RoomFixture(val name: String, val room: PlayRoom)

    @Test fun everySharedProjectionPreservesItsLanguageContentAndHiddenState() {
        val bytes = requireNotNull(javaClass.classLoader?.getResourceAsStream("contract.json")).use { it.readBytes() }
        val fixtures = SottoJson.decodeFromString<Fixtures>(bytes.toString(Charsets.UTF_8))
        assertEquals(1, fixtures.version)
        for (fixture in fixtures.rounds) {
            assertEquals(fixture.name, fixture.visibleTexts, fixture.round.visibleTexts)
            assertEquals(fixture.name, fixture.round, SottoJson.decodeFromString<PlayRound>(
                SottoJson.encodeToString(fixture.round)))
            val content = fixture.round.content
            if (content is Prediction && !fixture.round.header.revealed) assertNull(content.otherAnswer)
            if (content is Mission && !fixture.round.header.revealed) assertNull(content.otherObjective)
        }
        assertTrue(fixtures.rooms.any { it.room.ownSeat == Seat.HOST })
        assertTrue(fixtures.rooms.any { it.room.ownSeat == Seat.GUEST })
    }

    @Test fun commandsUseTheStrictServerShapeIncludingNullCorrection() {
        assertEquals(buildJsonObject { put("type", "FEEDBACK"); put("understood", true); put("correction", JsonNull) },
            Command(ActionType.FEEDBACK, understood = true).payload())
        assertEquals(setOf("type", "optionId"), Command(ActionType.CHOOSE, optionId = Option.B).payload().keys)
        assertEquals(setOf("type"), Command(ActionType.SKIP).payload().keys)
        val existing = JoinCandidate(CandidateKind.EXISTING, Settings(), expectedProfileId = "profile-1").payload()
        assertEquals("profile-1", existing["expectedProfileId"]?.jsonPrimitive?.content)
        assertFalse(existing.containsKey("consentToProfile"))
        val newcomer = JoinCandidate(CandidateKind.NEW, Settings(), name = "Ada", consentToProfile = true).payload()
        assertFalse(newcomer.containsKey("expectedProfileId"))
        assertEquals(JsonPrimitive(true), newcomer["consentToProfile"])
    }
}
