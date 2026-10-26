import Foundation

struct SottoListeningTurn: Decodable, Equatable, Identifiable {
    let id: String
    let speaker: String
    let text: String?
    let audioUrl: String?
    let order: Int
    let startTime: Double?
    let duration: Double?

    func contains(time: Double) -> Bool {
        guard time.isFinite, let startTime, let duration,
              startTime.isFinite, duration.isFinite,
              startTime >= 0, duration > 0 else { return false }
        return time >= startTime && time < startTime + duration
    }
}
