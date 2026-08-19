import Foundation

/// Account settings. Kept apart from the assessment calls because this is the
/// one place the app writes learner preferences rather than learning data, and
/// because the admin screens gate on the role this loads.
extension SottoAppModel {
    // MARK: - Server admin (read-only)

    func fetchHealth() async throws -> SottoHealth {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening admin.")
        }
        return try await client.fetchHealth()
    }

    func fetchQueues() async throws -> SottoQueueSnapshot {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening admin.")
        }
        return try await client.fetchQueues()
    }

    func fetchModelPricing() async throws -> [SottoModelPrice] {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening admin.")
        }
        return try await client.fetchModelPricing()
    }

    func fetchApiKeys() async throws -> [SottoApiKeySummary] {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening admin.")
        }
        return try await client.fetchApiKeys()
    }

    func revokeApiKey(id: String) async throws {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before revoking a key.")
        }
        try await client.revokeApiKey(id: id)
    }

    func fetchAccount() async throws -> SottoAccount {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before opening settings.")
        }
        return try await client.fetchAccount()
    }

    func updateAccount(_ update: SottoAccountUpdate) async throws -> SottoAccount {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before changing settings.")
        }
        return try await client.updateAccount(update)
    }

    func fetchAiModels() async throws -> SottoAiModelList {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before choosing a model.")
        }
        return try await client.fetchAiModels()
    }

    func uploadAvatar(
        imageData: Data,
        fileName: String,
        contentType: String
    ) async throws -> String? {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before changing your avatar.")
        }
        let response = try await client.uploadAvatar(
            imageData: imageData,
            fileName: fileName,
            contentType: contentType
        )
        return response.resolvedImage
    }
}
