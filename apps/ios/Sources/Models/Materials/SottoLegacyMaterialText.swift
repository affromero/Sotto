import Foundation

struct SottoLegacyMaterialText: Decodable {
    let materialId: String
    let origin: String
    let offset: Int
    let totalCodePoints: Int
    let text: String
    let nextOffset: Int?
}
