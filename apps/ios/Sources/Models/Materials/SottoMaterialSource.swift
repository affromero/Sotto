import Foundation

struct SottoMaterialProcessing: Decodable {
    struct Run: Decodable { let id: String; let status: String; let pageCount: Int? }
    struct Page: Decodable, Identifiable {
        struct Visual: Decodable { let state: String }
        struct Embedded: Decodable { let state: String }
        let pageNumber: Int
        let embeddedText: Embedded
        let visual: Visual
        let textStreams: [SottoMaterialTextManifest]
        var id: Int { pageNumber }
    }
    let materialId: String
    let processingRevision: Int
    let originalSha256: String?
    let status: String
    let diagnostic: String?
    let run: Run?
    let pages: [Page]
    let nextPage: Int?
}

struct SottoMaterialTextManifest: Decodable {
    struct Source: Decodable { let origin: String; let method: String; let version: String }
    let pageNumber: Int
    let source: Source
    let textSha256: String
    let codePointLength: Int
    let utf8ByteLength: Int
    let chunkCount: Int
}

struct SottoMaterialPageText: Decodable {
    struct Chunk: Decodable, Identifiable {
        let index: Int
        let codePointStart: Int
        let codePointEnd: Int
        let utf8ByteStart: Int
        let utf8ByteEnd: Int
        let sha256: String
        let text: String
        var id: Int { index }
    }
    let runId: String
    let manifest: SottoMaterialTextManifest
    let chunks: [Chunk]
    let nextIndex: Int?
}
