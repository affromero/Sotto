import Foundation

extension SottoAppModel {
    func legacyMaterialText(id: String, offset: Int) async throws -> SottoLegacyMaterialText {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to read retained legacy text.") }
        let value = try await client.fetchLegacyMaterialText(materialId: id, offset: offset)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return value
    }
    func materialProcessing(id: String, afterPage: Int) async throws -> SottoMaterialProcessing {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to inspect material sources.") }
        let value = try await client.fetchMaterialProcessing(materialId: id, afterPage: afterPage)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return value
    }

    func materialPageText(id: String, runId: String, page: Int, origin: String, afterIndex: Int) async throws -> SottoMaterialPageText {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to read material sources.") }
        let value = try await client.fetchMaterialPageText(materialId: id, runId: runId, page: page, origin: origin, afterIndex: afterIndex)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return value
    }
}
