import Foundation

enum SottoAPIError: LocalizedError {
    case message(String)
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case let .message(value), let .http(_, value): value
        }
    }
}
