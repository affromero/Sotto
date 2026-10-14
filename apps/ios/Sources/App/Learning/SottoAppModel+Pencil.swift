import Foundation

extension SottoAppModel {
    func openWorkbook(for classId: String, pencil: Bool) async {
        if !pencil { await openWorkbookPDF(for: classId); return }
        await openClass(classId)
        if selectedClass?.id == classId { pencilWorkbook = true }
    }

    func openWorkbookPDF(for classId: String) async {
        guard let client = makeClient() else { return }
        isLoading = true
        errorMessage = nil
        do { workbook = try await client.fetchWorksheet(classId: classId) }
        catch { report(error) }
        isLoading = false
    }

    func interpretPencilAnswer(classId: String, answer: SottoPencilRequest) async throws -> SottoPencilProposal {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before reviewing homework.") }
        let openingCredentials = credentials
        let admitted = try await client.requestPencilInterpretation(classId: classId, answer: answer)
        guard admitted.operationId == answer.requestId else {
            throw SottoAPIError.message("The server returned a different homework interpretation.")
        }
        for _ in 0..<300 {
            try Task.checkCancellation()
            let result = try await client.pollPencilInterpretation(classId: classId, operationId: admitted.operationId)
            guard credentials == openingCredentials, selectedClass?.id == classId,
                  (selectedClass?.attempt ?? 1) == answer.attempt, result.operationId == admitted.operationId else {
                throw SottoAPIError.message("The learner or class changed. Reopen the workbook.")
            }
            if result.status == "READY", let proposal = result.proposal { return proposal }
            if result.status == "FAILED" {
                throw SottoAPIError.message(result.error ?? "Your handwriting could not be interpreted. Your ink is saved.")
            }
            guard result.status == "PENDING" else {
                throw SottoAPIError.message("The server returned an unreadable homework result.")
            }
            try await Task.sleep(for: .seconds(2))
        }
        throw SottoAPIError.message("The interpretation is still pending. Your ink is saved. Tap Read my marks to check this same attempt again.")
    }
}
