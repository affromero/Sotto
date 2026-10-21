import XCTest

@testable import Sotto

final class PlayHTTPScenario: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [String: [LocalHTTPServer.Response]] = [:]
    private var handlers: [String: @Sendable (String) -> LocalHTTPServer.Response] = [:]
    func set(_ path: String, _ replies: [LocalHTTPServer.Response]) {
        lock.withLock { responses[path] = replies }
    }
    func handle(_ path: String, _ response: @escaping @Sendable (String) -> LocalHTTPServer.Response) {
        lock.withLock { handlers[path] = response }
    }
    func respond(_ request: String) -> LocalHTTPServer.Response {
        lock.withLock {
            let key = request.components(separatedBy: "\r\n").first?.components(separatedBy: " ").prefix(2).joined(separator: " ") ?? ""
            guard var candidates = responses[key], let reply = candidates.first else {
                if let handler = handlers[key] { return handler(request) }
                return safetyResponse(key, request: request)
            }
            if candidates.count > 1 { candidates.removeFirst(); responses[key] = candidates }
            return reply
        }
    }

    private func safetyResponse(_ key: String, request: String) -> LocalHTTPServer.Response {
        guard ["GET /api/v1/play/policy", "GET /api/v1/play/safety", "GET /api/v1/play/safety/blocks",
               "GET /api/v1/play/safety/reports"].contains(key) else {
            return .init(status: 404, headers: [:], body: "{\"error\":\"Unknown fixture request\"}")
        }
        do {
            let fixture = try PlaySafetyFixtures.load()
            switch key {
            case "GET /api/v1/play/policy": return try .json(fixture.policy)
            case "GET /api/v1/play/safety":
                guard let profile = playRequestHeader("X-Sotto-Play-Profile", in: request) else { return .denied(401) }
                return try .json(fixture.status(profile: profile))
            case "GET /api/v1/play/safety/blocks": return .json("{\"blocks\":[],\"nextCursor\":null}")
            default: return .json("{\"reports\":[],\"nextCursor\":null}")
            }
        } catch {
            return .init(status: 500, headers: [:], body: "{\"error\":\"The bundled safety fixture could not be decoded\"}")
        }
    }
}

extension LocalHTTPServer.Response {
    static func json<Value: Encodable>(_ value: Value, delay: TimeInterval = 0) throws -> LocalHTTPServer.Response {
        var response = LocalHTTPServer.Response.json(String(decoding: try JSONEncoder().encode(value), as: UTF8.self))
        response.delay = delay
        return response
    }
    static func denied(_ status: Int = 403) -> LocalHTTPServer.Response {
        .init(status: status, headers: [:], body: "{\"error\":\"Access refused\"}")
    }
}

@MainActor
func waitForPlay(_ description: String, until predicate: () -> Bool) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(5))
    while !predicate(), ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(10)) }
    XCTAssertTrue(predicate(), description)
}
