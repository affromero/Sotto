import XCTest

@testable import Sotto

final class AccountDeletionTests: XCTestCase {
    func testConfirmedAndQueuedDeletionSucceed() async throws {
        for status in [200, 202] {
            try await client(status: status).deleteAccount()
        }
    }

    func testServerFailureDoesNotReportDeletionSuccess() async {
        do {
            try await client(status: 500).deleteAccount()
            XCTFail("Deletion must fail when the server rejects it.")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("unavailable"))
        }
    }

    private func client(status: Int) -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [DeletionProtocol.self]
        return SottoAPIClient(
            serverURL: URL(string: "https://status-\(status).example")!,
            apiKey: "test-key",
            profileId: "learner-1",
            session: URLSession(configuration: configuration)
        )
    }
}

private final class DeletionProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        XCTAssertEqual(request.httpMethod, "DELETE")
        XCTAssertEqual(request.url?.path, "/api/v1/users/me")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner-1")
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 256)
            let count = stream.read(&bytes, maxLength: bytes.count)
            XCTAssertGreaterThan(count, 0)
            if count > 0 {
                let object = try? JSONSerialization.jsonObject(with: Data(bytes.prefix(count))) as? [String: String]
                XCTAssertEqual(object, ["confirm": "DELETE"])
            }
        } else {
            let object = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] }
            XCTAssertEqual(object, ["confirm": "DELETE"])
        }
        let status = request.url?.host == "status-500.example" ? 500
            : request.url?.host == "status-202.example" ? 202 : 200
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        let body = status == 500 ? #"{"error":"unavailable"}"# : #"{"success":true,"cleanup":{"id":"job","phase":"pending"}}"#
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
