import Foundation
import Network

enum SottoServerURLPolicy {
    static func isSupported(_ url: URL) -> Bool {
        guard
            let scheme = url.scheme?.lowercased(),
            let host = url.host(percentEncoded: false),
            !host.isEmpty
        else {
            return false
        }

        if scheme == "https" {
            return true
        }

        if scheme == "http" {
            return isLocalNetworkHost(host)
        }

        return false
    }

    static func unsupportedMessage(for url: URL) -> String {
        let host = url.host(percentEncoded: false) ?? "that server"
        if url.scheme?.lowercased() == "http" {
            return "Sotto can pair with HTTPS servers, or HTTP only on local/private network addresses. Use HTTPS for \(host), or scan a local network pairing URL."
        }

        return "That pairing link does not use a supported web address. Use an HTTPS Sotto server, or local HTTP while you are on the same network."
    }

    private static func isLocalNetworkHost(_ host: String) -> Bool {
        let normalized = host
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .lowercased()

        if normalized == "localhost" || normalized.hasSuffix(".local") {
            return true
        }

        if isPrivateIPv4Address(normalized) {
            return true
        }

        return isLocalIPv6Address(normalized)
    }

    private static func isPrivateIPv4Address(_ host: String) -> Bool {
        let parts = host.split(separator: ".")
        guard parts.count == 4 else { return false }

        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else {
            return false
        }

        let first = octets[0]
        let second = octets[1]

        if first == 10 || first == 127 || first == 169 && second == 254 {
            return true
        }

        if first == 172 && (16...31).contains(second) {
            return true
        }

        return first == 192 && second == 168
    }

    private static func isLocalIPv6Address(_ host: String) -> Bool {
        guard let address = IPv6Address(host) else {
            return false
        }

        let bytes = address.rawValue
        if bytes.prefix(15).allSatisfy({ $0 == 0 }) && bytes[15] == 1 {
            return true
        }

        if bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80 {
            return true
        }

        return (bytes[0] & 0xfe) == 0xfc
    }
}
