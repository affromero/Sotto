import Foundation
import UIKit

/// Everything that turns a server plus a credential into a paired device: the
/// scanned QR, the typed address plus household password, and the shared token
/// redemption both of them end in.
extension SottoAppModel {
    /// What this device calls itself in the server's device list.
    static var deviceName: String {
        UIDevice.current.name
    }

    func pair(with scannedValue: String) async {
        switch PairingScan(scannedValue: scannedValue) {
        case let .pairing(pairing):
            await redeemPairingPayload(pairing)
        case let .unsupportedServerURL(url):
            errorMessage = SottoServerURLPolicy.unsupportedMessage(for: url)
        case let .serverURL(url):
            errorMessage = "That QR opens \(url.host() ?? "your Sotto server") in a browser. Open Settings > Devices there, tap Show pairing code, and scan the QR it shows instead."
        case .invalid:
            errorMessage = "That is not a Sotto pairing QR. In Settings > Devices on your server, tap Show pairing code and scan that QR."
        }
    }

    /// Pairs from a typed server address instead of a scanned QR: open the
    /// instance gate with the household password, ask that server for a
    /// one-time token, then redeem it exactly as a scan would. Only the
    /// resulting API key is stored; the password is never persisted.
    func pairWithServer(urlText: String, password: String) async {
        guard !isLoading else {
            return
        }

        guard let serverURL = SottoAppModel.serverURL(fromTyped: urlText) else {
            errorMessage = "That is not a web address Sotto can reach. Try something like sotto.example.com."
            return
        }

        guard SottoServerURLPolicy.isSupported(serverURL) else {
            errorMessage = SottoServerURLPolicy.unsupportedMessage(for: serverURL)
            return
        }

        let trimmedPassword = password.trimmingCharacters(in: .whitespacesAndNewlines)
        let client = SottoAPIClient(serverURL: serverURL, apiKey: nil)

        do {
            if !trimmedPassword.isEmpty {
                try await client.openGate(password: trimmedPassword)
            }
            let pairing = try await client.requestPairingToken(deviceName: SottoAppModel.deviceName)
            await redeemPairingPayload(PairingPayload(serverURL: serverURL, token: pairing.token))
        } catch {
            errorMessage = SottoAppModel.pairingFailureMessage(
                for: error,
                host: serverURL.host() ?? "that server",
                sentPassword: !trimmedPassword.isEmpty
            )
        }
    }

    /// Accepts what a person actually types: a bare host, or a full URL. A bare
    /// host becomes HTTPS, which `SottoServerURLPolicy` then has the final say on.
    nonisolated static func serverURL(fromTyped value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(" ") else {
            return nil
        }

        let candidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard
            let components = URLComponents(string: candidate),
            let scheme = components.scheme,
            let host = components.host,
            !host.isEmpty
        else {
            return nil
        }

        var base = URLComponents()
        base.scheme = scheme
        base.host = host
        base.port = components.port
        return base.url
    }

    /// The gate answers 401 "Wrong password"; the proxy answers a bare 401
    /// "Unauthorized" when no gate cookie reached it at all. Both would read as
    /// nothing but a status code otherwise, so name the actual problem.
    nonisolated static func pairingFailureMessage(for error: Error, host: String, sentPassword: Bool) -> String {
        let text = error.localizedDescription

        if text.localizedCaseInsensitiveContains("wrong password") {
            return "That password did not open \(host)."
        }

        if text.localizedCaseInsensitiveContains("unauthorized") {
            return sentPassword
                ? "\(host) refused the pairing request. Check the access password and try again."
                : "\(host) is password protected. Enter its access password to pair."
        }

        return text
    }
}

enum PairingScan {
    case pairing(PairingPayload)
    case unsupportedServerURL(URL)
    case serverURL(URL)
    case invalid

    init(scannedValue: String) {
        if let pairing = PairingPayload(scannedValue: scannedValue) {
            self = SottoServerURLPolicy.isSupported(pairing.serverURL)
                ? .pairing(pairing)
                : .unsupportedServerURL(pairing.serverURL)
            return
        }

        guard
            let url = URL(string: scannedValue),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https",
            url.host() != nil
        else {
            self = .invalid
            return
        }

        self = SottoServerURLPolicy.isSupported(url)
            ? .serverURL(url)
            : .unsupportedServerURL(url)
    }
}

struct PairingPayload {
    let serverURL: URL
    let token: String

    init(serverURL: URL, token: String) {
        self.serverURL = serverURL
        self.token = token
    }

    init?(scannedValue: String) {
        guard
            let url = URL(string: scannedValue),
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let token = components.queryItems?.first(where: { $0.name == "token" })?.value,
            !token.isEmpty,
            let scheme = components.scheme,
            let host = components.host
        else {
            return nil
        }

        var base = URLComponents()
        base.scheme = scheme
        base.host = host
        base.port = components.port

        guard let serverURL = base.url else { return nil }
        self.serverURL = serverURL
        self.token = token
    }
}
