package fm.sotto.app

import fm.sotto.app.model.PlayInvitation
import org.junit.Assert.*
import org.junit.Test

class PlayInvitationTest {
    @Test fun nativeWebAndBridgeLinksReturnTheSameExplicitDestination() {
        val invite = PlayInvitation("https://languages.example", "ABCDEFGH2345")
        assertEquals(invite, PlayInvitation.parse(invite.appLink))
        assertEquals(invite, PlayInvitation.parse(invite.webLink))
        assertEquals(invite, PlayInvitation.parse("https://sotto.fm/play/join?v=1&server=https%3A%2F%2Flanguages.example&code=ABCDEFGH2345"))
        assertEquals("ABCD-EFGH-2345", invite.formattedCode)
        assertEquals(invite.code, PlayInvitation.normalizeCode("abcd-efgh 2345"))
        assertTrue(PlayInvitation.proof().matches(Regex("[A-Za-z0-9_-]{43}")))
        assertNotEquals(PlayInvitation.proof(), PlayInvitation.proof())
    }
    @Test fun malformedDuplicateAndCredentialBearingInvitesAreRejected() {
        val invalid = listOf(
            "sotto://play/join?v=1&code=ABCDEFGH2345",
            "sotto://play/join?v=2&server=https://example.com&code=ABCDEFGH2345",
            "sotto://play/join?v=1&server=https://example.com&code=ABCDEFGH2345&code=ABCDEFGH2345",
            "sotto://play/join?v=1&server=https://me:secret@example.com&code=ABCDEFGH2345",
            "https://example.com/play/join?v=1&server=https://other.example&code=ABCDEFGH2345",
            "https://example.com/play/join?v=1&code=ABCDEFGH2345&token=secret",
            "https://example.com/play/join?v=1&code=ABCDEFGH2345#secret",
            "sotto://play:3/join?v=1&server=https://example.com&code=ABCDEFGH2345",
            "https://example.com/connect?token=secret",
        )
        invalid.forEach { assertNull(it, PlayInvitation.parse(it)) }
    }
    @Test fun publicHttpIsDeniedWhilePrivateNetworkAddressesRemainReachable() {
        listOf("localhost", "127.0.0.1", "10.1.2.3", "172.16.0.4", "192.168.0.4", "sotto.local", "[::1]", "[fd00::1]")
            .forEach { assertNotNull(it, PlayInvitation.origin("http://$it:3000")) }
        listOf("http://example.com", "http://8.8.8.8", "http://172.32.0.1", "http://10.1.2.999",
            "https://user@example.com", "https://example.com/path", "https://example.com?secret=1")
            .forEach { assertNull(it, PlayInvitation.origin(it)) }
        assertEquals("https://example.com", PlayInvitation.origin("HTTPS://EXAMPLE.COM:443/"))
        assertEquals("http://[::1]", PlayInvitation.origin("http://[::1]:80/"))
    }
}
