import XCTest
@testable import Sotto

final class CourseMaterialTests: XCTestCase {
    private func material() throws -> SottoCourseMaterial {
        try JSONDecoder().decode(SottoCourseMaterial.self, from: Data(#"{"id":"a604f52a-d011-4a21-9c6c-23de4930eeed","name":"Vocab Deutsch.pdf","mimeType":"application/pdf","byteSize":18,"extractedText":"Bahnhof means station."}"#.utf8))
    }

    func testOriginalDownloadKeepsFilenameAndReturnsUnchangedBytes() async throws {
        let file = try await CourseMaterialTestProtocol.client().downloadCourseMaterial(material())
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        XCTAssertEqual(file.lastPathComponent, "Vocab Deutsch.pdf")
        XCTAssertEqual(try Data(contentsOf: file), Data("original PDF bytes".utf8))
    }

    func testDocumentsDecodeSeparatelyFromEditableNotes() throws {
        let response = try JSONDecoder().decode(SottoCourseNotesResponse.self, from: Data(#"{"body":"Travel goals","materials":[{"id":"a604f52a-d011-4a21-9c6c-23de4930eeed","name":"Vocab Deutsch.pdf","mimeType":"application/pdf","byteSize":18,"extractedText":"Bahnhof means station."}]}"#.utf8))
        XCTAssertEqual(response.body, "Travel goals")
        XCTAssertEqual(response.materials?.first?.name, "Vocab Deutsch.pdf")
    }

    func testOversizedNativeUploadIsRejectedBeforeSending() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).txt")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        defer { try? FileManager.default.removeItem(at: url) }
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: 100 * 1024 * 1024)
        try handle.close()
        do {
            _ = try await CourseMaterialTestProtocol.client().importCourseMaterials(courseId: "course", urls: [url])
            XCTFail("Oversized material must not be uploaded.")
        } catch { XCTAssertTrue(error.localizedDescription.contains("10MB")) }
    }
}

final class CourseMaterialTestProtocol: URLProtocol {
    static func client() -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CourseMaterialTestProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "test-key", profileId: "learner", session: URLSession(configuration: configuration))
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/v1/materials/a604f52a-d011-4a21-9c6c-23de4930eeed/file")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
        XCTAssertFalse(request.httpShouldHandleCookies)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/pdf"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("original PDF bytes".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
