import XCTest
@testable import Sotto

final class ClassLessonHelpTests: XCTestCase {
    // Digests generated with Node's JSON.stringify and the shared teaching schema's trimmed fields.
    private let first = #"{"version":1,"title":"  Grüße \"Freund\"  ","explanation":"Line one\n\nZeile zwei 😀 / \\\t","workedExamples":[{"prompt":" Was?","answer":" Ja! ","explanation":"Ein Beispiel."},{"prompt":"Été","answer":"猫","explanation":"A\u0001B"}],"commonMistake":{"incorrect":"Falsch.","correction":"Richtig.","explanation":"\u00a0Hinweis\ufeff"},"guidedPractice":{"prompt":"Versuch.","hint":"Hilfe","answer":"Antwort","explanation":"Warum"}}"#
    private let second = #"{"version":1,"title":"\u2028你好\u2029","explanation":"/\\\"\b\f\r\n","workedExamples":[{"prompt":"eins","answer":"zwei","explanation":"drei"},{"prompt":"vier","answer":"fünf","explanation":"sechs"}],"commonMistake":{"incorrect":"nein","correction":"ja","explanation":"warum"},"guidedPractice":{"prompt":"a","hint":"b","answer":"c","explanation":"d"}}"#

    func testTeachingHashMatchesJavaScriptSchemaSerialization() throws {
        let fixtures = [
            (first, "b53d5af27e7a42b715beb57e6fc616e0d973a5b08893939ebc390d705690e3c2"),
            (second, "62f830ddafd7f93e8288a8a7603e5badcb71a358eb1f35f2267dbf1386a2101f")
        ]
        for (input, expected) in fixtures {
            let teaching = try JSONDecoder().decode(SottoClassTeaching.self, from: Data(input.utf8))
            XCTAssertEqual(teaching.sourceHash, expected)
        }
    }

    func testRejectsHelpForAnotherLessonAndIncompleteReadyResponse() throws {
        let teaching = try JSONDecoder().decode(SottoClassTeaching.self, from: Data(first.utf8))
        let response = try JSONDecoder().decode(SottoClassLessonHelpResponse.self, from: Data(ClassLessonHelpProtocol.response.utf8))
        XCTAssertThrowsError(try response.validate(for: teaching))
        let incomplete = ClassLessonHelpProtocol.response
            .replacingOccurrences(of: "AVAILABLE", with: "READY")
            .replacingOccurrences(of: String(repeating: "a", count: 64), with: teaching.sourceHash)
        let ready = try JSONDecoder().decode(SottoClassLessonHelpResponse.self, from: Data(incomplete.utf8))
        XCTAssertThrowsError(try ready.validate(for: teaching))
    }

    func testAuthenticatedAdmissionKeepsTheServerRequestIncludingNullRetry() async throws {
        let client = ClassLessonHelpProtocol.makeClient()
        let available = try await client.fetchClassLessonHelp(classId: "class-1")
        XCTAssertEqual(available.status, .available)
        let pending = try await client.startClassLessonHelp(classId: "class-1", request: available.request)
        XCTAssertEqual(pending.status, .pending)
        XCTAssertEqual(pending.request, available.request)
    }

    func testProviderConfigurationErrorsPointToWebSetupAndOtherErrorsStaySpecific() throws {
        let configuration = SottoClassLessonHelpFailure.normalized(SottoAPIError.message("API key not configured"))
        XCTAssertTrue(configuration.localizedDescription.contains("Sotto web app"))
        let failure = SottoClassLessonHelpFailure.normalized(SottoAPIError.message("The saved lesson changed."))
        XCTAssertEqual(failure.localizedDescription, "The saved lesson changed.")
        let failed = ClassLessonHelpProtocol.response
            .replacingOccurrences(of: "AVAILABLE", with: "FAILED")
            .replacingOccurrences(of: #""canRetry":false"#, with: #""canRetry":false,"error":"No provider configured""#)
        let response = try JSONDecoder().decode(SottoClassLessonHelpResponse.self, from: Data(failed.utf8))
        XCTAssertTrue(response.error?.contains("Sotto web app") == true)
    }
}

private final class ClassLessonHelpProtocol: URLProtocol {
    static let response = #"{"status":"AVAILABLE","request":{"operationId":"2c157df4-a35d-4e3f-bbd6-670d9b200e2f","attempt":2,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","retryOf":null},"nativeLang":"en","targetLang":"de","canRetry":false}"#

    static func makeClient() -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ClassLessonHelpProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "help-key", profileId: "learner", session: URLSession(configuration: configuration))
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.url?.path, "/api/v1/classes/class-1/lesson-help")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer help-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
        XCTAssertFalse(request.httpShouldHandleCookies)
        let isPost = request.httpMethod == "POST"
        if !isPost { XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData) }
        if isPost {
            let body = try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]
            XCTAssertEqual(body?["operationId"] as? String, "2c157df4-a35d-4e3f-bbd6-670d9b200e2f")
            XCTAssertTrue(body?["retryOf"] is NSNull)
        }
        let data = isPost ? Self.response.replacingOccurrences(of: "AVAILABLE", with: "PENDING") : Self.response
        let response = HTTPURLResponse(url: request.url!, statusCode: isPost ? 202 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(data.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
