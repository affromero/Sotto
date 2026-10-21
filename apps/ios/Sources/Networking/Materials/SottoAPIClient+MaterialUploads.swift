import Foundation

extension SottoAPIClient {
    func importResumableMaterials(courseId: String, urls: [URL], storeRoot: URL? = nil,
        pollInterval: Duration = .seconds(2)) async throws -> SottoCourseNotesResponse {
        try await NativeMaterialTransfers.shared.upload(client: self, courseId: courseId,
            urls: urls, storeRoot: storeRoot, pollInterval: pollInterval)
    }

    func cancelMaterialTransfer(courseId: String, storeRoot: URL? = nil) async throws {
        try await NativeMaterialTransfers.shared.cancel(client: self, courseId: courseId, storeRoot: storeRoot)
    }

    func materialRequest<Response: Decodable>(_ path: String, method: String = "GET", body: Data? = nil,
        partFile: URL? = nil, headers: [String: String] = [:]) async throws -> Response {
        guard let profileId, !profileId.isEmpty else { throw SottoAPIError.message("Select a learner before uploading originals.") }
        var request = try makeRequest(path: path, method: method, authorized: true, timeout: Self.generationTimeout)
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        request.setValue(profileId, forHTTPHeaderField: "x-sotto-expected-profile-id")
        request.httpBody = body
        if let partFile {
            let (data, response) = try await session.upload(for: request, fromFile: partFile,
                delegate: SottoAPIRedirectPolicy(serverURL: serverURL))
            return try decodeResponse(data, response: response, acceptedStatuses: [200, 201, 202])
        }
        return try await send(request, acceptedStatuses: [200, 201, 202])
    }
}
