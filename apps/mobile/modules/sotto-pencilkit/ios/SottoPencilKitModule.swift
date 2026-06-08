import ExpoModulesCore
import PencilKit
import UIKit

// ---------------------------------------------------------------------------
// MARK: - Canvas delegate bridge
// ---------------------------------------------------------------------------

/// Captures PKCanvasViewDelegate callbacks and routes them to the Expo view.
private final class CanvasDelegate: NSObject, PKCanvasViewDelegate {
  weak var view: SottoPencilKitView?

  func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
    view?.emitDrawingChange()
  }
}

// ---------------------------------------------------------------------------
// MARK: - Expo view
// ---------------------------------------------------------------------------

final class SottoPencilKitView: ExpoView {
  // Expo event emitter — wired up by ExpoModulesCore
  let onChangeEvent = EventDispatcher()

  private let canvas = PKCanvasView()
  private let delegate = CanvasDelegate()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    setupCanvas()
  }

  private func setupCanvas() {
    delegate.view = self
    canvas.delegate = delegate
    canvas.backgroundColor = .clear
    canvas.isOpaque = false
    // Allow any input (Apple Pencil, finger, or stylus)
    canvas.drawingPolicy = .anyInput
    canvas.translatesAutoresizingMaskIntoConstraints = false
    addSubview(canvas)
    NSLayoutConstraint.activate([
      canvas.topAnchor.constraint(equalTo: topAnchor),
      canvas.leadingAnchor.constraint(equalTo: leadingAnchor),
      canvas.trailingAnchor.constraint(equalTo: trailingAnchor),
      canvas.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  // MARK: - Prop handlers

  /// Accepts a base64-encoded PKDrawing and restores it onto the canvas.
  func setInitialStrokes(_ base64: String?) {
    guard let base64 = base64, !base64.isEmpty else { return }
    guard let data = Data(base64Encoded: base64) else { return }
    do {
      let drawing = try PKDrawing(data: data)
      canvas.drawing = drawing
    } catch {
      // Invalid data — leave the canvas empty rather than crashing.
    }
  }

  // MARK: - Event emission

  func emitDrawingChange() {
    let base64 = canvas.drawing.dataRepresentation().base64EncodedString()
    onChangeEvent(["strokes": base64])
  }
}

// ---------------------------------------------------------------------------
// MARK: - Expo module definition
// ---------------------------------------------------------------------------

public class SottoPencilKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SottoPencilKit")

    View(SottoPencilKitView.self) {
      // Prop: initialStrokes — base64-encoded PKDrawing to pre-populate the canvas.
      Prop("initialStrokes") { (view: SottoPencilKitView, value: String?) in
        view.setInitialStrokes(value)
      }

      // Event: onChange — fires with { strokes: <base64 string> } on every drawing change.
      Events("onChange")
    }
  }
}
