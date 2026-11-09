import Foundation

enum SottoAPIError: LocalizedError {
    case message(String)
    case http(Int, String)
    case classRecordingRejected(String)

    var errorDescription: String? {
        switch self {
        case let .message(value), let .http(_, value), let .classRecordingRejected(value): value
        }
    }
}
