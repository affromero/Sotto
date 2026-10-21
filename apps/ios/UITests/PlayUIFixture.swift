import Foundation
import XCTest

final class PlayUIFixture: @unchecked Sendable {
    private let lock = NSLock()
    private let rounds: [String: [String: Any]]
    private let template: [String: Any]
    private var stage = "initial-0-GUEST"
    private var revision = 4
    private var ack = false
    private var requestID = ""
    private var actions: [String] = []
    var acknowledged: Bool { lock.withLock { ack } }
    var diagnostics: String {
        lock.withLock {
            "Stage: \(stage), revision: \(revision)\nActions:\n" + actions.joined(separator: "\n")
        }
    }

    init() throws {
        let url = try XCTUnwrap(Bundle(for: PlayInvitationUITests.self).url(forResource: "contract", withExtension: "json"))
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let entries = try XCTUnwrap(fixture["rounds"] as? [[String: Any]])
        rounds = Dictionary(uniqueKeysWithValues: entries.compactMap {
            guard let name = $0["name"] as? String, let round = $0["round"] as? [String: Any] else { return nil }
            return (name, round)
        })
        let rooms = try XCTUnwrap(fixture["rooms"] as? [[String: Any]])
        template = try XCTUnwrap(rooms.first(where: { $0["name"] as? String == "playing-GUEST" })?["room"] as? [String: Any])
    }

    func respond(_ request: String) -> LocalHTTPServer.Response {
        lock.withLock {
            let path = String(request.split(separator: " ").dropFirst().first ?? "")
            let post = request.hasPrefix("POST ")
            let payload = request.components(separatedBy: "\r\n\r\n").last.flatMap { $0.data(using: .utf8) }
                .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            if path.hasPrefix("/api/v1/play/invitations") {
                if post { requestID = payload["requestId"] as? String ?? ""; return json(status()) }
                return json(["roomId": "fixture-room", "hostName": "Alex", "kind": "MIXED", "theme": "EVERYDAY",
                    "questionStyle": "CHOICES", "hostWaiting": true, "expiresAt": instant, "serverTime": instant])
            }
            if path.hasSuffix("/claim") {
                return json(["kind": "NATIVE", "deliveryId": "fixture-delivery", "roomId": "fixture-room",
                    "profile": template["guest"]!, "token": "fixture-native-member-device-credential", "expiresAt": instant])
            }
            if path.hasSuffix("/ack") { ack = true; return json(["acknowledged": true]) }
            if path.hasPrefix("/api/v1/play/join-requests/") { return json(status()) }
            if path == "/api/v1/profiles" {
                return json(["profiles": [["id": "guest-profile", "name": "Sam", "avatarUrl": "", "isOwner": false, "role": "USER"]]])
            }
            if path.hasSuffix("/actions"), post {
                let type = payload["type"] as? String
                let command = payload["command"] as? [String: Any]
                let expected = payload["expectedRevision"] as? Int
                actions.append("\(command?["type"] as? String ?? type ?? "unknown"): expected=\(expected.map(String.init) ?? "missing"), current=\(revision), stage=\(stage)")
                revision += 1
                switch command?["type"] as? String {
                case "CHOOSE": stage = "finished-0-GUEST"
                case "GUESS": stage = "guessed-2-GUEST"
                case "MESSAGE": stage = stage == "message-1-4-GUEST" ? "message-3-4-GUEST" : "one-outcome-4-GUEST"
                case "MISSION_DONE": stage = "both-outcomes-4-GUEST"
                case "FEEDBACK": stage = stage == "guessed-2-GUEST" ? "finished-2-GUEST" : "finished-4-GUEST"
                default:
                    if type == "NEXT_ROUND" { stage = stage == "finished-0-GUEST" ? "clue-2-GUEST" : "message-1-4-GUEST" }
                }
                return json(room())
            }
            if path == "/api/v1/play/rooms/fixture-room" { return json(room()) }
            if path.hasPrefix("/api/v1/play/phrases") { return json(["phrases": [], "nextCursor": NSNull()]) }
            return .init(status: 404, headers: [:], body: "{\"error\":\"Unknown fixture endpoint\"}")
        }
    }
    private let instant = "2026-10-20T12:00:00.000Z"
    private func status() -> [String: Any] {
        ["requestId": requestID, "status": "ACCEPTED", "expiresAt": instant, "serverTime": instant]
    }
    private func room() -> [String: Any] {
        var room = template
        room["revision"] = revision
        room["round"] = rounds[stage]
        room["allowedActions"] = stage.hasPrefix("finished") ? ["NEXT_ROUND", "LEAVE"] : ["LEAVE"]
        return room
    }
    private func json(_ value: [String: Any]) -> LocalHTTPServer.Response {
        do { return .json(String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)) }
        catch { return .init(status: 500, headers: [:], body: "{\"error\":\"Invalid fixture\"}") }
    }
}
