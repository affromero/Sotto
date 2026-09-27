import PencilKit
import SwiftUI
import Vision

struct HandwritingView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let title: String
    let storageKey: String
    let onUseText: (String) -> Void

    @StateObject private var session: HandwritingSession
    @State private var showClearConfirmation = false
    @State private var canvas = PKCanvasView()
    @State private var showUnsavedConfirmation = false

    init(title: String, storageKey: String, onUseText: @escaping (String) -> Void) {
        self.title = title
        self.storageKey = storageKey
        self.onUseText = onUseText
        _session = StateObject(wrappedValue: HandwritingSession(storageKey: storageKey))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(title).font(.title3).fixedSize(horizontal: false, vertical: true)
                    Text("Write with Apple Pencil. Convert your handwriting on this device, then check the text before using it as your answer.")
                        .font(.callout).foregroundStyle(SottoTheme.muted)
                    HandwritingCanvas(canvas: canvas, drawing: Binding(get: { session.drawing }, set: { session.updateDrawing($0) }))
                        .aspectRatio(4 / 3, contentMode: .fit)
                        .background(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .accessibilityLabel("Handwriting canvas. Use Apple Pencil to write your answer.")
                    HStack {
                        Button("Undo", systemImage: "arrow.uturn.backward") { canvas.undoManager?.undo() }
                        Button("Redo", systemImage: "arrow.uturn.forward") { canvas.undoManager?.redo() }
                        Spacer()
                        Button("Clear", systemImage: "trash", role: .destructive) { showClearConfirmation = true }
                    }
                    .buttonStyle(.bordered).controlSize(.large)
                    Button(session.isRecognizing ? "Reading handwriting" : "Convert to text", systemImage: "text.viewfinder") {
                        Task { await recognize() }
                    }
                    .buttonStyle(SottoPrimaryButtonStyle())
                    .disabled(session.drawing.strokes.isEmpty || session.isRecognizing)
                    if let errorMessage = session.errorMessage {
                        Text(errorMessage).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently)
                    }
                    if !session.recognizedText.isEmpty {
                        Text("Check your answer").font(.headline)
                        TextEditor(text: $session.recognizedText)
                            .frame(minHeight: 140).padding(8)
                            .background(SottoTheme.surface)
                            .accessibilityLabel("Recognized answer, editable")
                        Button("Use this answer", systemImage: "checkmark") {
                            session.flush(canvas.drawing)
                            let answer = session.recognizedText
                            guard !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                            onUseText(answer)
                            dismiss()
                        }
                        .buttonStyle(SottoPrimaryButtonStyle())
                        .disabled(session.isRecognizing || session.recognizedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    Text(session.isSaved ? "Ink is saved on this device. Only the text you choose to submit is sent for feedback." : "Ink could not be saved. Keep this sheet open to recover your answer as text.")
                        .font(.caption).foregroundStyle(SottoTheme.muted)
                }
                .padding(20)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Write by hand")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Done") {
                    if session.flush(canvas.drawing) { dismiss() }
                    else { showUnsavedConfirmation = true }
                }
            } }
            .onAppear {
                session.activate()
                canvas.drawing = session.drawing
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { session.activate() }
                else { session.deactivate(flushing: canvas.drawing) }
            }
            .onDisappear { session.deactivate(flushing: canvas.drawing) }
            .interactiveDismissDisabled(!session.isSaved)
            .confirmationDialog("Leave without saving ink?", isPresented: $showUnsavedConfirmation, titleVisibility: .visible) {
                Button("Leave without saving", role: .destructive) { dismiss() }
            } message: {
                Text(session.errorMessage ?? "Your latest handwriting could not be saved.")
            }
            .confirmationDialog("Clear this handwriting?", isPresented: $showClearConfirmation) {
                Button("Clear handwriting", role: .destructive) {
                    canvas.drawing = PKDrawing()
                    session.updateDrawing(canvas.drawing)
                }
            }
        }
    }

    @MainActor private func recognize() async {
        guard let request = session.beginRecognition() else { return }
        let drawing = session.drawing
        let bounds = drawing.bounds.insetBy(dx: -20, dy: -20)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 2
        format.opaque = true
        let ink = drawing.image(from: bounds, scale: 2)
        let image = UIGraphicsImageRenderer(size: bounds.size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: bounds.size))
            ink.draw(at: .zero)
        }
        guard let cgImage = image.cgImage else {
            session.finishRecognition(request, result: .failure(SottoAPIError.message("The handwriting image could not be prepared.")))
            return
        }
        do {
            let result = try await HandwritingRecognition.read(cgImage)
            session.finishRecognition(request, result: .success(result))
        } catch { session.finishRecognition(request, result: .failure(error)) }
    }
}

enum HandwritingRecognition {
    static func read(_ image: CGImage) async throws -> String {
        try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.automaticallyDetectsLanguage = true
            request.usesLanguageCorrection = false
            try VNImageRequestHandler(cgImage: image).perform([request])
            return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
        }.value
    }
}

/// Fixed paper coordinates preserve ink when the sheet changes width.
struct HandwritingCanvas: UIViewRepresentable {
    let canvas: PKCanvasView
    @Binding var drawing: PKDrawing

    func makeCoordinator() -> Coordinator { Coordinator(drawing: $drawing) }

    func makeUIView(context: Context) -> InkPaperView {
        canvas.drawingPolicy = .pencilOnly
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.isScrollEnabled = false
        canvas.delegate = context.coordinator
        canvas.tool = PKInkingTool(.pen, color: .black, width: 3)
        let paper = InkPaperView(canvas: canvas, pageSize: CGSize(width: 800, height: 600))
        context.coordinator.picker.addObserver(canvas)
        paper.onAttached = { [weak coordinator = context.coordinator, weak canvas] in
            guard let coordinator, let canvas, !coordinator.didActivate else { return }
            coordinator.didActivate = true
            coordinator.picker.setVisible(true, forFirstResponder: canvas)
            canvas.becomeFirstResponder()
        }
        return paper
    }

    func updateUIView(_ view: InkPaperView, context: Context) {
        context.coordinator.drawing = $drawing
        if canvas.drawing != drawing { canvas.drawing = drawing }
    }

    static func dismantleUIView(_ view: InkPaperView, coordinator: Coordinator) {
        coordinator.picker.setVisible(false, forFirstResponder: view.canvas)
        coordinator.picker.removeObserver(view.canvas)
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        var drawing: Binding<PKDrawing>
        let picker = PKToolPicker()
        var didActivate = false
        init(drawing: Binding<PKDrawing>) { self.drawing = drawing }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { drawing.wrappedValue = canvasView.drawing }
        func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
            picker.setVisible(true, forFirstResponder: canvasView)
            canvasView.becomeFirstResponder()
        }
    }
}

final class InkPaperView: UIView {
    let canvas: PKCanvasView
    let pageSize: CGSize
    var onAttached: (() -> Void)?

    init(canvas: PKCanvasView, pageSize: CGSize) {
        self.canvas = canvas
        self.pageSize = pageSize
        super.init(frame: .zero)
        addSubview(canvas)
        clipsToBounds = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init(canvas:pageSize:)") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { onAttached?() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        canvas.transform = .identity
        canvas.bounds = CGRect(origin: .zero, size: pageSize)
        canvas.center = CGPoint(x: bounds.midX, y: bounds.midY)
        let scale = min(bounds.width / pageSize.width, bounds.height / pageSize.height)
        canvas.transform = CGAffineTransform(scaleX: scale, y: scale)
    }
}
