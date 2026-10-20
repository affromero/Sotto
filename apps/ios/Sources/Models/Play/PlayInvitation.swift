import Foundation
import Security

struct PlayInvitation: Codable, Equatable {
    let version: Int
    let serverURL: URL
    let code: String

    init(serverURL: URL, code: String) throws {
        guard let origin = Self.origin(serverURL), let code = Self.normalizedCode(code) else {
            throw SottoAPIError.message("Use a valid Sotto server and 12-character game code.")
        }
        version = 1
        self.serverURL = origin
        self.code = code
    }

    private enum CodingKeys: String, CodingKey { case version, serverURL, code }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .version) == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .version, in: c, debugDescription: "Unsupported invitation version.")
        }
        try self.init(serverURL: c.decode(URL.self, forKey: .serverURL), code: c.decode(String.self, forKey: .code))
    }

    static func normalizedCode(_ value: String) -> String? {
        let normalized = value.filter { !$0.isWhitespace && $0 != "-" }.uppercased()
        return normalized.range(of: "^[A-HJ-NP-Z2-9]{12}$", options: .regularExpression) != nil ? normalized : nil
    }

    static func origin(_ url: URL) -> URL? {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              ["https", "http"].contains(c.scheme?.lowercased() ?? ""),
              let host = c.host, !host.isEmpty, c.user == nil, c.password == nil,
              c.query == nil, c.fragment == nil, c.path.isEmpty || c.path == "/",
              url.absoluteString.count <= 2048, SottoServerURLPolicy.isSupported(url) else { return nil }
        var origin = c
        origin.path = ""
        origin.scheme = c.scheme?.lowercased()
        origin.host = host.lowercased()
        if origin.scheme == "https", origin.port == 443 { origin.port = nil }
        if origin.scheme == "http", origin.port == 80 { origin.port = nil }
        return origin.url
    }

    static func parse(_ value: String) -> PlayInvitation? {
        guard value.count <= 4096, let c = URLComponents(string: value),
              c.user == nil, c.password == nil, c.fragment == nil else { return nil }
        let native = c.scheme == "sotto" && c.host == "play" && c.path == "/join" && c.port == nil
        let web = ["https", "http"].contains(c.scheme ?? "") && c.path == "/play/join"
        guard native || web else { return nil }
        let items = c.queryItems ?? []
        guard Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ ["v", "server", "code"].contains($0.name) }),
              items.first(where: { $0.name == "v" })?.value == "1",
              let code = items.first(where: { $0.name == "code" })?.value else { return nil }
        let explicitServer = items.first(where: { $0.name == "server" })?.value
        if native && explicitServer == nil { return nil }
        var webOrigin = c
        webOrigin.path = ""
        webOrigin.queryItems = nil
        if explicitServer != nil, !native, webOrigin.url?.absoluteString != "https://sotto.fm" { return nil }
        let server: URL
        if let explicitServer {
            guard let parsed = URL(string: explicitServer) else { return nil }
            server = parsed
        } else {
            guard let parsed = webOrigin.url else { return nil }
            server = parsed
        }
        return try? PlayInvitation(serverURL: server, code: code)
    }

    var webURL: URL { link(native: false) }
    var appURL: URL { link(native: true) }
    var formattedCode: String {
        stride(from: 0, to: code.count, by: 4).map {
            let start = code.index(code.startIndex, offsetBy: $0)
            return String(code[start..<code.index(start, offsetBy: 4)])
        }.joined(separator: "-")
    }
    private func link(native: Bool) -> URL {
        var c = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        if native { c.scheme = "sotto"; c.host = "play"; c.port = nil }
        c.path = native ? "/join" : "/play/join"
        c.queryItems = [URLQueryItem(name: "v", value: "1")]
        if native { c.queryItems?.append(URLQueryItem(name: "server", value: serverURL.absoluteString)) }
        c.queryItems?.append(URLQueryItem(name: "code", value: code))
        return c.url!
    }
    static func newProof() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
        return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
