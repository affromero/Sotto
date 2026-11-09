import Foundation

extension SottoAPIClient {
    func fetchActivity() async throws -> SottoActivity {
        try await get("/api/v1/learn/activity")
    }

    func fetchMemoryGraph(courseId: String) async throws -> SottoMemoryGraph {
        try await get("/api/v1/courses/\(courseId)/graph")
    }
}
