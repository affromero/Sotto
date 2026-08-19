import Foundation

extension SottoAppModel {
    func mintLiveToken(courseId: String, direction: String) async throws -> LiveTranslateSession.Token {
        guard let client = makeClient() else {
            throw SottoAPIError.message("Pair this device before starting a live session.")
        }
        return try await client.mintLiveToken(courseId: courseId, direction: direction)
    }

    func saveLiveSession(courseId: String, transcript: String) async throws {
        guard let client = makeClient() else { return }
        try await client.saveLiveSession(courseId: courseId, transcript: transcript)
    }
}
