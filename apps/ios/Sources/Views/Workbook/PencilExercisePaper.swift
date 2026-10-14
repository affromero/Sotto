import PencilKit
import SwiftUI
import UIKit

struct PencilExercisePaper {
    let image: UIImage
    let size: CGSize
    let digest: String

    @MainActor
    init(prompt: String, passage: String?, options: [String]) throws {
        let width: CGFloat = 800
        let textWidth: CGFloat = 704
        var lines = [(String, UIFont)]()
        lines.append((options.isEmpty ? "Write, cross out, insert, or connect words to show your answer." : "Circle or mark one choice. You can annotate the sentence before choosing.", .systemFont(ofSize: 21)))
        if let passage, !passage.isEmpty { lines.append((passage, .systemFont(ofSize: 24))) }
        lines.append((prompt, .systemFont(ofSize: 27, weight: .semibold)))
        for (index, option) in options.enumerated() { lines.append(("\(index + 1). \(option)", .systemFont(ofSize: 25))) }
        let heights = lines.map { text, font in
            ceil((text as NSString).boundingRect(with: CGSize(width: textWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font], context: nil).height)
        }
        let height = max(700, 96 + heights.reduce(0, +) + CGFloat(lines.count) * 22 + (options.isEmpty ? 500 : 220))
        guard height <= 6000 else { throw SottoAPIError.message("This exercise is too long for one Pencil page. Use the class answer editor.") }
        size = CGSize(width: width, height: height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: CGSize(width: width, height: height)))
            var y: CGFloat = 48
            for (index, line) in lines.enumerated() {
                (line.0 as NSString).draw(with: CGRect(x: 48, y: y, width: textWidth, height: heights[index]),
                    options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: line.1, .foregroundColor: UIColor.black], context: nil)
                y += heights[index] + 22
            }
        }
        digest = Self.taskDigest(prompt: prompt, passage: passage, options: options)
    }

    static func taskDigest(prompt: String, passage: String?, options: [String]) -> String {
        let material = ([prompt, passage ?? ""] + options).map { "\($0.utf8.count):\($0)" }.joined()
        return LearningInkStore.digest(Data(material.utf8))
    }

    @MainActor
    func answerImage(drawing: PKDrawing) throws -> String {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let snapshot = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(at: .zero)
            drawing.image(from: CGRect(origin: .zero, size: size), scale: 1).draw(at: .zero)
        }
        guard let bytes = snapshot.jpegData(compressionQuality: 0.85), bytes.count <= 1_500_000 else {
            throw SottoAPIError.message("This answer image is too large to review. Reduce the marks or use the answer editor.")
        }
        return "data:image/jpeg;base64," + bytes.base64EncodedString()
    }
}

struct PencilExerciseCanvas: UIViewRepresentable {
    let paper: PencilExercisePaper
    let canvas: PKCanvasView
    let picker: PKToolPicker
    @Binding var drawing: PKDrawing

    func makeCoordinator() -> Coordinator { Coordinator(drawing: $drawing, picker: picker) }
    func makeUIView(context: Context) -> InkPaperView {
        canvas.drawingPolicy = .pencilOnly
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.isScrollEnabled = false
        canvas.delegate = context.coordinator
        canvas.tool = PKInkingTool(.pen, color: .systemBlue, width: 3)
        let view = InkPaperView(canvas: canvas, pageSize: paper.size, backgroundImage: paper.image)
        context.coordinator.picker.showsDrawingPolicyControls = false
        context.coordinator.picker.addObserver(canvas)
        view.onAttached = { [weak canvas, weak coordinator = context.coordinator] in
            guard let canvas, let coordinator else { return }
            guard !coordinator.picker.isVisible else { return }
            coordinator.picker.setVisible(true, forFirstResponder: canvas)
            canvas.becomeFirstResponder()
        }
        return view
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
        let picker: PKToolPicker
        init(drawing: Binding<PKDrawing>, picker: PKToolPicker) { self.drawing = drawing; self.picker = picker }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { drawing.wrappedValue = canvasView.drawing }
        func canvasViewDidBeginUsingTool(_ canvasView: PKCanvasView) {
            picker.setVisible(true, forFirstResponder: canvasView)
            canvasView.becomeFirstResponder()
        }
    }
}
