import PencilKit
import SwiftUI

struct WorkbookView: View {
    @Environment(\.dismiss) private var dismiss
    let response: SottoWorksheetResponse

    @State private var pencilRecognized = false

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                worksheetPane
                    .frame(minWidth: 360, idealWidth: 460, maxWidth: 520)

                Divider()

                VStack(spacing: 0) {
                    PencilStatusBar(isRecognized: pencilRecognized)
                    PencilCanvasView(pencilRecognized: $pencilRecognized)
                        .background(Color.white)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(SottoTheme.paper)
            .navigationTitle(response.document.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                if let pdfUrl = response.worksheetPdfUrl, let url = URL(string: pdfUrl) {
                    ToolbarItem(placement: .primaryAction) {
                        Link(destination: url) {
                            Label("PDF", systemImage: "doc.richtext")
                        }
                    }
                }
            }
        }
    }

    private var worksheetPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(response.document.title)
                        .font(.system(size: 34, weight: .bold, design: .serif))
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(response.document.objective)
                        .font(.body)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(response.document.nativeLang.uppercased()) -> \(response.document.targetLang.uppercased()) / \(response.document.level)")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.primary)
                }

                ForEach(response.document.sections) { section in
                    WorkbookSectionView(section: section)
                }
            }
            .padding(24)
        }
        .background(SottoTheme.paper)
    }
}

private struct WorkbookSectionView: View {
    let section: SottoDocumentSection

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(section.title)
                    .font(.title3.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text(section.instructions)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }

            ForEach(section.questions.sorted { $0.order < $1.order }) { question in
                VStack(alignment: .leading, spacing: 8) {
                    Text(question.question)
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        Text("\(index + 1). \(option)")
                            .font(.body)
                            .foregroundStyle(SottoTheme.muted)
                    }
                }
            }

            ForEach(section.prompts) { prompt in
                Text("\(prompt.targetPhrase) - \(prompt.translation)")
                    .font(.body)
                    .foregroundStyle(SottoTheme.muted)
            }

            ForEach(section.writingPrompts) { prompt in
                Text(prompt.task)
                    .font(.body)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

private struct PencilStatusBar: View {
    let isRecognized: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: isRecognized ? "pencil.tip.crop.circle.badge.checkmark" : "pencil.tip.crop.circle")
                .font(.title2)
                .foregroundStyle(isRecognized ? SottoTheme.success : SottoTheme.primary)
            VStack(alignment: .leading, spacing: 2) {
                Text(isRecognized ? "Apple Pencil recognized" : "Waiting for Apple Pencil")
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                Text(isRecognized ? "Write anywhere on the sheet. Finger input keeps scrolling and tapping predictable." : "Touch the canvas with Apple Pencil to start a notes layer.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }
            Spacer()
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(SottoTheme.surface)
        .overlay(Rectangle().fill(SottoTheme.line).frame(height: 1), alignment: .bottom)
    }
}

struct PencilCanvasView: UIViewRepresentable {
    @Binding var pencilRecognized: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(pencilRecognized: $pencilRecognized)
    }

    func makeUIView(context: Context) -> PKCanvasView {
        let canvas = PKCanvasView()
        canvas.delegate = context.coordinator
        canvas.drawingPolicy = .pencilOnly
        canvas.backgroundColor = .white
        canvas.alwaysBounceVertical = true
        canvas.tool = PKInkingTool(.pen, color: .black, width: 4)

        let toolPicker = PKToolPicker()
        toolPicker.addObserver(canvas)
        toolPicker.setVisible(true, forFirstResponder: canvas)
        context.coordinator.toolPicker = toolPicker
        canvas.becomeFirstResponder()

        return canvas
    }

    func updateUIView(_ canvas: PKCanvasView, context: Context) {
        if !canvas.isFirstResponder {
            canvas.becomeFirstResponder()
        }
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        @Binding private var pencilRecognized: Bool
        var toolPicker: PKToolPicker?

        init(pencilRecognized: Binding<Bool>) {
            _pencilRecognized = pencilRecognized
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            if !canvasView.drawing.strokes.isEmpty {
                pencilRecognized = true
            }
        }
    }
}
