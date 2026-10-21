import Foundation
import Network

/// A real loopback HTTP boundary exercises Foundation's redirect and cookie
/// handling, which URLProtocol fixtures do not reproduce.
final class LocalHTTPServer: @unchecked Sendable {
    struct Response {
        let status: Int
        let headers: [String: String]
        let body: String
        var delay: TimeInterval = 0
        static func json(_ body: String) -> Self { .init(status: 200, headers: [:], body: body) }
    }
    private let listener: NWListener
    private let queue = DispatchQueue(label: "SottoTransportPrivacyTest")
    private let lock = NSLock()
    private var received: [String] = []
    private let respond: @Sendable (String) -> Response
    var requests: [String] { lock.withLock { received } }
    var url: URL { URL(string: "http://127.0.0.1:\(listener.port!.rawValue)")! }

    init(respond: @escaping @Sendable (String) -> Response) throws {
        listener = try NWListener(using: .tcp, on: .any)
        self.respond = respond
    }

    func start() async throws {
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, data: Data())
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    self?.listener.stateUpdateHandler = nil
                    continuation.resume()
                case .failed(let error):
                    self?.listener.stateUpdateHandler = nil
                    continuation.resume(throwing: error)
                default: break
                }
            }
            listener.start(queue: queue)
        }
    }

    func stop() { listener.cancel() }

    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] chunk, _, done, error in
            guard let self else { connection.cancel(); return }
            var buffer = data
            if let chunk { buffer.append(chunk) }
            let text = String(decoding: buffer, as: UTF8.self)
            if let headerEnd = text.range(of: "\r\n\r\n") {
                let headers = String(text[..<headerEnd.lowerBound])
                let length = headers.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }
                    .flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                if text[headerEnd.upperBound...].utf8.count >= length {
                    self.lock.withLock { self.received.append(text) }
                    let response = self.respond(text)
                    var headers = response.headers
                    if headers["Content-Type"] == nil { headers["Content-Type"] = "application/json" }
                    let fields = headers.map { "\($0.key): \($0.value)\r\n" }.joined()
                    let wire = "HTTP/1.1 \(response.status) Response\r\nContent-Length: \(response.body.utf8.count)\r\nConnection: close\r\n\(fields)\r\n\(response.body)"
                    self.queue.asyncAfter(deadline: .now() + response.delay) {
                        connection.send(content: Data(wire.utf8), completion: .contentProcessed { _ in connection.cancel() })
                    }
                    return
                }
            }
            if done || error != nil { connection.cancel() }
            else { self.receive(connection, data: buffer) }
        }
    }
}
