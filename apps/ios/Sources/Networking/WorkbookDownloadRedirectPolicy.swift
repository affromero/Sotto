import Foundation

final class WorkbookDownloadRedirectPolicy: NSObject, URLSessionTaskDelegate {
    let serverURL: URL

    init(serverURL: URL) { self.serverURL = serverURL }

    static func sameOrigin(_ first: URL, _ second: URL) -> Bool {
        func port(_ url: URL) -> Int? { url.port ?? (url.scheme?.lowercased() == "https" ? 443 : 80) }
        return first.scheme?.lowercased() == second.scheme?.lowercased()
            && first.host?.lowercased() == second.host?.lowercased()
            && port(first) == port(second)
    }

    func redirectedRequest(_ request: URLRequest) -> URLRequest? {
        guard let url = request.url, SottoServerURLPolicy.isSupported(url),
              url.user == nil, url.password == nil else { return nil }
        var safe = request
        safe.httpShouldHandleCookies = false
        safe.setValue(nil, forHTTPHeaderField: "Cookie")
        if !Self.sameOrigin(url, serverURL) {
            safe.setValue(nil, forHTTPHeaderField: "Authorization")
            safe.setValue(nil, forHTTPHeaderField: "X-Sotto-Profile-Id")
        }
        return safe
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(redirectedRequest(request))
    }
}
