import Foundation
import Security

protocol SottoCredentialPersistence {
    func load() throws -> SottoCredentials?
    func save(_ credentials: SottoCredentials) throws
    func delete() throws
}

struct CredentialStore: SottoCredentialPersistence {
    private let service = "fm.sotto.app"
    private let account: String

    init(account: String = "default") { self.account = account }

    func load() throws -> SottoCredentials? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError.unhandled(status)
        }

        return try JSONDecoder().decode(SottoCredentials.self, from: data)
    }

    func save(_ credentials: SottoCredentials) throws {
        let data = try JSONEncoder().encode(credentials)
        var query = baseQuery()

        let status = SecItemCopyMatching(query as CFDictionary, nil)
        if status == errSecItemNotFound {
            query[kSecValueData as String] = data
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(query as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw KeychainError.unhandled(addStatus)
            }
            return
        }

        guard status == errSecSuccess else {
            throw KeychainError.unhandled(status)
        }

        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        guard updateStatus == errSecSuccess else {
            throw KeychainError.unhandled(updateStatus)
        }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw KeychainError.unhandled(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

enum KeychainError: LocalizedError {
    case unhandled(OSStatus)

    var errorDescription: String? {
        switch self {
        case let .unhandled(status):
            "Keychain operation failed with status \(status)."
        }
    }
}
