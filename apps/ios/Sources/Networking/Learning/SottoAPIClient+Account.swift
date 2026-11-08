import Foundation

extension SottoAPIClient {
    // MARK: - Account settings

    func fetchAccount() async throws -> SottoAccount {
        try await get("/api/v1/users/me")
    }

    /// The route's schema is strict, so only changed fields may be sent; nil
    /// properties are omitted by Swift's synthesized encoder.
    func updateAccount(_ update: SottoAccountUpdate) async throws -> SottoAccount {
        try await patch("/api/v1/users/me", body: update)
    }

    func uploadAvatar(imageData: Data, fileName: String, contentType: String) async throws -> SottoAvatarUploadResponse {
        var request = try makeRequest(path: "/api/v1/users/me/avatar", method: "POST", authorized: true)
        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = multipartBody(
            data: imageData,
            boundary: boundary,
            fieldName: "avatar",
            fileName: fileName,
            contentType: contentType
        )
        return try await send(request, acceptedStatuses: [200, 201])
    }

    func fetchAiModels() async throws -> SottoAiModelList {
        try await get("/api/v1/ai-models")
    }
}
