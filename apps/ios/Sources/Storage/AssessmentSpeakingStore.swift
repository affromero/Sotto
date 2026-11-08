import AVFoundation
import CryptoKit
import Foundation

struct RetainedAssessmentSpeaking: Codable, Equatable {
    let requestId: UUID
    let audio: Data
    let sha256: String
}

struct PendingAssessmentSpeaking: Equatable {
    let assessmentId: String
    let revision: String
    let promptId: String
    let recording: RetainedAssessmentSpeaking
}

struct PendingAssessmentCapture: Equatable {
    let assessmentId: String
    let revision: String
    let promptId: String
    let requestId: UUID
    let audioURL: URL?
    let hasRetained: Bool
}

/// Keep an exact request in a protected file scoped to its learner and assessment.
@MainActor
struct AssessmentSpeakingStore {
    private static let maxAudioBytes = 8 * 1024 * 1024
    private static var activeCaptures = Set<URL>()
    private struct Envelope: Codable {
        let version: Int
        let binding: [String]
        let recording: RetainedAssessmentSpeaking
    }
    private struct Capture: Codable {
        let binding: [String]
        let requestId: UUID
    }

    private let binding: [String]
    private let directory: URL
    private let file: URL
    private var captureFile: URL { file.deletingPathExtension().appendingPathExtension("capture") }
    private var audioFile: URL { file.deletingPathExtension().appendingPathExtension("wav") }

    init(client: SottoAPIClient, classId: String, classAttempt: Int, assessmentId: String,
         revision: String, promptId: String, directory: URL? = nil) throws {
        guard let profileId = client.profileId, !profileId.isEmpty, classAttempt > 0,
              !classId.isEmpty, !assessmentId.isEmpty, !promptId.isEmpty,
              revision.count == 64, revision.allSatisfy({ "0123456789abcdef".contains($0) }) else {
            throw SottoAPIError.message("The recording's learner or assessment could not be verified.")
        }
        let identity = [client.serverURL.absoluteString, profileId, classId, String(classAttempt), assessmentId, revision, promptId]
        binding = identity
        let key = try Self.key(identity)
        self.directory = try Self.classDirectory(client: client, classId: classId, classAttempt: classAttempt, root: directory)
        file = self.directory.appendingPathComponent(key + ".plist")
    }

    func load() throws -> RetainedAssessmentSpeaking? {
        do {
            _ = try FileManager.default.attributesOfItem(atPath: file.path)
        } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                    (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
            return nil
        }
        let envelope = try Self.read(file)
        guard envelope.binding == binding else {
            throw SottoAPIError.message("The saved recording could not be verified.")
        }
        return envelope.recording
    }

