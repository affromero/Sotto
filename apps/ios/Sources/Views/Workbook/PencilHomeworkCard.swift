import PencilKit
import SwiftUI

enum PencilExercise {
    case question(SottoQuestion)
    case writing(SottoWritingPrompt)

    var id: String { switch self { case .question(let q): q.id; case .writing(let p): p.id } }
    var kind: String { switch self { case .question: "QUESTION"; case .writing: "WRITING" } }
    var prompt: String { switch self { case .question(let q): q.question; case .writing(let p): p.task } }
    var passage: String? { switch self { case .question(let q): q.passageText; case .writing(let p): p.guidance } }
    var options: [String] { switch self { case .question(let q): q.options; case .writing: [] } }
}

struct PencilHomeworkCard: View {
    @EnvironmentObject private var model: SottoAppModel
    let classId: String
    let attempt: Int
    let exercise: PencilExercise
    let toolPicker: PKToolPicker
    let confirmedAnswer: PencilAnswer?
    let onUseAnswer: (PencilAnswer) -> Void
    let onReviewRequired: (Bool) -> Void
    @State private var paper: PencilExercisePaper?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let paper, let credentials = model.credentials, let profile = credentials.selectedProfile {
                let key = LearningInkStore.scope(server: credentials.serverURL, profileID: profile.id,
                    activity: "pencil/v1/\(classId)/\(attempt)/\(exercise.id)/\(paper.digest)")
                PencilHomeworkAnswerView(classId: classId, attempt: attempt, exercise: exercise, paper: paper,
                    storageKey: key, toolPicker: toolPicker, confirmedAnswer: confirmedAnswer, onUseAnswer: onUseAnswer,
                    onReviewRequired: onReviewRequired)
                    .id(key)
            } else if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
        .onAppear {
            do { paper = try PencilExercisePaper(prompt: exercise.prompt, passage: exercise.passage, options: exercise.options) }
            catch { errorMessage = error.localizedDescription }
        }
    }
}

