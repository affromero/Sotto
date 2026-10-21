import Foundation

extension SottoAppModel {
    func savedSourceAnalyses(courseId: String, cursor: String?) async throws -> SottoSavedSourceAnalyses {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to open saved sources.") }
        let suffix = try sourceLibraryCursor(cursor, name: "after")
        let result: SottoSavedSourceAnalyses = try await client.get("/api/v1/courses/\(courseId)/material-analyses\(suffix)")
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        guard result.courseId == courseId, result.items.count <= 20 else { throw SottoAPIError.message("The saved sources belong to a different course.") }
        return result
    }

    func savedSourceFocuses(courseId: String, target: String, analysis: SottoSavedSourceAnalyses.Item,
        afterOrder: String?) async throws -> SottoSavedSourceFocuses {
        guard let client = makeClient(), UUID(uuidString: analysis.analysisId) != nil else { throw SottoAPIError.message("The saved analysis identity is invalid.") }
        let suffix = try sourceLibraryCursor(afterOrder, name: "afterOrder")
        let result: SottoSavedSourceFocuses = try await client.get("/api/v1/material-analyses/\(analysis.analysisId)\(suffix)")
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        guard result.analysisId == analysis.analysisId, result.analysisRevision == analysis.analysisRevision,
              result.resultDigest == analysis.resultDigest, result.courseId == courseId, result.target == target,
              result.focuses.count <= 50, !result.stale, ["COMPLETE", "PARTIAL"].contains(result.status) else {
            throw SottoAPIError.message("This source analysis is stale or unfinished. Refresh its current source receipt on the web app.")
        }
        return result
    }

    func savedSourceFocusDetail(analysis: SottoSavedSourceAnalyses.Item, focus: SottoSavedSourceFocuses.Focus) async throws -> SottoSavedSourceFocusDetail {
        guard let client = makeClient(), UUID(uuidString: analysis.analysisId) != nil,
              focus.id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw SottoAPIError.message("The saved source focus identity is invalid.") }
        let value: SottoSavedSourceFocusDetail = try await client.get("/api/v1/material-analyses/\(analysis.analysisId)/focuses/\(focus.id)")
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        guard value.analysisId == analysis.analysisId, value.analysisRevision == analysis.analysisRevision,
              value.resultDigest == analysis.resultDigest, value.focusDigest == focus.focusDigest,
              value.focus.exposureOnly else { throw SottoAPIError.message("The source focus receipt changed. Reload the saved analysis.") }
        return value
    }

    private func sourceLibraryCursor(_ cursor: String?, name: String) throws -> String {
        guard let cursor else { return "" }
        guard cursor.count <= 2000, let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else {
            throw SottoAPIError.message("The saved source cursor is invalid.")
        }
        return "?\(name)=\(encoded)"
    }
}
