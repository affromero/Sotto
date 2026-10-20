import Foundation

extension SottoAPIClient {
    func fetchLegacyMaterialText(materialId: String, offset: Int = 0, limit: Int = 8192) async throws -> SottoLegacyMaterialText {
        guard UUID(uuidString: materialId) != nil, (0...9_007_199_254_740_991).contains(offset), (1...8192).contains(limit) else {
            throw SottoAPIError.message("The retained legacy text range is invalid.")
        }
        let value: SottoLegacyMaterialText = try await get("/api/v1/materials/\(materialId)/legacy-text?offset=\(offset)&limit=\(limit)")
        let count = value.text.unicodeScalars.count
        guard value.materialId == materialId, value.origin == "LEGACY_EMBEDDED_TEXT", value.offset == offset,
              (offset...9_007_199_254_740_991).contains(value.totalCodePoints),
              count == min(limit, value.totalCodePoints - offset),
              value.nextOffset == (offset + count < value.totalCodePoints ? offset + count : nil) else {
            throw SottoAPIError.message("The retained legacy text receipt changed its identity or Unicode range.")
        }
        return value
    }
    func fetchMaterialProcessing(materialId: String, afterPage: Int = 0) async throws -> SottoMaterialProcessing {
        guard UUID(uuidString: materialId) != nil, (0...10000).contains(afterPage) else { throw SottoAPIError.message("The material identity is invalid.") }
        let result: SottoMaterialProcessing = try await get("/api/v1/materials/\(materialId)/processing?afterPage=\(afterPage)")
        guard result.materialId == materialId, result.pages.count <= 100,
              result.pages.map(\.pageNumber) == result.pages.map(\.pageNumber).sorted(),
              Set(result.pages.map(\.pageNumber)).count == result.pages.count,
              result.pages.allSatisfy({ $0.pageNumber > afterPage }),
              result.nextPage == nil || result.nextPage == result.pages.last?.pageNumber else {
            throw SottoAPIError.message("The material page receipt changed. Reload its source.")
        }
        return result
    }

    func fetchMaterialPageText(materialId: String, runId: String, page: Int, origin: String,
        afterIndex: Int = -1) async throws -> SottoMaterialPageText {
        guard UUID(uuidString: materialId) != nil, UUID(uuidString: runId) != nil,
              (1...10000).contains(page), ["EMBEDDED_TEXT", "VISUAL_RECOGNITION"].contains(origin), (-1...8192).contains(afterIndex) else {
            throw SottoAPIError.message("The page source identity is invalid.")
        }
        let result: SottoMaterialPageText = try await get("/api/v1/materials/\(materialId)/pages/\(page)/text?runId=\(runId)&origin=\(origin)&afterIndex=\(afterIndex)")
        guard result.runId == runId, result.manifest.pageNumber == page, result.manifest.source.origin == origin,
              result.chunks.count <= 8, result.nextIndex == nil || result.nextIndex == result.chunks.last?.index else {
            throw SottoAPIError.message("The material text receipt changed origin or page.")
        }
        for (offset, chunk) in result.chunks.enumerated() {
            let bytes = Data(chunk.text.utf8)
            guard chunk.index == afterIndex + 1 + offset, chunk.codePointStart >= 0,
                  chunk.codePointEnd >= chunk.codePointStart, chunk.utf8ByteStart >= 0,
                  chunk.utf8ByteEnd >= chunk.utf8ByteStart,
                  chunk.text.unicodeScalars.count == chunk.codePointEnd - chunk.codePointStart,
                  bytes.count == chunk.utf8ByteEnd - chunk.utf8ByteStart,
                  NativeMaterialTransfers.hash(bytes) == chunk.sha256,
                  chunk.codePointEnd <= result.manifest.codePointLength,
                  chunk.utf8ByteEnd <= result.manifest.utf8ByteLength else {
                throw SottoAPIError.message("A material source chunk failed its exact byte check.")
            }
        }
        return result
    }
}