private struct PencilHomeworkAnswerView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.scenePhase) private var scenePhase
    let classId: String
    let attempt: Int
    let exercise: PencilExercise
    let paper: PencilExercisePaper
    let storageKey: String
    let toolPicker: PKToolPicker
    let confirmedAnswer: PencilAnswer?
    let onUseAnswer: (PencilAnswer) -> Void
    let onReviewRequired: (Bool) -> Void
    @StateObject private var ink: HandwritingSession
    @State private var canvas = PKCanvasView()
    @State private var review: PencilReviewStore.Review?
    @State private var proposal: SottoPencilProposal?
    @State private var selectedIndex = -1
    @State private var answerText = ""
    @State private var errorMessage: String?
    @State private var reviewReadable = true
    @State private var isReading = false
    @State private var readingID: UUID?
    @State private var task: Task<Void, Never>?
    @State private var showClear = false
    private let reviews = PencilReviewStore()

    init(classId: String, attempt: Int, exercise: PencilExercise, paper: PencilExercisePaper,
         storageKey: String, toolPicker: PKToolPicker, confirmedAnswer: PencilAnswer?, onUseAnswer: @escaping (PencilAnswer) -> Void,
         onReviewRequired: @escaping (Bool) -> Void) {
        self.classId = classId
        self.attempt = attempt
        self.exercise = exercise
        self.paper = paper
        self.storageKey = storageKey
        self.toolPicker = toolPicker
        self.confirmedAnswer = confirmedAnswer
        self.onUseAnswer = onUseAnswer
        self.onReviewRequired = onReviewRequired
        _ink = StateObject(wrappedValue: HandwritingSession(storageKey: storageKey))
    }

    private var digest: String { LearningInkStore.drawingDigest(ink.drawing) }
    private var isConfirmed: Bool {
        guard let review, review.accepted, review.inkDigest == digest else { return false }
        switch confirmedAnswer {
        case .choice(let index): return review.acceptedIndex == index
        case .writing(let text): return review.acceptedText == text
        case nil: return false
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PencilExerciseCanvas(paper: paper, canvas: canvas, picker: toolPicker,
                drawing: Binding(get: { ink.drawing }, set: { ink.updateDrawing($0) }))
                .aspectRatio(paper.size.width / paper.size.height, contentMode: .fit)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("\(exercise.prompt). Pencil answer area. \(exercise.options.joined(separator: ", "))")
            HStack {
                Button("Undo", systemImage: "arrow.uturn.backward") { canvas.undoManager?.undo() }
                Button("Redo", systemImage: "arrow.uturn.forward") { canvas.undoManager?.redo() }
                Spacer()
                Button("Clear", systemImage: "trash", role: .destructive) { showClear = true }
            }.buttonStyle(.bordered).controlSize(.large)
            Text("Read my marks sends an image of this exercise and your ink to your server and its selected AI provider. Review the interpretation before using it as your class answer.")
                .font(.caption).foregroundStyle(SottoTheme.muted)
            Button(isReading ? "Reading your marks" : "Read my marks", systemImage: "eye") {
                task = Task { await readMarks() }
            }
            .buttonStyle(SottoPrimaryButtonStyle())
            .disabled(ink.drawing.strokes.isEmpty || isReading || !ink.isSaved || !reviewReadable)
            if isReading { ProgressView("Interpreting the exercise and your handwriting") }
            if let proposal {
                Text("Check what was read").font(.headline)
                ForEach(Array(proposal.observations.enumerated()), id: \.offset) { _, text in Text(text).font(.callout) }
                ForEach(Array(proposal.uncertainties.enumerated()), id: \.offset) { _, text in
                    Label(text, systemImage: "questionmark.circle").foregroundStyle(SottoTheme.primary)
                }
                if exercise.kind == "QUESTION" {
                    Picker("Your selected answer", selection: $selectedIndex) {
                        Text("Choose your answer").tag(-1)
                        ForEach(Array(exercise.options.enumerated()), id: \.offset) { index, option in
                            Text("\(index + 1). \(option)").tag(index)
                        }
                    }.pickerStyle(.menu).controlSize(.large)
                } else {
                    TextEditor(text: $answerText).frame(minHeight: 150)
                        .accessibilityLabel("Your interpreted answer, editable")
                        .background(SottoTheme.surface)
                }
                Button("Use reviewed answer", systemImage: "checkmark") { acceptAnswer() }
                    .buttonStyle(SottoPrimaryButtonStyle())
                    .disabled(isReading || (exercise.kind == "QUESTION" ? selectedIndex < 0 :
                        answerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || answerText.count > 4000))
            }
            if let error = ink.errorMessage ?? errorMessage { Text(error).foregroundStyle(.red) }
            if !ink.drawing.strokes.isEmpty {
                Text(isConfirmed ? "Reviewed answer added to the class. Submit below when you are ready." : "Ink is saved on this device. Review this answer before submitting the class.")
                    .font(.caption).foregroundStyle(SottoTheme.muted)
            }
        }
        .onAppear {
            ink.activate()
            do { review = try reviews.load(key: storageKey) }
            catch { reviewReadable = false; errorMessage = "The saved answer review could not be opened. It will not be overwritten. \(error.localizedDescription)" }
            reportReviewState()
        }
        .onChange(of: ink.drawing) { _, _ in
            task?.cancel()
            readingID = nil
            isReading = false
            proposal = nil
            reportReviewState()
        }
        .onChange(of: confirmedAnswer) { _, _ in reportReviewState() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { ink.activate() }
            else { task?.cancel(); readingID = nil; isReading = false; ink.deactivate(flushing: canvas.drawing) }
        }
        .onDisappear { task?.cancel(); ink.deactivate(flushing: canvas.drawing) }
        .confirmationDialog("Clear this answer's ink?", isPresented: $showClear) {
            Button("Clear ink", role: .destructive) { canvas.drawing = PKDrawing(); ink.updateDrawing(canvas.drawing) }
        }
    }

    private func reportReviewState() { onReviewRequired(!ink.drawing.strokes.isEmpty && !isConfirmed) }

    @MainActor
    private func readMarks() async {
        let capturedDigest = digest
        let requestToken = UUID()
        readingID = requestToken
        isReading = true
        errorMessage = nil
        defer {
            if readingID == requestToken { readingID = nil; isReading = false }
        }
        do {
            if review?.inkDigest != capturedDigest || review?.image == nil {
                var pending = PencilReviewStore.Review(inkDigest: capturedDigest, requestId: UUID())
                pending.image = try paper.answerImage(drawing: ink.drawing)
                try reviews.save(pending, key: storageKey)
                review = pending
            }
            guard let review, let image = review.image else { throw SottoAPIError.message("The review attempt could not be saved.") }
            let result = try await model.interpretPencilAnswer(classId: classId, answer: SottoPencilRequest(
                requestId: review.requestId, attempt: attempt, taskKind: exercise.kind, taskId: exercise.id,
                image: image))
            try Task.checkCancellation()
            guard readingID == requestToken, digest == capturedDigest else { return }
            guard result.selectedIndex == nil || exercise.options.indices.contains(result.selectedIndex!) else {
                throw SottoAPIError.message("The interpreted choice does not belong to this question.")
            }
            proposal = result
            selectedIndex = result.selectedIndex ?? -1
            answerText = result.text ?? ""
        } catch {
            if !Task.isCancelled { errorMessage = SottoWritingFailure.message(for: error) }
        }
    }

    private func acceptAnswer() {
        guard var review, review.inkDigest == digest, proposal != nil, ink.flush(canvas.drawing) else { return }
        let answer: PencilAnswer
        if exercise.kind == "QUESTION" {
            guard exercise.options.indices.contains(selectedIndex) else { return }
            review.acceptedIndex = selectedIndex
            answer = .choice(selectedIndex)
        } else {
            let text = answerText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text.count <= 4000 else { return }
            review.acceptedText = text
            answer = .writing(text)
        }
        review.accepted = true
        do {
            try reviews.save(review, key: storageKey)
            self.review = review
            onUseAnswer(answer)
            onReviewRequired(false)
            proposal = nil
        } catch { errorMessage = "Your reviewed answer could not be saved. \(error.localizedDescription)" }
    }
}
