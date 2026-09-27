import XCTest

@testable import Sotto

final class WorkbookDownloadTests: XCTestCase {
    func testPairedServerPDFReceivesLearnerCredentials() async throws {
        let data = try await client().downloadWorkbookPDF(from: URL(string: "https://school.example/api/v1/storage/workbook.pdf")!)
        XCTAssertEqual(data, Data("pdf bytes".utf8))
    }

    func testExternalStoragePDFReceivesNoLearnerCredentials() async throws {
        let data = try await client().downloadWorkbookPDF(from: URL(string: "https://storage.example/workbook.pdf")!)
        XCTAssertEqual(data, Data("pdf bytes".utf8))
    }

    func testPDFHTTPFailureSurfaces() async {
        do {
            _ = try await client().downloadWorkbookPDF(from: URL(string: "https://school.example/missing")!)
            XCTFail("Missing PDFs must report an error.")
        } catch { XCTAssertTrue(error.localizedDescription.contains("404")) }
    }

    func testRedirectRemovesCredentialsWhenOriginChanges() throws {
        let policy = WorkbookDownloadRedirectPolicy(serverURL: URL(string: "https://school.example")!)
        for destination in ["https://storage.example/file.pdf", "https://school.example:8443/file.pdf"] {
            var request = URLRequest(url: URL(string: destination)!)
            request.setValue("Bearer secret", forHTTPHeaderField: "Authorization")
            request.setValue("learner", forHTTPHeaderField: "X-Sotto-Profile-Id")
            request.setValue("session=secret", forHTTPHeaderField: "Cookie")
            let safe = try XCTUnwrap(policy.redirectedRequest(request))
            XCTAssertNil(safe.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(safe.value(forHTTPHeaderField: "X-Sotto-Profile-Id"))
            XCTAssertNil(safe.value(forHTTPHeaderField: "Cookie"))
            XCTAssertFalse(safe.httpShouldHandleCookies)
        }
    }

    func testSameOriginRedirectKeepsBearerAndRejectsUnsafeDestinations() throws {
        let policy = WorkbookDownloadRedirectPolicy(serverURL: URL(string: "https://school.example")!)
        var request = URLRequest(url: URL(string: "https://school.example:443/file.pdf")!)
        request.setValue("Bearer secret", forHTTPHeaderField: "Authorization")
        XCTAssertEqual(policy.redirectedRequest(request)?.value(forHTTPHeaderField: "Authorization"), "Bearer secret")
        for destination in ["file:///tmp/private", "http://school.example/file.pdf", "https://user:password@school.example/file.pdf"] {
            XCTAssertNil(policy.redirectedRequest(URLRequest(url: URL(string: destination)!)))
        }
    }

    private func client() -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WorkbookPDFProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "test-key", profileId: "learner-1", session: URLSession(configuration: configuration))
    }
}

private final class WorkbookPDFProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let local = request.url?.host == "school.example"
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), local ? "Bearer test-key" : nil)
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), local ? "learner-1" : nil)
        XCTAssertFalse(request.httpShouldHandleCookies)
        let status = request.url?.path == "/missing" ? 404 : 200
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("pdf bytes".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
