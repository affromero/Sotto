import XCTest
@testable import Sotto

final class SottoServerURLPolicyTests: XCTestCase {
    func testAcceptsHTTPSServers() throws {
        let url = try XCTUnwrap(URL(string: "https://sotto.example.com"))

        XCTAssertTrue(SottoServerURLPolicy.isSupported(url))
    }

    func testAcceptsLocalHTTPServers() throws {
        let urls = try [
            "http://localhost:3000",
            "http://sotto.local",
            "http://10.0.0.4",
            "http://172.16.1.20",
            "http://192.168.1.44",
            "http://[::1]:3000",
            "http://[fe80::1]:3000",
            "http://[fd00::1]:3000",
            "http://[fc00::1]:3000"
        ].map { try XCTUnwrap(URL(string: $0)) }

        for url in urls {
            XCTAssertTrue(SottoServerURLPolicy.isSupported(url), "\(url) should be allowed")
        }
    }

    func testRejectsPublicHTTPServers() throws {
        let urls = try [
            "http://sotto.example.com",
            "http://fc-example.com",
            "http://fd.example.com",
            "http://[2001:4860:4860::8888]"
        ].map { try XCTUnwrap(URL(string: $0)) }

        for url in urls {
            XCTAssertFalse(SottoServerURLPolicy.isSupported(url), "\(url) should be rejected")
        }
    }

    func testRejectsUnsupportedSchemes() throws {
        let url = try XCTUnwrap(URL(string: "sotto://pair?token=abc123"))

        XCTAssertFalse(SottoServerURLPolicy.isSupported(url))
    }
}
