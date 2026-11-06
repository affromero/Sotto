import Foundation

enum SottoVocabularyMode: String, CaseIterable, Identifiable, Codable {
    case flashcards = "FLASHCARDS"
    case meaning = "MEANING_RECALL"
    case word = "WORD_RECALL"
    case listening = "LISTENING_RECALL"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .flashcards: return "Flashcards"
        case .meaning: return "Remember the meaning"
        case .word: return "Find the word"
        case .listening: return "Listen and remember"
        }
    }
}

struct SottoVocabularyCard: Decodable, Equatable, Identifiable {
    let id: String
    let prompt: String
    let feedback: SottoVocabularyFeedback?
}

struct SottoVocabularyFeedback: Decodable, Equatable {
    let outcome: String
    let lemma: String
    let meaning: String
    let answer: String
    let correct: Bool?
}

struct SottoVocabularyReceipt: Decodable, Equatable {
    let correct: Int
    let total: Int
    let studied: Int
}

struct SottoVocabularyAdmission: Codable, Equatable {
    let requestId: String
    let mode: SottoVocabularyMode
    var wordIds: [String]?
}

struct SottoVocabularyAction: Codable, Equatable {
    let action: String
    let expectedRevision: Int
    var itemId: String?
    var answer: String?
}

struct SottoVocabularyAudioRequest: Encodable { let retry: Bool }
struct SottoVocabularyAudioStatus: Decodable { let status: String; let error: String? }
struct SottoVocabularyImportResult: Decodable { let status: String }

struct SottoDictionary: Decodable {
    struct Counts: Decodable { let unseen: Int; let due: Int; let strong: Int }
    let words: [SottoDictionaryWord]
    let total: Int
    let page: Int
    let pages: Int
    let counts: Counts
    let vocabularySupport: String?
    let materials: [SottoVocabularyImport]
}

struct SottoDictionaryWord: Decodable, Identifiable {
    struct Source: Decodable {
        let name: String
        let quote: String
        let meaning: String
        let materialId: String
    }
    let id: String
    let lemma: String
    let translation: String
    let acceptedMeanings: [String]
    let partOfSpeech: String?
    let state: String
    let mastery: Double
    let reviews: Int
    let dueAt: String?
    let lastReviewed: String?
    let sourceCount: Int
    let sources: [Source]
}

struct SottoVocabularyImport: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let error: String?
    let processedChunks: Int
    let totalChunks: Int
    let entries: Int
}

struct SottoVocabularyMeaning: Encodable {
    let translation: String
    let acceptedMeanings: [String]
}

struct SottoVocabularySaved: Decodable { let saved: Bool }
struct SottoVocabularySupport: Codable {
    let vocabularySupport: String?
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(vocabularySupport, forKey: .vocabularySupport)
    }
}
