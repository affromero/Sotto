import Foundation

/// API bodies may contain passwords, recordings, or learner answers. They may
/// only follow redirects within the server origin chosen by the learner.
enum SottoAPIRequestPolicy { case standard, play }

final class SottoAPIRedirectPolicy: NSObject, URLSessionDataDelegate {
    let serverURL: URL
    let policy: SottoAPIRequestPolicy

    init(serverURL: URL, policy: SottoAPIRequestPolicy = .standard) {
        self.serverURL = serverURL
        self.policy = policy
    }

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask,
        willCacheResponse proposedResponse: CachedURLResponse,
        completionHandler: @escaping (CachedURLResponse?) -> Void
    ) {
        completionHandler(policy == .play ? nil : proposedResponse)
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard policy != .play, let url = request.url, url.user == nil, url.password == nil,
              WorkbookDownloadRedirectPolicy.sameOrigin(url, serverURL) else {
            completionHandler(nil)
            return
        }
        var safe = request
        safe.setValue(task.originalRequest?.value(forHTTPHeaderField: "Authorization"), forHTTPHeaderField: "Authorization")
        safe.setValue(task.originalRequest?.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), forHTTPHeaderField: "X-Sotto-Profile-Id")
        safe.httpShouldHandleCookies = task.originalRequest?.httpShouldHandleCookies ?? false
        if !safe.httpShouldHandleCookies { safe.setValue(nil, forHTTPHeaderField: "Cookie") }
        completionHandler(safe)
    }
}
