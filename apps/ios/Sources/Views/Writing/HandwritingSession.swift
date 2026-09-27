import PencilKit
import SwiftUI

@MainActor
final class HandwritingSession: ObservableObject {
    struct Recognition: Equatable {
        let id: UUID
        let revision: Int
    }

    @Published private(set) var drawing = PKDrawing()
    @Published var recognizedText = ""
    @Published private(set) var errorMessage: String?
    @Published private(set) var isRecognizing = false
    @Published private(set) var isSaved = false
    private let storageKey: String
    private let store: LearningInkStore
    private var hasLoaded = false
    private var persistenceReadable = true
    private var isActive = false
    private var revision = 0
    private var recognition: Recognition?

    init(storageKey: String, store: LearningInkStore = LearningInkStore()) {
        self.storageKey = storageKey
        self.store = store
    }

    func activate() {
        isActive = true
        guard !hasLoaded else { return }
        hasLoaded = true
        do {
            drawing = try store.load(storageKey)
            isSaved = true
        } catch {
            persistenceReadable = false
            errorMessage = "Your saved handwriting could not be opened. New strokes will not overwrite it. \(error.localizedDescription)"
        }
    }

    func updateDrawing(_ value: PKDrawing) {
        guard hasLoaded, drawing != value else { return }
        drawing = value
        revision += 1
        recognizedText = ""
        persist()
    }

    @discardableResult
    func flush(_ value: PKDrawing) -> Bool {
        guard hasLoaded else { return true }
        if drawing != value { updateDrawing(value) }
        else { persist() }
        return isSaved
    }

    func deactivate(flushing value: PKDrawing) {
        flush(value)
        isActive = false
        recognition = nil
        isRecognizing = false
    }

    func beginRecognition() -> Recognition? {
        guard isActive, !isRecognizing, !drawing.strokes.isEmpty else { return nil }
        let request = Recognition(id: UUID(), revision: revision)
        recognition = request
        isRecognizing = true
        recognizedText = ""
        return request
    }

    func finishRecognition(_ request: Recognition, result: Result<String, Error>) {
        guard recognition == request else { return }
        recognition = nil
        isRecognizing = false
        guard isActive, revision == request.revision else { return }
        switch result {
        case let .success(text):
            recognizedText = text
            if text.isEmpty {
                errorMessage = "No text was recognized. Try larger, clearer handwriting, or type your answer."
            } else if isSaved {
                errorMessage = nil
            }
        case let .failure(error):
            errorMessage = "Handwriting recognition failed: \(error.localizedDescription)"
        }
    }

    private func persist() {
        guard persistenceReadable else { isSaved = false; return }
        do {
            try store.save(drawing, key: storageKey)
            isSaved = true
            errorMessage = nil
        } catch {
            isSaved = false
            errorMessage = "Your handwriting could not be saved: \(error.localizedDescription)"
        }
    }
}
