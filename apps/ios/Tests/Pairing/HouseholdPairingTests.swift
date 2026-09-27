import XCTest

@testable import Sotto

final class HouseholdPairingTests: XCTestCase {
    func testHouseholdListsLearnersBeforeIssuingAnExplicitlySelectedPairing() async throws {
        let client = client()
        let household = try await HouseholdPairing.open(client: client, password: " password ")
        XCTAssertEqual(household.profiles.map(\.name), ["Alice", "Bob"])
        let issuedBeforeSelection = await HouseholdPairingServer.shared.issued(for: client.serverURL.host!)
        XCTAssertNil(issuedBeforeSelection)
        let payload = try await household.issuePairing(profileID: "bob", deviceName: "iPad")
        XCTAssertEqual(payload.token, "pair-for-bob")
        XCTAssertEqual(payload.serverURL, client.serverURL)
    }

    func testUnknownLearnerCannotIssuePairing() async throws {
        let client = client()
        let household = try await HouseholdPairing.open(client: client, password: " password ")
        do {
            _ = try await household.issuePairing(profileID: "unknown", deviceName: "iPad")
            XCTFail("A learner absent from this household must not be paired.")
        } catch { XCTAssertTrue(error.localizedDescription.contains("Choose")) }
        let issued = await HouseholdPairingServer.shared.issued(for: client.serverURL.host!)
        XCTAssertNil(issued)
    }

    func testRejectedProfileSelectionDoesNotIssuePairing() async throws {
        let client = client(prefix: "denied")
        let household = try await HouseholdPairing.open(client: client, password: " password ")
        do {
            _ = try await household.issuePairing(profileID: "bob", deviceName: "iPad")
            XCTFail("Profile rejection must stop pairing.")
        } catch { XCTAssertTrue(error.localizedDescription.contains("forbidden")) }
        let issued = await HouseholdPairingServer.shared.issued(for: client.serverURL.host!)
        XCTAssertNil(issued)
    }

    func testPasswordlessHouseholdUsesItsExplicitOpenEndpoint() async throws {
        let household = try await HouseholdPairing.open(client: client(prefix: "open"), password: "")
        XCTAssertEqual(household.profiles.count, 2)
    }

    func testEmptyHouseholdExplainsHowToCreateALearner() async {
        do {
            _ = try await HouseholdPairing.open(client: client(prefix: "empty"), password: " password ")
            XCTFail("An empty household must not issue pairing.")
        } catch { XCTAssertTrue(error.localizedDescription.contains("Create a learner")) }
    }

    private func client(prefix: String = "household") -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HouseholdPairingProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://\(prefix)-\(UUID().uuidString.lowercased()).example")!, apiKey: nil, session: URLSession(configuration: configuration))
    }
}

private actor HouseholdPairingServer {
    static let shared = HouseholdPairingServer()
    private var admitted = Set<String>()
    private var selected: [String: String] = [:]
    private var paired: [String: String] = [:]

    func issued(for host: String) -> String? { paired[host] }

    func respond(host: String, path: String, body: [String: String]) -> (Int, String) {
        if path == "/api/v1/access/household" {
            guard body["password"] == " password " else { return (401, #"{"error":"Wrong password"}"#) }
            admitted.insert(host)
            return (200, #"{"sessionId":"session"}"#)
        }
        if path == "/api/v1/access/open-household" {
            guard host.hasPrefix("open-"), body.isEmpty else { return (403, #"{"error":"forbidden"}"#) }
            admitted.insert(host)
            return (200, #"{"sessionId":"session"}"#)
        }
        guard admitted.contains(host) else { return (401, #"{"error":"Unauthorized"}"#) }
        if path == "/api/v1/profiles" {
            if host.hasPrefix("empty-") { return (200, #"{"profiles":[]}"#) }
            return (200, #"{"profiles":[{"id":"alice","name":"Alice","avatarUrl":"/alice.png","isOwner":true,"role":"ADMIN"},{"id":"bob","name":"Bob","avatarUrl":"/bob.png","isOwner":false,"role":"USER"}]}"#)
        }
        if path == "/api/v1/profiles/switch" {
            guard !host.hasPrefix("denied-"), let profile = body["profileId"] else { return (403, #"{"error":"forbidden"}"#) }
            selected[host] = profile
            return (200, "{\"ok\":true,\"profileId\":\"\(profile)\"}")
        }
        if path == "/api/v1/auth/pair", let profile = selected[host] {
            paired[host] = profile
            return (201, "{\"token\":\"pair-for-\(profile)\",\"serverUrl\":\"https://\(host)\",\"expiresAt\":\"2026-09-28T00:00:00Z\"}")
        }
        return (403, #"{"error":"Choose a household profile first"}"#)
    }
}

private final class HouseholdPairingProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let host = url.host else { return }
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        if request.httpMethod == "POST" {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), "https://\(host)")
        }
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                guard count > 0 else { break }
                data.append(contentsOf: buffer.prefix(count))
            }
        }
        let body = (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
        Task {
            let (status, json) = await HouseholdPairingServer.shared.respond(host: host, path: url.path, body: body)
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(json.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
