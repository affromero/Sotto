import Foundation

struct SottoClassTeaching: Decodable, Equatable {
    let version: Int
    let title: String
    let explanation: String
    let workedExamples: [SottoWorkedExample]
    let commonMistake: SottoCommonMistake
    let guidedPractice: SottoGuidedPractice
}

struct SottoWorkedExample: Decodable, Equatable {
    let prompt: String
    let answer: String
    let explanation: String
}

struct SottoCommonMistake: Decodable, Equatable {
    let incorrect: String
    let correction: String
    let explanation: String
}

struct SottoGuidedPractice: Decodable, Equatable {
    let prompt: String
    let hint: String
    let answer: String
    let explanation: String
}
