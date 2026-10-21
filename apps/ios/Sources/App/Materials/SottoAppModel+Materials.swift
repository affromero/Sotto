import Foundation

extension SottoAppModel {
    func fetchCourseNotes(courseId: String, cursor: String? = nil) async throws -> SottoCourseNotesResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before loading course notes.") }
        let result = try await client.fetchCourseNotes(courseId: courseId, cursor: cursor)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return result
    }

    func saveCourseNotes(courseId: String, body: String) async throws -> SottoCourseNotesResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before saving course notes.") }
        let result = try await client.saveCourseNotes(courseId: courseId, body: body)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return result
    }
    func downloadCourseMaterial(_ material: SottoCourseMaterial) async throws -> URL {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before opening materials.") }
        let url = try await client.downloadCourseMaterial(material)
        guard isCurrentLearningClient(client) else {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            throw CancellationError()
        }
        return url
    }

    func importCourseMaterials(courseId: String, urls: [URL]) async throws -> SottoCourseNotesResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before uploading materials.") }
        let response = try await client.importCourseMaterials(courseId: courseId, urls: urls)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return response
    }

    func cancelMaterialTransfer(courseId: String) async throws {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before cancelling uploads.") }
        try await client.cancelMaterialTransfer(courseId: courseId)
        guard isCurrentLearningClient(client) else { throw CancellationError() }
    }
}
