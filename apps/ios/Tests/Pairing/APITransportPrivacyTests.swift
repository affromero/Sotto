import Network
import XCTest

@testable import Sotto

final class APITransportPrivacyTests: XCTestCase {
    func testSameOriginMediaRedirectRetainsBearerWithoutCookies() async throws {
        let server = try LocalHTTPServer { request in
            if request.hasPrefix("GET /audio-final ") {
                return .init(status: 200, headers: ["Content-Type": "audio/mpeg"], body: "audio bytes")
            }
            return .init(status: 307, headers: ["Location": "/audio-final"], body: "")
        }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "media-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let audio = try await client.downloadLearningAudio(from: "/audio")
        defer { try? FileManager.default.removeItem(at: audio) }
        XCTAssertEqual(try Data(contentsOf: audio), Data("audio bytes".utf8))
        XCTAssertEqual(server.requests.count, 2)
        for request in server.requests {
            XCTAssertTrue(request.lowercased().contains("authorization: bearer media-secret"), request)
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"), request)
            XCTAssertFalse(request.lowercased().contains("cookie:"), request)
        }
    }

    func test307DoesNotForwardHouseholdPasswordToAnotherOrigin() async throws {
        try await rejectRedirect(status: 307)
    }

    func test308DoesNotForwardPairingTokenToAnotherOrigin() async throws {
        try await rejectRedirect(status: 308)
    }

    private func rejectRedirect(status: Int) async throws {
        let destination = try LocalHTTPServer { _ in .json(#"{"sessionId":"leaked"}"#) }
        try await destination.start()
        defer { destination.stop() }
        let redirectURL = destination.url.appendingPathComponent("capture")
        let origin = try LocalHTTPServer { _ in
            .init(status: status, headers: ["Location": redirectURL.absoluteString], body: "")
        }
        try await origin.start()
        defer { origin.stop() }
        let client = SottoAPIClient(serverURL: origin.url, apiKey: nil, session: URLSession(configuration: .ephemeral))
        do {
            if status == 307 { try await client.enterHousehold(password: "private-password") }
            else { _ = try await client.redeemPairingToken("private-token") }
            XCTFail("Cross-origin redirects must fail before sending their private body.")
        } catch { XCTAssertTrue(error.localizedDescription.contains(String(status)), error.localizedDescription) }
        XCTAssertTrue(origin.requests.first?.contains(status == 307 ? "private-password" : "private-token") == true)
        XCTAssertTrue(destination.requests.isEmpty, "The redirected server must receive neither headers nor body.")
    }

    func testHouseholdCookieSurvivesSameOriginRedirectButBearerRequestsExcludeIt() async throws {
        let server = try LocalHTTPServer { request in
            let path = request.components(separatedBy: " ").dropFirst().first ?? ""
            if path == "/api/v1/access/household" {
                return .init(status: 200, headers: ["Set-Cookie": "household=private; Path=/; HttpOnly"], body: #"{"sessionId":"session"}"#)
            }
            if path == "/api/v1/profiles" {
                return .init(status: 307, headers: ["Location": "/profiles-final"], body: "")
            }
            return .json(#"{"profiles":[]}"#)
        }
        try await server.start()
        defer { server.stop() }
        let session = URLSession(configuration: .ephemeral)
        let household = SottoAPIClient(serverURL: server.url, apiKey: nil, session: session)
        try await household.enterHousehold(password: "password")
        _ = try await household.listProfiles()
        let bearer = SottoAPIClient(serverURL: server.url, apiKey: "private-bearer", profileId: "learner", session: session)
        _ = try await bearer.listProfiles()
        let requests = server.requests
        XCTAssertEqual(requests.count, 5)
        guard requests.count == 5 else { return }
        for request in requests[1...2] {
            XCTAssertTrue(request.lowercased().contains("cookie: household=private"), request)
            XCTAssertFalse(request.lowercased().contains("authorization:"), request)
        }
        for request in requests[3...4] {
            XCTAssertFalse(request.lowercased().contains("cookie:"), request)
            XCTAssertTrue(request.lowercased().contains("authorization: bearer private-bearer"), request)
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"), request)
        }
    }
}

/// A real loopback HTTP boundary exercises Foundation's redirect and cookie
/// handling, which URLProtocol fixtures do not reproduce.
private final class LocalHTTPServer: @unchecked Sendable {
    struct Response {
        let status: Int
        let headers: [String: String]
        let body: String
        static func json(_ body: String) -> Self { .init(status: 200, headers: [:], body: body) }
    }
    private let listener: NWListener
    private let queue = DispatchQueue(label: "SottoTransportPrivacyTest")
    private let lock = NSLock()
    private var received: [String] = []
    private let respond: @Sendable (String) -> Response
    var requests: [String] { lock.withLock { received } }
    var url: URL { URL(string: "http://127.0.0.1:\(listener.port!.rawValue)")! }

    init(respond: @escaping @Sendable (String) -> Response) throws {
        listener = try NWListener(using: .tcp, on: .any)
        self.respond = respond
    }

    func start() async throws {
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, data: Data())
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    self?.listener.stateUpdateHandler = nil
                    continuation.resume()
                case .failed(let error):
                    self?.listener.stateUpdateHandler = nil
                    continuation.resume(throwing: error)
                default: break
                }
            }
            listener.start(queue: queue)
        }
    }

    func stop() { listener.cancel() }

    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] chunk, _, done, error in
            guard let self else { connection.cancel(); return }
            var buffer = data
            if let chunk { buffer.append(chunk) }
            let text = String(decoding: buffer, as: UTF8.self)
            if let headerEnd = text.range(of: "\r\n\r\n") {
                let headers = String(text[..<headerEnd.lowerBound])
                let length = headers.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }
                    .flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                if text[headerEnd.upperBound...].utf8.count >= length {
                    self.lock.withLock { self.received.append(text) }
                    let response = self.respond(text)
                    var headers = response.headers
                    if headers["Content-Type"] == nil { headers["Content-Type"] = "application/json" }
                    let fields = headers.map { "\($0.key): \($0.value)\r\n" }.joined()
                    let wire = "HTTP/1.1 \(response.status) Response\r\nContent-Length: \(response.body.utf8.count)\r\nConnection: close\r\n\(fields)\r\n\(response.body)"
                    connection.send(content: Data(wire.utf8), completion: .contentProcessed { _ in connection.cancel() })
                    return
                }
            }
            if done || error != nil { connection.cancel() }
            else { self.receive(connection, data: buffer) }
        }
    }
}
