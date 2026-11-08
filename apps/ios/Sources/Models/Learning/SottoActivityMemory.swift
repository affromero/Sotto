import Foundation

// MARK: - Activity

/// `GET /api/v1/learn/activity`: one year of study days, bucketed in the learner's
/// timezone by the server, plus streaks.
struct SottoActivity: Decodable, Equatable {
    let timeZone: String
    let todayIso: String
    /// ISO local day (YYYY-MM-DD) -> per-category counts. Quiet days are absent.
    let days: [String: [String: Int]]
    let currentStreak: Int
    let longestStreak: Int

    func total(on day: String) -> Int {
        days[day]?.values.reduce(0, +) ?? 0
    }

    /// The category a day is coloured by: whichever the learner did most of,
    /// ties broken by name so the colour does not flicker between loads.
    func dominantCategory(on day: String) -> String? {
        guard let counts = days[day], !counts.isEmpty else { return nil }
        return counts.max { lhs, rhs in
            lhs.value == rhs.value ? lhs.key > rhs.key : lhs.value < rhs.value
        }?.key
    }
}

// MARK: - Memory graph

/// `GET /api/v1/courses/{id}/graph`: every word and grammar point the learner
/// has met on this course, with its spaced-repetition state.
struct SottoMemoryGraph: Decodable, Equatable {
    let nodes: [SottoMemoryNode]

    var dueNodes: [SottoMemoryNode] { nodes.filter(\.due) }

    /// Weak-first, so the list opens on what needs work.
    var byStrength: [SottoMemoryNode] {
        nodes.sorted { $0.strength < $1.strength }
    }
}

struct SottoMemoryNode: Decodable, Identifiable, Equatable {
    let id: String
    let kind: String
    let label: String
    let translation: String?
    let strength: Double
    let due: Bool
    let cefrLevel: String?
    let reviewCount: Int
    let lapseCount: Int
    let partOfSpeech: String?
    let pronunciation: String?
    let topicKey: String?

    var isVocab: Bool { kind == "vocab" }
}
