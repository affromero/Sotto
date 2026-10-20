import Foundation

struct SottoMaterialFileDeclaration: Codable, Equatable {
    let clientId: String
    let name: String
    let mimeType: String
    let byteSize: Int
    let sha256: String
}

struct SottoMaterialUploadReceipt: Codable {
    struct Part: Codable {
        let schemaVersion: Int
        let uploadId: String
        let index: Int
        let offset: Int
        let byteSize: Int
        let sha256: String
        let committedAt: String
    }
    struct Original: Codable {
        let schemaVersion: Int
        let uploadId: String
        let materialId: String
        let byteSize: Int
        let sha256: String
        let publishedAt: String
    }
    let schemaVersion: Int
    let batchId: String
    let uploadId: String
    let materialId: String
    let limitsVersion: Int
    let file: SottoMaterialFileDeclaration
    let status: String
    let revision: Int
    let expiresAt: String
    let parts: [Part]
    let original: Original?
    let failureReason: String?

    func validate(expected: Self? = nil) throws {
        guard schemaVersion == 1, limitsVersion == 1, UUID(uuidString: batchId) != nil,
              UUID(uuidString: uploadId) != nil, UUID(uuidString: materialId) != nil,
              UUID(uuidString: file.clientId) != nil, file.byteSize > 0,
              file.byteSize <= 100 * 1_048_576, revision >= 0,
              ["UPLOADING", "FINALIZING", "COMPLETE", "CANCELLED", "EXPIRED", "FAILED"].contains(status),
              (status == "COMPLETE") == (original != nil),
              Set(parts.map(\.index)).count == parts.count,
              file.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw SottoAPIError.message("The upload receipt is invalid. Its saved progress has been retained.")
        }
        if let expected {
            guard expected.batchId == batchId, expected.uploadId == uploadId,
                  expected.materialId == materialId, expected.file == file, revision >= expected.revision else {
                throw SottoAPIError.message("The upload receipt changed identity. Its saved progress has been retained.")
            }
            if let saved = expected.original {
                guard status == "COMPLETE", original?.publishedAt == saved.publishedAt,
                      original?.sha256 == saved.sha256 else {
                    throw SottoAPIError.message("The completed original receipt changed. Its publication proof remains retained.")
                }
            }
        }
        for part in parts {
            guard part.index >= 0, part.index < 25 else {
                throw SottoAPIError.message("An upload part index is outside its declared file.")
            }
            let offset = part.index * Self.partBytes
            guard part.schemaVersion == 1, part.uploadId == uploadId, part.index >= 0,
                  part.index < 25, part.offset == offset, offset < file.byteSize,
                  part.byteSize == min(Self.partBytes, file.byteSize - offset),
                  part.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                throw SottoAPIError.message("An upload part no longer matches its original file.")
            }
        }
        if let original {
            guard original.schemaVersion == 1, original.uploadId == uploadId,
                  original.materialId == materialId, original.byteSize == file.byteSize,
                  original.sha256 == file.sha256 else {
                throw SottoAPIError.message("The published original differs from the staged file.")
            }
        }
    }
    static let partBytes = 4 * 1_048_576
}

struct SottoMaterialBatchRequest: Codable {
    let schemaVersion: Int
    let requestId: String
    let files: [SottoMaterialFileDeclaration]
}

struct SottoMaterialBatchReceipt: Codable {
    let schemaVersion: Int
    let batchId: String
    let requestId: String
    var uploads: [SottoMaterialUploadReceipt]
    func validate(request: SottoMaterialBatchRequest) throws {
        guard schemaVersion == 1, requestId == request.requestId,
              UUID(uuidString: batchId) != nil, uploads.count == request.files.count,
              Set(uploads.map(\.uploadId)).count == uploads.count,
              Set(uploads.map(\.materialId)).count == uploads.count,
              Set(uploads.map { $0.file.clientId }).count == uploads.count,
              uploads.allSatisfy({ $0.batchId == batchId && request.files.contains($0.file) }) else {
            throw SottoAPIError.message("The upload batch differs from its saved request.")
        }
        for upload in uploads { try upload.validate() }
    }
}

struct SottoMaterialCompletionRequest: Codable {
    let schemaVersion: Int
    let requestId: String
    let expectedRevision: Int
}

struct SottoMaterialTransferCheckpoint: Codable {
    let schemaVersion: Int
    let server: String
    let profileId: String
    let courseId: String
    let request: SottoMaterialBatchRequest
    var batch: SottoMaterialBatchReceipt?
    var completions: [String: SottoMaterialCompletionRequest]
    var deadline: Date
}
