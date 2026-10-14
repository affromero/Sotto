import Foundation
import PencilKit

struct PencilReviewStore {
    struct Review: Codable {
        var inkDigest: String
        var requestId: UUID
        var image: String? = nil
        var acceptedText: String?
        var acceptedIndex: Int?
        var accepted = false
    }
    let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Sotto/PencilReviews", isDirectory: true)
    }

    func load(key: String) throws -> Review? {
        let url = fileURL(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(Review.self, from: Data(contentsOf: url))
    }

    func save(_ review: Review, key: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(review).write(to: fileURL(key), options: [.atomic, .completeFileProtection])
    }

    func requiresReview(drawing: PKDrawing, key: String, confirmedAnswer: PencilAnswer?) throws -> Bool {
        guard !drawing.strokes.isEmpty else { return false }
        guard let review = try load(key: key), review.accepted,
              review.inkDigest == LearningInkStore.drawingDigest(drawing) else { return true }
        switch confirmedAnswer {
        case .choice(let index): return review.acceptedIndex != index
        case .writing(let text): return review.acceptedText != text
        case nil: return true
        }
    }

    private func fileURL(_ key: String) -> URL {
        directory.appendingPathComponent(LearningInkStore.digest(Data(key.utf8)) + ".json")
    }
}
