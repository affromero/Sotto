import XCTest

@testable import Sotto

final class PlayHTTPScenario: @unchecked Sendable {
    private let lock = NSLock()
    private var responses: [String: [LocalHTTPServer.Response]] = [:]
    func set(_ path: String, _ replies: [LocalHTTPServer.Response]) {
        lock.withLock { responses[path] = replies }
    }
    func respond(_ request: String) -> LocalHTTPServer.Response {
        lock.withLock {
            let key = request.components(separatedBy: "\r\n").first?.components(separatedBy: " ").prefix(2).joined(separator: " ") ?? ""
            guard var candidates = responses[key], let reply = candidates.first else {
                return .init(status: 404, headers: [:], body: "{\"error\":\"Unknown fixture request\"}")
            }
            if candidates.count > 1 { candidates.removeFirst(); responses[key] = candidates }
            return reply
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
