import XCTest

@testable import Sotto

final class SettingsTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    func testAccountDecodesAndReportsAdmin() throws {
        let account = try decode(
            """
            {
              "id": "u1", "name": "Andres", "email": null, "image": "/avatars/fox.png",
              "role": "ADMIN", "episodeCount": 0, "createdAt": "2026-01-01T00:00:00.000Z",
              "voicePreferences": [], "preferredLanguage": "en",
              "preferredAiModel": "claude-opus-5", "preferredTtsModel": null,
              "preferredSttModel": null, "showAgentUsageStatus": true
            }
            """,
            as: SottoAccount.self
        )

        XCTAssertTrue(account.isAdmin)
        XCTAssertEqual(account.preferredAiModel, "claude-opus-5")
    }

    func testNonAdminAccountIsNotAdmin() throws {
        let account = try decode(
            """
            { "id": "u2", "name": null, "email": null, "image": null, "role": "USER",
              "preferredLanguage": null, "preferredAiModel": null,
              "preferredTtsModel": null, "preferredSttModel": null,
              "showAgentUsageStatus": null }
            """,
            as: SottoAccount.self
        )

        XCTAssertFalse(account.isAdmin)
    }

    /// users/me PATCH uses a strict schema: an unknown or null-but-not-nullable
    /// field is a 400. Swift omits nil optionals, so an update must carry only
    /// the fields that actually changed.
    func testUpdateOmitsUntouchedFields() throws {
        let update = SottoAccountUpdate(name: "Andres")

        let encoded = try JSONEncoder().encode(update)
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )

        XCTAssertEqual(object.keys.sorted(), ["name"])
    }

    func testEmptyUpdateEncodesToNothing() throws {
        let encoded = try JSONEncoder().encode(SottoAccountUpdate())
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )

        XCTAssertTrue(object.isEmpty)
    }

    func testHealthWithoutChecksIsStillReadable() throws {
        let health = try decode(#"{ "status": "healthy" }"#, as: SottoHealth.self)

        XCTAssertTrue(health.isHealthy)
        XCTAssertNil(health.checks)
    }

    func testQueueSnapshotSumsBacklogAndFailures() throws {
        let snapshot = try decode(
            """
            {
              "queues": {
                "episode": { "waiting": 2, "active": 1, "completed": 40, "failed": 3, "delayed": 0 },
                "audio":   { "waiting": 0, "active": 4, "completed": 12, "failed": 0, "delayed": 1 }
              }
            }
            """,
            as: SottoQueueSnapshot.self
        )

        XCTAssertEqual(snapshot.backlog, 7)
        XCTAssertEqual(snapshot.failed, 3)
    }

    func testRevokedKeyIsMarked() throws {
        let keys = try decode(
            """
            [
              { "id": "k1", "name": "iPad", "keyPrefix": "sk_sotto_a...",
                "lastUsedAt": null, "createdAt": null, "revokedAt": null },
              { "id": "k2", "name": "old laptop", "keyPrefix": "sk_sotto_b...",
                "lastUsedAt": null, "createdAt": null, "revokedAt": "2026-08-01T00:00:00.000Z" }
            ]
            """,
            as: [SottoApiKeySummary].self
        )

        XCTAssertFalse(keys[0].isRevoked)
        XCTAssertTrue(keys[1].isRevoked)
    }
}
