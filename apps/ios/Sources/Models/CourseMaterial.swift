import Foundation

struct SottoCourseMaterial: Decodable, Equatable, Identifiable {
    let id: String
    let name: String
    let mimeType: String
    let byteSize: Int
    let extractedText: String
}