    static func pending(client: SottoAPIClient, classId: String, classAttempt: Int,
                        directory: URL? = nil) throws -> [PendingAssessmentSpeaking] {
        guard let profileId = client.profileId, !profileId.isEmpty, !classId.isEmpty, classAttempt > 0 else {
            throw SottoAPIError.message("The recording's learner or assessment could not be verified.")
        }
        let folder = try classDirectory(client: client, classId: classId, classAttempt: classAttempt, root: directory)
        let files: [URL]
        do {
            files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                    (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
            return []
        }
        var result: [PendingAssessmentSpeaking] = []
        for file in files where file.pathExtension == "plist" {
            let envelope = try read(file)
            let parts = envelope.binding
            guard parts[0] == client.serverURL.absoluteString, parts[1] == profileId else {
                throw SottoAPIError.message("A saved recording has an invalid learner identity.")
            }
            guard parts[2] == classId, parts[3] == String(classAttempt),
                  !parts[4].isEmpty, parts[5].count == 64,
                  parts[5].allSatisfy({ "0123456789abcdef".contains($0) }), !parts[6].isEmpty else {
                throw SottoAPIError.message("A saved recording has an invalid assessment identity.")
            }
            result.append(PendingAssessmentSpeaking(assessmentId: parts[4], revision: parts[5],
                                                    promptId: parts[6], recording: envelope.recording))
        }
        return result
    }

    static func hasCapture(client: SottoAPIClient, classId: String, classAttempt: Int,
                           directory: URL? = nil) throws -> Bool {
        let folder = try classDirectory(client: client, classId: classId, classAttempt: classAttempt, root: directory)
        do {
            return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                .contains { $0.pathExtension == "capture" || $0.pathExtension == "wav" }
        } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                    (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
            return false
        }
    }

    static func pendingCaptures(client: SottoAPIClient, classId: String, classAttempt: Int,
                                directory: URL? = nil) throws -> [PendingAssessmentCapture] {
        guard let profileId = client.profileId, !profileId.isEmpty, !classId.isEmpty, classAttempt > 0 else {
            throw SottoAPIError.message("The recording's learner or assessment could not be verified.")
        }
        let folder = try classDirectory(client: client, classId: classId, classAttempt: classAttempt, root: directory)
        let files: [URL]
        do {
            files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                    (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
            return []
        }
        let captures = files.filter { $0.pathExtension == "capture" }
        for wav in files where wav.pathExtension == "wav" {
            guard captures.contains(wav.deletingPathExtension().appendingPathExtension("capture")) else {
                throw SottoAPIError.message("A saved recording has no recovery information.")
            }
        }
        return try captures.map { file in
            let size = try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber
            guard let size, size.int64Value <= 65_536 else {
                throw SottoAPIError.message("A saved recording could not be verified.")
            }
            let capture = try PropertyListDecoder().decode(Capture.self, from: Data(contentsOf: file))
            let parts = capture.binding
            guard parts.count == 7, parts[0] == client.serverURL.absoluteString, parts[1] == profileId,
                  parts[2] == classId, parts[3] == String(classAttempt), !parts[4].isEmpty,
                  parts[5].count == 64, parts[5].allSatisfy({ "0123456789abcdef".contains($0) }),
                  !parts[6].isEmpty, file.lastPathComponent == (try key(parts)) + ".capture" else {
                throw SottoAPIError.message("A saved recording could not be verified.")
            }
            let audio = file.deletingPathExtension().appendingPathExtension("wav")
            let retained = file.deletingPathExtension().appendingPathExtension("plist")
            return PendingAssessmentCapture(assessmentId: parts[4], revision: parts[5], promptId: parts[6], requestId: capture.requestId,
                                            audioURL: try exists(audio) ? audio : nil, hasRetained: try exists(retained))
        }
    }

    func discardUnsentCapture(requestId: UUID) throws {
        guard !Self.activeCaptures.contains(audioFile) else {
            throw SottoAPIError.message("Stop recording before discarding it.")
        }
        guard try load() == nil, try Self.exists(captureFile) else {
            throw SottoAPIError.message("The recording needs recovery before it can be removed.")
        }
        let capture = try PropertyListDecoder().decode(Capture.self, from: Data(contentsOf: captureFile))
        guard capture.binding == binding, capture.requestId == requestId else {
            throw SottoAPIError.message("The saved recording could not be verified.")
        }
        if try Self.exists(audioFile) {
            try FileManager.default.removeItem(at: audioFile)
        }
        try FileManager.default.removeItem(at: captureFile)
    }

    func retain(audio: Data) throws -> RetainedAssessmentSpeaking {
        try retain(audio: audio, requestId: UUID())
    }

    private func retain(audio: Data, requestId: UUID) throws -> RetainedAssessmentSpeaking {
        guard try load() == nil else {
            throw SottoAPIError.message("A saved recording needs recovery before another can be sent.")
        }
        guard !audio.isEmpty, audio.count <= Self.maxAudioBytes else {
            throw SottoAPIError.message("The recording is empty or too large.")
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var protectedDirectory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try protectedDirectory.setResourceValues(values)
        let saved = RetainedAssessmentSpeaking(requestId: requestId, audio: audio, sha256: Self.digest(audio))
        let encoder = PropertyListEncoder()
        encoder.outputFormat = .binary
        try encoder.encode(Envelope(version: 1, binding: binding, recording: saved))
            .write(to: file, options: [.atomic, .completeFileProtection])
        return saved
    }

    /// Reserve the identity before the recorder writes any learner audio.
    func beginCapture() throws -> URL {
        guard try load() == nil, try !Self.exists(captureFile), try !Self.exists(audioFile) else {
            throw SottoAPIError.message("A saved recording needs recovery before recording again.")
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var protectedDirectory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try protectedDirectory.setResourceValues(values)
        let capture = Capture(binding: binding, requestId: UUID())
        try PropertyListEncoder().encode(capture).write(to: captureFile, options: [.withoutOverwriting, .completeFileProtection])
        try Data().write(to: audioFile, options: [.withoutOverwriting, .completeFileProtection])
        Self.activeCaptures.insert(audioFile)
        return audioFile
    }

    func endCapture() {
        Self.activeCaptures.remove(audioFile)
    }

    func recoverCapture() throws -> URL? {
        guard try Self.exists(captureFile) else {
            guard try !Self.exists(audioFile) else {
                throw SottoAPIError.message("The saved recording could not be verified.")
            }
            return nil
        }
        let capture = try PropertyListDecoder().decode(Capture.self, from: Data(contentsOf: captureFile))
        guard capture.binding == binding, try Self.exists(audioFile) else {
            throw SottoAPIError.message("The saved recording could not be verified.")
        }
        return audioFile
    }

    func finishCapture() throws -> RetainedAssessmentSpeaking {
        guard !Self.activeCaptures.contains(audioFile) else {
            throw SottoAPIError.message("Stop recording before saving it.")
        }
        guard let url = try recoverCapture() else {
            throw SottoAPIError.message("No saved recording was found.")
        }
        let capture = try PropertyListDecoder().decode(Capture.self, from: Data(contentsOf: captureFile))
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.int64Value > 0,
              size.int64Value <= Int64(Self.maxAudioBytes) else {
            throw SottoAPIError.message("The recording is empty or too large.")
        }
        let recorded = try AVAudioFile(forReading: url)
        guard recorded.length > 0, recorded.fileFormat.sampleRate == 16_000,
              recorded.fileFormat.channelCount == 1 else {
            throw SottoAPIError.message("The saved recording is empty or invalid.")
        }
        let audio = try Data(contentsOf: url)
        let saved: RetainedAssessmentSpeaking
        if let existing = try load() {
            guard existing.requestId == capture.requestId, existing.audio == audio else {
                throw SottoAPIError.message("The saved recording could not be verified.")
            }
            saved = existing
        } else {
            saved = try retain(audio: audio, requestId: capture.requestId)
        }
        return saved
    }

    func clearConfirmed(_ saved: RetainedAssessmentSpeaking, status: SottoClassAssessmentSpeakingStatus) throws {
        try status.validate()
        guard status.status == .completed,
              status.requestId?.lowercased() == saved.requestId.uuidString.lowercased(),
              try load() == saved else {
            throw SottoAPIError.message("The saved recording does not match the completed response.")
        }
        try removeCapture(for: saved)
        try FileManager.default.removeItem(at: file)
    }

    func discardConfirmedFailure(_ saved: RetainedAssessmentSpeaking, status: SottoClassAssessmentSpeakingStatus) throws {
        try status.validate()
        guard status.status == .failed,
              status.requestId?.lowercased() == saved.requestId.uuidString.lowercased(),
              try load() == saved else {
            throw SottoAPIError.message("The saved recording does not match the confirmed failure.")
        }
        try removeCapture(for: saved)
        try FileManager.default.removeItem(at: file)
    }

    func discardSuperseded(_ saved: RetainedAssessmentSpeaking, status: SottoClassAssessmentSpeakingStatus) throws {
        try status.validate()
        guard status.status == .completed, let requestId = status.requestId,
              requestId.lowercased() != saved.requestId.uuidString.lowercased(), try load() == saved else {
            throw SottoAPIError.message("The replacement speaking response could not be verified.")
        }
        try removeCapture(for: saved)
        try FileManager.default.removeItem(at: file)
    }

    private func removeCapture(for saved: RetainedAssessmentSpeaking) throws {
        if try Self.exists(captureFile) {
            let capture = try PropertyListDecoder().decode(Capture.self, from: Data(contentsOf: captureFile))
            guard capture.binding == binding, capture.requestId == saved.requestId else {
                throw SottoAPIError.message("The saved recording could not be verified.")
            }
        }
        if try Self.exists(audioFile) {
            let attributes = try FileManager.default.attributesOfItem(atPath: audioFile.path)
            guard let size = attributes[.size] as? NSNumber, size.intValue == saved.audio.count,
                  try Data(contentsOf: audioFile) == saved.audio else {
                throw SottoAPIError.message("The saved recording could not be verified.")
            }
            try FileManager.default.removeItem(at: audioFile)
        }
        if try Self.exists(captureFile) {
            try FileManager.default.removeItem(at: captureFile)
        }
    }

    private static func digest(_ audio: Data) -> String {
        SHA256.hash(data: audio).map { String(format: "%02x", $0) }.joined()
    }

    private static func exists(_ url: URL) throws -> Bool {
        do {
            _ = try FileManager.default.attributesOfItem(atPath: url.path)
            return true
        } catch let error as NSError where error.domain == NSCocoaErrorDomain &&
                    (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError) {
            return false
        }
    }

    private static func key(_ values: [String]) throws -> String {
        SHA256.hash(data: try JSONEncoder().encode(values)).map { String(format: "%02x", $0) }.joined()
    }

    private static func ownerDirectory(client: SottoAPIClient, root: URL?) throws -> URL {
        guard let profileId = client.profileId, !profileId.isEmpty else {
            throw SottoAPIError.message("The recording's learner could not be verified.")
        }
        let base = try root ?? FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("assessment-speaking", isDirectory: true)
        return try base.appendingPathComponent(key([client.serverURL.absoluteString, profileId]), isDirectory: true)
    }

    private static func classDirectory(client: SottoAPIClient, classId: String, classAttempt: Int, root: URL?) throws -> URL {
        let owner = try ownerDirectory(client: client, root: root)
        return try owner.appendingPathComponent(key([classId, String(classAttempt)]), isDirectory: true)
    }

    private static func read(_ file: URL) throws -> Envelope {
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard let size = attributes[.size] as? NSNumber, size.int64Value <= Int64(maxAudioBytes + 1024 * 1024) else {
            throw SottoAPIError.message("The saved recording is too large to verify.")
        }
        let envelope = try PropertyListDecoder().decode(Envelope.self, from: Data(contentsOf: file))
        guard envelope.version == 1, envelope.binding.count == 7,
              file.lastPathComponent == (try key(envelope.binding)) + ".plist",
              !envelope.recording.audio.isEmpty, envelope.recording.audio.count <= maxAudioBytes,
              digest(envelope.recording.audio) == envelope.recording.sha256 else {
            throw SottoAPIError.message("The saved recording could not be verified.")
        }
        return envelope
    }
}
