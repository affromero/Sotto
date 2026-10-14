import Foundation

extension SottoAppModel {
    func downloadCourseMaterial(_ material: SottoCourseMaterial) async throws -> URL {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before opening materials.") }
        return try await client.downloadCourseMaterial(material)
    }

    func importCourseMaterials(courseId: String, urls: [URL]) async throws -> SottoCourseNotesResponse {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device before uploading materials.") }
        return try await client.importCourseMaterials(courseId: courseId, urls: urls)
    }
}
