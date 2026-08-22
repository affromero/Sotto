import XCTest

@testable import Sotto

final class PairingTests: XCTestCase {
    func testTypedBareHostBecomesHTTPS() throws {
        let url = try XCTUnwrap(SottoAppModel.serverURL(fromTyped: " sotto.afromero.co "))
        XCTAssertEqual(url.absoluteString, "https://sotto.afromero.co")
        XCTAssertTrue(SottoServerURLPolicy.isSupported(url))
    }

    func testTypedAddressKeepsSchemeAndPort() throws {
        let url = try XCTUnwrap(SottoAppModel.serverURL(fromTyped: "http://192.168.1.20:3000/settings"))
        XCTAssertEqual(url.absoluteString, "http://192.168.1.20:3000")
        XCTAssertTrue(SottoServerURLPolicy.isSupported(url))
    }

    func testTypedGarbageIsRejected() {
        XCTAssertNil(SottoAppModel.serverURL(fromTyped: ""))
        XCTAssertNil(SottoAppModel.serverURL(fromTyped: "   "))
        XCTAssertNil(SottoAppModel.serverURL(fromTyped: "two words"))
    }

    func testPlainHTTPOnAPublicHostIsNotPairable() throws {
        let url = try XCTUnwrap(SottoAppModel.serverURL(fromTyped: "http://sotto.afromero.co"))
        XCTAssertFalse(SottoServerURLPolicy.isSupported(url))
    }

    func testWrongPasswordIsNamedRatherThanShownAsAStatusCode() {
        let message = SottoAppModel.pairingFailureMessage(
            for: SottoAPIError.message("Wrong password"),
            host: "sotto.afromero.co",
            sentPassword: true
        )
        XCTAssertEqual(message, "That password did not open sotto.afromero.co.")
    }

    func testMissingPasswordAsksForTheAccessPassword() {
        let message = SottoAppModel.pairingFailureMessage(
            for: SottoAPIError.message("Unauthorized"),
            host: "sotto.afromero.co",
            sentPassword: false
        )
        XCTAssertTrue(message.contains("access password"), message)
    }

    func testUnrelatedFailuresKeepTheirOwnMessage() {
        let message = SottoAppModel.pairingFailureMessage(
            for: SottoAPIError.message("Sotto returned HTTP 503."),
            host: "sotto.afromero.co",
            sentPassword: true
        )
        XCTAssertEqual(message, "Sotto returned HTTP 503.")
    }

    func testScannedPairingLinkKeepsServerAndToken() throws {
        let payload = try XCTUnwrap(PairingPayload(scannedValue: "https://sotto.afromero.co/connect?token=abc123"))
        XCTAssertEqual(payload.serverURL.absoluteString, "https://sotto.afromero.co")
        XCTAssertEqual(payload.token, "abc123")
    }

    func testScannedPlainServerURLIsNotAPairingLink() {
        XCTAssertNil(PairingPayload(scannedValue: "https://sotto.afromero.co"))
    }
}
