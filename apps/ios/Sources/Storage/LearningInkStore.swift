import CryptoKit
import Foundation
import PencilKit

/// Device-local ink, isolated by server, learner, and learning activity.
struct LearningInkStore {
    private struct SavedDrawing: Codable {
        let version: Int
        let drawing: Data
        let checksum: String
    }

    enum StorageError: LocalizedError {
        case invalidDrawing
        var errorDescription: String? { "The saved handwriting file failed its integrity check." }
    }
    let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(
            for: .applicationSupportDirectory, in: .userDomainMask
        )[0].appendingPathComponent("Sotto/LearningInk", isDirectory: true)
    }

    static func scope(server: URL, profileID: String, activity: String) -> String {
        digest(Data("\(server.absoluteString)\n\(profileID)\n\(activity)".utf8))
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func load(_ key: String) throws -> PKDrawing {
        let url = fileURL(key)
        guard FileManager.default.fileExists(atPath: url.path) else { return PKDrawing() }
        let saved = try JSONDecoder().decode(SavedDrawing.self, from: Data(contentsOf: url))
        guard saved.version == 1, saved.checksum == Self.digest(saved.drawing) else {
            throw StorageError.invalidDrawing
        }
        return try PKDrawing(data: saved.drawing)
    }

    func save(_ drawing: PKDrawing, key: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let bytes = drawing.dataRepresentation()
        let saved = SavedDrawing(version: 1, drawing: bytes, checksum: Self.digest(bytes))
        try JSONEncoder().encode(saved).write(to: fileURL(key), options: [.atomic, .completeFileProtection])
    }

    private func fileURL(_ key: String) -> URL {
        directory.appendingPathComponent(Self.digest(Data(key.utf8)) + ".drawing")
    }
}
