import Foundation

extension SottoAPIClient {
    func play<Response: Decodable>(
        _ path: String, body: Data? = nil, proof: String? = nil,
        authorized: Bool = true
    ) async throws -> Response {
        guard path.hasPrefix("/api/v1/play/"),
              let origin = PlayInvitation.origin(serverURL),
              let destination = URL(string: path, relativeTo: origin)?.absoluteURL,
              WorkbookDownloadRedirectPolicy.sameOrigin(origin, destination),
              destination.user == nil, destination.password == nil,
              destination.fragment == nil else {
            throw SottoAPIError.message("Invalid game server or endpoint.")
        }
        var request = try makeRequest(path: path, method: body == nil ? "GET" : "POST", authorized: authorized)
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue(nil, forHTTPHeaderField: "Origin")
        request.setValue(nil, forHTTPHeaderField: "Cookie")
        request.setValue(proof, forHTTPHeaderField: "X-Sotto-Play-Proof")
        if authorized { request.setValue(profileId, forHTTPHeaderField: "X-Sotto-Play-Profile") }
        request.httpBody = body
        return try await send(request, acceptedStatuses: [200, 201], policy: .play)
    }

    static func playID(_ value: String) throws -> String {
        guard !value.isEmpty, value.count <= 100 else { throw SottoAPIError.message("Invalid game identifier.") }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard value.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            throw SottoAPIError.message("Invalid game identifier.")
        }
        return value
    }

    func playRoom(_ id: String) async throws -> PlayRoom {
        try await play("/api/v1/play/rooms/\(Self.playID(id))")
    }

    func playPreview(_ code: String) async throws -> PlayInvitationPreview {
        guard let code = PlayInvitation.normalizedCode(code) else { throw SottoAPIError.message("Invalid game code.") }
        return try await play("/api/v1/play/invitations?code=\(code)", authorized: false)
    }

    func playStatus(_ id: UUID, proof: String) async throws -> PlayJoinStatusView {
        try await play("/api/v1/play/join-requests/\(id.uuidString)", proof: proof, authorized: false)
    }

    func playPresence(_ roomID: String, nonce: String, release: Bool) async throws -> PlayPresence {
        struct Body: Encodable { let type: String; let viewNonce: String }
        return try await play("/api/v1/play/rooms/\(Self.playID(roomID))/presence",
            body: JSONEncoder().encode(Body(type: release ? "RELEASE" : "RENEW", viewNonce: nonce)))
    }
}
