import SwiftUI

@MainActor
final class LiveConversationLifecycle: ObservableObject {
    enum Phase { case idle, connecting, live }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var transcript: [String] = []
    private var awaitingConsent = false
    private var currentRequest: UUID?

    func requestConsent() {
        guard phase == .idle else { return }
        awaitingConsent = true
    }

    func declineConsent() { awaitingConsent = false }

    func acceptConsent() -> UUID? {
        guard awaitingConsent, phase == .idle else { return nil }
        awaitingConsent = false
        let request = UUID()
        currentRequest = request
        transcript.removeAll()
        phase = .connecting
        return request
    }

    func isCurrent(_ request: UUID) -> Bool { currentRequest == request }

    func opened(_ request: UUID) {
        guard isCurrent(request) else { return }
        phase = .live
    }

    func append(_ line: String, request: UUID) {
        guard isCurrent(request) else { return }
        transcript.append(line)
    }

    /// Consume once before any asynchronous socket close or transcript upload.
    func finish() -> String {
        currentRequest = nil
        awaitingConsent = false
        phase = .idle
        let text = transcript.joined(separator: "\n")
        transcript.removeAll()
        return String(text.prefix(20_000))
    }
}
