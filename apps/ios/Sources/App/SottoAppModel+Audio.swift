import Foundation

extension SottoAppModel {
    func downloadLearningAudio(from reference: String) async throws -> URL {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before playing listening audio.")
        }
        let openingCredentials = credentials
        let file = try await client.downloadLearningAudio(from: reference)
        guard !Task.isCancelled, openingCredentials == credentials else {
            try? FileManager.default.removeItem(at: file)
            throw CancellationError()
        }
        return file
    }
}
