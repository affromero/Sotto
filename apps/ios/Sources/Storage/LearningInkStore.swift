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

    static func drawingDigest(_ drawing: PKDrawing) -> String {
        var bytes = Data("pencil-strokes-v1".utf8)
        func appendInteger(_ value: UInt32) {
            var encoded = value.littleEndian
            withUnsafeBytes(of: &encoded) { bytes.append(contentsOf: $0) }
        }
        func appendNumber(_ value: CGFloat) { appendInteger(Float(value).bitPattern) }
        appendInteger(UInt32(drawing.strokes.count))
        for stroke in drawing.strokes {
            let name = Data(stroke.ink.inkType.rawValue.utf8)
            appendInteger(UInt32(name.count))
            bytes.append(name)
            appendInteger(stroke.randomSeed)
            let color = stroke.ink.color.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
            var red: CGFloat = 0
            var green: CGFloat = 0
            var blue: CGFloat = 0
            var alpha: CGFloat = 0
            if color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) {
                for component in [red, green, blue, alpha] { appendNumber(component) }
            } else {
                for component in color.cgColor.components ?? [] { appendNumber(component) }
            }
            let transform = stroke.transform
            for value in [transform.a, transform.b, transform.c, transform.d, transform.tx, transform.ty] { appendNumber(value) }
            appendInteger(UInt32(stroke.path.count))
            for point in stroke.path {
                for value in [point.location.x, point.location.y, point.size.width, point.size.height,
                              point.opacity, point.force, point.azimuth, point.altitude, CGFloat(point.timeOffset)] { appendNumber(value) }
            }
            appendInteger(stroke.mask == nil ? 0 : 1)
            stroke.mask?.cgPath.applyWithBlock { element in
                appendInteger(UInt32(bitPattern: element.pointee.type.rawValue))
                let count: Int
                switch element.pointee.type {
                case .moveToPoint, .addLineToPoint: count = 1
                case .addQuadCurveToPoint: count = 2
                case .addCurveToPoint: count = 3
                case .closeSubpath: count = 0
                @unknown default: count = 0
                }
                for index in 0..<count {
                    appendNumber(element.pointee.points[index].x)
                    appendNumber(element.pointee.points[index].y)
                }
            }
        }
        return digest(bytes)
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
