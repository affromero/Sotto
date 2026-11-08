import Foundation

private struct SpeakingRecoveryRequest: Encodable {
    let recordingId: String
    let acknowledgePossibleCharges = true
}

private struct SpeakingRecoveryResponse: Decodable {
    let acknowledged: Bool
}

extension SottoAPIClient {
    func acknowledgeClassSpeakingRecovery(classId: String, promptId: String, recordingId: String) async throws {
        let result: SpeakingRecoveryResponse = try await post(
            "/api/v1/classes/\(classId)/speaking/\(promptId)/recovery",
            body: SpeakingRecoveryRequest(recordingId: recordingId)
        )
        guard result.acknowledged else { throw SottoAPIError.message("Recovery was not confirmed. Check the saved recording.") }
    }
}
