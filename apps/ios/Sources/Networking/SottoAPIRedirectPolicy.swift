import Foundation

/// API bodies may contain passwords, recordings, or learner answers. They may
/// only follow redirects within the server origin chosen by the learner.
final class SottoAPIRedirectPolicy: NSObject, URLSessionTaskDelegate {
    let serverURL: URL

    init(serverURL: URL) { self.serverURL = serverURL }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let url = request.url, url.user == nil, url.password == nil,
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
