import Foundation

enum PencilAnswer: Equatable {
    case choice(Int)
    case writing(String)
}

struct SottoPencilProposal: Codable, Equatable {
    let selectedIndex: Int?
    let text: String?
    let observations: [String]
    let uncertainties: [String]
}

struct SottoPencilInterpretation: Decodable {
    let status: String
    let operationId: UUID
    let proposal: SottoPencilProposal?
    let error: String?
}

struct SottoPencilRequest: Encodable {
    let requestId: UUID
    let attempt: Int
    let taskKind: String
    let taskId: String
    let image: String
}
