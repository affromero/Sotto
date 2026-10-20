import Foundation
import CryptoKit
import UniformTypeIdentifiers

actor NativeMaterialTransfers {
    static let shared = NativeMaterialTransfers()
    private var active = Set<String>()

    func upload(client: SottoAPIClient, courseId: String, urls: [URL], storeRoot: URL?, pollInterval: Duration) async throws -> SottoCourseNotesResponse {
        let scope = try transferScope(client: client, courseId: courseId, storeRoot: storeRoot)
        guard active.insert(scope.path).inserted else {
            throw SottoAPIError.message("This upload is already running. Wait or stop waiting before resuming.")
        }
        defer { active.remove(scope.path) }
        var checkpoint = try load(scope: scope, client: client, courseId: courseId)
        if checkpoint == nil {
            guard !urls.isEmpty else { throw SottoAPIError.message("There is no saved upload for this learner and course.") }
            checkpoint = try prepare(urls: urls, client: client, courseId: courseId, scope: scope)
        } else if !urls.isEmpty {
            try verifyReselection(urls, request: checkpoint!.request)
        }
        guard var state = checkpoint else { throw SottoAPIError.message("The saved upload could not be read.") }
        try verifyStaged(state, scope: scope)
        // Only an explicit import or resume opens another bounded wait. Server expiry remains authoritative.
        state.deadline = Date().addingTimeInterval(7200)
        try save(state, scope: scope)
        struct Profile: Decodable { let id: String }
        let profile: Profile = try await client.materialRequest("/api/v1/users/me")
        guard profile.id == state.profileId else { throw SottoAPIError.message("The active learner changed. Saved upload progress remains retained.") }
        if state.batch == nil {
            let path = "/api/v1/materials/uploads?courseId=\(try pathComponent(courseId))"
            let batch: SottoMaterialBatchReceipt = try await client.materialRequest(path, method: "POST", body: JSONEncoder().encode(state.request))
            try batch.validate(request: state.request)
            state.batch = batch
            try save(state, scope: scope)
        }
        try state.batch!.validate(request: state.request)
        for original in state.batch!.uploads {
            try Task.checkCancellation()
            let path = "/api/v1/materials/uploads/\(original.uploadId)"
            var receipt: SottoMaterialUploadReceipt = try await client.materialRequest(path)
            try accept(receipt, expected: original, state: &state, scope: scope)
            try rejectTerminalFailure(receipt)
            if receipt.status == "COMPLETE" { continue }
            if receipt.status == "UPLOADING" {
                guard Date() < state.deadline else {
                    throw SottoAPIError.message("Automatic upload waiting paused after two hours. Check the saved transfer before replacing it.")
                }
                let file = scope.appendingPathComponent(original.file.clientId + ".source")
                let handle = try FileHandle(forReadingFrom: file)
                defer { try? handle.close() }
                let count = (receipt.file.byteSize + SottoMaterialUploadReceipt.partBytes - 1) / SottoMaterialUploadReceipt.partBytes
                for index in 0..<count {
                    try Task.checkCancellation()
                    let offset = index * SottoMaterialUploadReceipt.partBytes
                    let size = min(SottoMaterialUploadReceipt.partBytes, receipt.file.byteSize - offset)
                    try handle.seek(toOffset: UInt64(offset))
                    let bytes = try handle.read(upToCount: size) ?? Data()
                    guard bytes.count == size else { throw SottoAPIError.message("The staged original changed. Saved progress remains retained.") }
                    let digest = Self.hash(bytes)
                    if let committed = receipt.parts.first(where: { $0.index == index }) {
                        guard committed.sha256 == digest else { throw SottoAPIError.message("The staged original differs from a committed upload part.") }
                        continue
                    }
                    let part = scope.appendingPathComponent("part-\(original.uploadId)-\(index)")
                    try bytes.write(to: part, options: .atomic)
                    defer { try? FileManager.default.removeItem(at: part) }
                    let updated: SottoMaterialUploadReceipt = try await client.materialRequest("\(path)/parts/\(index)", method: "PUT", partFile: part,
                        headers: ["Content-Type": "application/octet-stream", "x-sotto-upload-offset": String(offset),
                            "x-sotto-upload-bytes": String(size), "x-sotto-upload-sha256": digest])
                    try accept(updated, expected: receipt, state: &state, scope: scope)
                    guard let acknowledged = updated.parts.first(where: { $0.index == index }), acknowledged.sha256 == digest else {
                        throw SottoAPIError.message("The upload part was not acknowledged. Its original remains saved.")
                    }
                    receipt = updated
                }
                let completion = state.completions[receipt.uploadId] ?? SottoMaterialCompletionRequest(schemaVersion: 1,
                    requestId: UUID().uuidString.lowercased(), expectedRevision: receipt.revision)
                state.completions[receipt.uploadId] = completion
                try save(state, scope: scope)
                let updated: SottoMaterialUploadReceipt = try await client.materialRequest("\(path)/complete", method: "POST", body: JSONEncoder().encode(completion))
                try accept(updated, expected: receipt, state: &state, scope: scope)
                receipt = updated
            }
            while receipt.status == "FINALIZING" {
                guard Date() < state.deadline else {
                    throw SottoAPIError.message("The original is still finalizing. Resume the saved transfer to check its receipt.")
                }
                try await Task.sleep(for: pollInterval)
                let updated: SottoMaterialUploadReceipt = try await client.materialRequest(path)
                try accept(updated, expected: receipt, state: &state, scope: scope)
                receipt = updated
            }
            try rejectTerminalFailure(receipt)
            guard receipt.status == "COMPLETE" else {
                throw SottoAPIError.message("The original has not been confirmed. Resume this saved transfer.")
            }
        }
        // The original receipts are durable. Keep local files until the owning course read confirms attachment.
        let notes = try await client.fetchCourseNotes(courseId: courseId)
        let required = Set(state.batch!.uploads.map(\.materialId))
        var confirmed = Set(notes.materials?.map(\.id) ?? []).intersection(required)
        var next = notes.nextCursor
        var visited = Set<String>()
        while confirmed != required, let cursor = next {
            try Task.checkCancellation()
            guard Date() < state.deadline, visited.count < 10000, visited.insert(cursor).inserted else {
                throw SottoAPIError.message("Course attachment confirmation paused. Resume this saved receipt to check the remaining metadata pages.")
            }
            let page = try await client.fetchCourseNotes(courseId: courseId, cursor: cursor)
            confirmed.formUnion(Set(page.materials?.map(\.id) ?? []).intersection(required))
            next = page.nextCursor
        }
        guard confirmed == required else {
            throw SottoAPIError.message("The originals are saved, but their course attachment is not confirmed. Resume to check again.")
        }
        try FileManager.default.removeItem(at: scope)
        return notes
    }

    func cancel(client: SottoAPIClient, courseId: String, storeRoot: URL?) async throws {
        let scope = try transferScope(client: client, courseId: courseId, storeRoot: storeRoot)
        guard active.insert(scope.path).inserted else { throw SottoAPIError.message("Stop waiting for this transfer before cancelling it.") }
        defer { active.remove(scope.path) }
        guard var state = try load(scope: scope, client: client, courseId: courseId) else { return }
        guard let batch = state.batch else {
            // Admission may have succeeded before its response was lost. Reconcile the same declaration first.
            let admitted: SottoMaterialBatchReceipt = try await client.materialRequest(
                "/api/v1/materials/uploads?courseId=\(try pathComponent(courseId))", method: "POST", body: JSONEncoder().encode(state.request))
            try admitted.validate(request: state.request)
            state.batch = admitted; try save(state, scope: scope)
            throw SottoAPIError.message("The saved request was recovered. Cancel it again to confirm cleanup.")
        }
        try batch.validate(request: state.request)
        for original in batch.uploads {
            let path = "/api/v1/materials/uploads/\(original.uploadId)"
            let receipt: SottoMaterialUploadReceipt = try await client.materialRequest(path)
            try accept(receipt, expected: original, state: &state, scope: scope)
            if ["COMPLETE", "CANCELLED", "EXPIRED"].contains(receipt.status) { continue }
            let result: SottoMaterialUploadReceipt = try await client.materialRequest(path, method: "DELETE")
            try accept(result, expected: receipt, state: &state, scope: scope)
            guard ["CANCELLED", "EXPIRED"].contains(result.status) else {
                throw SottoAPIError.message("Upload cleanup is not confirmed. Saved receipt metadata remains retained.")
            }
        }
        try FileManager.default.removeItem(at: scope)
    }

    private func accept(_ value: SottoMaterialUploadReceipt, expected: SottoMaterialUploadReceipt,
        state: inout SottoMaterialTransferCheckpoint, scope: URL) throws {
        try value.validate(expected: expected)
        guard let index = state.batch?.uploads.firstIndex(where: { $0.uploadId == value.uploadId }) else {
            throw SottoAPIError.message("The upload is outside its saved batch.")
        }
        state.batch?.uploads[index] = value
        try save(state, scope: scope)
    }

    private func rejectTerminalFailure(_ receipt: SottoMaterialUploadReceipt) throws {
        if ["FAILED", "CANCELLED", "EXPIRED"].contains(receipt.status) {
            throw SottoAPIError.message(receipt.failureReason ?? "This transfer is \(receipt.status.lowercased()). Confirm cleanup before replacing it.")
        }
    }

    private func transferScope(client: SottoAPIClient, courseId: String, storeRoot: URL?) throws -> URL {
        guard let profile = client.profileId, !profile.isEmpty else { throw SottoAPIError.message("Select a learner before importing originals.") }
        let root = try storeRoot ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("SottoMaterialTransfers", isDirectory: true)
        let identity = try JSONEncoder().encode([client.serverURL.absoluteString, profile, courseId])
        return root.appendingPathComponent(Self.hash(identity), isDirectory: true)
    }

    private func pathComponent(_ value: String) throws -> String {
        guard let encoded = value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw SottoAPIError.message("The course identity is invalid.") }
        return encoded
    }

    private func load(scope: URL, client: SottoAPIClient, courseId: String) throws -> SottoMaterialTransferCheckpoint? {
        let file = scope.appendingPathComponent("receipt.json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: 1_048_577) ?? Data()
        guard data.count <= 1_048_576 else { throw SottoAPIError.message("The saved receipt exceeds its metadata limit.") }
        let state = try JSONDecoder().decode(SottoMaterialTransferCheckpoint.self, from: data)
        guard state.schemaVersion == 1, state.server == client.serverURL.absoluteString,
              state.profileId == client.profileId, state.courseId == courseId,
              UUID(uuidString: state.request.requestId) != nil,
              !state.request.files.isEmpty, state.request.files.count <= 10,
              Set(state.request.files.map(\.clientId)).count == state.request.files.count,
              state.request.files.allSatisfy({ UUID(uuidString: $0.clientId) != nil }) else {
            throw SottoAPIError.message("The saved transfer belongs to another server, learner, or course.")
        }
        try state.batch?.validate(request: state.request)
        return state
    }

    private func save(_ state: SottoMaterialTransferCheckpoint, scope: URL) throws {
        try JSONEncoder().encode(state).write(to: scope.appendingPathComponent("receipt.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func prepare(urls: [URL], client: SottoAPIClient, courseId: String, scope: URL) throws -> SottoMaterialTransferCheckpoint {
        guard !urls.isEmpty, urls.count <= 10 else { throw SottoAPIError.message("Choose up to ten originals, each at most 100MiB, totaling at most 250MiB.") }
        guard !FileManager.default.fileExists(atPath: scope.path) else {
            throw SottoAPIError.message("Unreadable transfer metadata remains on this device. Do not start a replacement until its saved request is recovered.")
        }
        try FileManager.default.createDirectory(at: scope, withIntermediateDirectories: true)
        var declarations: [SottoMaterialFileDeclaration] = []
        var total = 0
        do {
            for url in urls {
                let name = url.lastPathComponent
                guard !name.isEmpty, name.utf16.count <= 240,
                      name == name.trimmingCharacters(in: .whitespacesAndNewlines),
                      !name.hasPrefix("\u{FEFF}"), !name.hasSuffix("\u{FEFF}"),
                      !name.contains("\\"), name.rangeOfCharacter(from: .controlCharacters) == nil else {
                    throw SottoAPIError.message("Rename this original to a plain filename up to 240 characters before uploading it.")
                }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let file = try FileHandle(forReadingFrom: url)
                defer { try? file.close() }
                let size = try file.seekToEnd()
                guard size > 0, size <= 100 * 1_048_576, total + Int(size) <= 250 * 1_048_576 else {
                    throw SottoAPIError.message("Choose originals up to 100MiB each, totaling at most 250MiB.")
                }
                try file.seek(toOffset: 0)
                let clientId = UUID().uuidString.lowercased()
                let staged = scope.appendingPathComponent(clientId + ".source")
                guard FileManager.default.createFile(atPath: staged.path, contents: nil,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else {
                    throw SottoAPIError.message("The original could not be staged on this device.")
                }
                let writer = try FileHandle(forWritingTo: staged)
                defer { try? writer.close() }
                var hasher = SHA256(); var count = 0
                while let bytes = try file.read(upToCount: 1_048_576), !bytes.isEmpty {
                    try Task.checkCancellation()
                    count += bytes.count
                    guard count <= Int(size) else { throw SottoAPIError.message("The original changed while it was being staged.") }
                    hasher.update(data: bytes); try writer.write(contentsOf: bytes)
                }
                guard count == Int(size) else { throw SottoAPIError.message("The original changed while it was being staged.") }
                total += count
                declarations.append(SottoMaterialFileDeclaration(clientId: clientId, name: name,
                    mimeType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream",
                    byteSize: count, sha256: hasher.finalize().map { String(format: "%02x", $0) }.joined()))
            }
            let state = SottoMaterialTransferCheckpoint(schemaVersion: 1, server: client.serverURL.absoluteString,
                profileId: client.profileId!, courseId: courseId,
                request: SottoMaterialBatchRequest(schemaVersion: 1, requestId: UUID().uuidString.lowercased(), files: declarations),
                batch: nil, completions: [:], deadline: Date().addingTimeInterval(7200))
            try save(state, scope: scope)
            return state
        } catch { try? FileManager.default.removeItem(at: scope); throw error }
    }

    private func verifyStaged(_ state: SottoMaterialTransferCheckpoint, scope: URL) throws {
        for file in state.request.files {
            let result = try Self.fileDigest(scope.appendingPathComponent(file.clientId + ".source"))
            guard result.size == file.byteSize, result.hash == file.sha256 else {
                throw SottoAPIError.message("The retained original bytes changed. Its receipt remains saved; no new upload was admitted.")
            }
        }
    }

    private func verifyReselection(_ urls: [URL], request: SottoMaterialBatchRequest) throws {
        guard urls.count == request.files.count else { throw SottoAPIError.message("Resume the saved originals before choosing a different batch.") }
        for (url, file) in zip(urls, request.files) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let result = try Self.fileDigest(url)
            guard url.lastPathComponent == file.name, result.size == file.byteSize, result.hash == file.sha256 else {
                throw SottoAPIError.message("These files differ from the saved originals. Resume or cancel the existing batch first.")
            }
        }
    }

    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    private static func fileDigest(_ url: URL) throws -> (size: Int, hash: String) {
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var size = 0; var digest = SHA256()
        while let bytes = try file.read(upToCount: 1_048_576), !bytes.isEmpty {
            try Task.checkCancellation(); size += bytes.count
            guard size <= 100 * 1_048_576 else { throw SottoAPIError.message("An original exceeds the 100MiB limit.") }
            digest.update(data: bytes)
        }
        return (size, digest.finalize().map { String(format: "%02x", $0) }.joined())
    }
}
