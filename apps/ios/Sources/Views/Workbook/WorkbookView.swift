import PDFKit
import PencilKit
import SwiftUI
import UIKit

struct WorkbookView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout
    let response: SottoWorksheetResponse

    @StateObject private var annotationStore = WorkbookAnnotationStore()
    @State private var pencilRecognized = false
    @State private var pdfData: Data?
    @State private var isLoadingPDF = false
    @State private var pdfLoadError: String?
    @State private var isExportingPDF = false
    @State private var exportError: String?
    @State private var exportedPDF: WorkbookPDFExport?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if layout.supportsHandwriting {
                    PencilStatusBar(isRecognized: pencilRecognized)
                }
                workbookSurface
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
                ToolbarItemGroup(placement: .primaryAction) {
                    ProfileToolbarMenu {
                        dismiss()
                    }

                    Button {
                        Task {
                            await exportAnnotatedPDF()
                        }
                    } label: {
                        Label(isExportingPDF ? "Exporting" : "Export", systemImage: "square.and.arrow.up")
                    }
                    .disabled(isExportingPDF || !annotationStore.canExport)

                    if let url = sourcePDFURL {
                        Link(destination: url) {
                            Label("PDF", systemImage: "doc.richtext")
                        }
                    }
                }
            }
            .task(id: response.worksheetPdfUrl) {
                await loadWorkbookPDF()
            }
            .sheet(item: $exportedPDF) { export in
                WorkbookShareSheet(activityItems: [export.url])
            }
            .alert(
                "Could not export workbook",
                isPresented: Binding(
                    get: { exportError != nil },
                    set: { if !$0 { exportError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(exportError ?? "")
            }
        }
    }

    @ViewBuilder
    private var workbookSurface: some View {
        if let pdfData {
            if layout.supportsHandwriting {
                AnnotatedWorkbookPDFView(
                    pdfData: pdfData,
                    annotationStore: annotationStore,
                    pencilRecognized: $pencilRecognized
                )
                .background(SottoTheme.paper)
            } else {
                // ponytail: iPhone reads and shares the workbook; handwriting
                // needs the iPad canvas, so no annotation layer here.
                WorkbookPDFReaderView(pdfData: pdfData)
                    .background(SottoTheme.paper)
            }
        } else if isLoadingPDF {
            ProgressView("Loading workbook PDF")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(SottoTheme.paper)
        } else {
            VStack(spacing: 0) {
                if let pdfLoadError {
                    Text(pdfLoadError)
                        .font(.caption)
                        .foregroundStyle(SottoTheme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(SottoTheme.surface)
                        .overlay(Rectangle().fill(SottoTheme.line).frame(height: 1), alignment: .bottom)
                }

                fallbackWorkbookSurface
            }
        }
    }

    @ViewBuilder
    private var fallbackWorkbookSurface: some View {
        if layout.supportsHandwriting {
            HStack(spacing: 0) {
                worksheetPane
                    .frame(minWidth: 360, idealWidth: 460, maxWidth: 520)

                Divider()

                PencilCanvasView(pencilRecognized: $pencilRecognized)
                    .background(Color.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            worksheetPane
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    private var sourcePDFURL: URL? {
        guard let value = response.worksheetPdfUrl, !value.isEmpty else {
            return nil
        }

        if let url = URL(string: value), url.scheme != nil {
            return url
        }

        if let serverURL = model.credentials?.serverURL {
            return URL(string: value, relativeTo: serverURL)?.absoluteURL
        }

        return URL(string: value)
    }

    @MainActor
    private func loadWorkbookPDF() async {
        guard let url = sourcePDFURL else {
            pdfData = nil
            pdfLoadError = nil
            annotationStore.reset()
            return
        }

        isLoadingPDF = true
        pdfLoadError = nil

        do {
            let (data, urlResponse) = try await URLSession.shared.data(from: url)

            if let http = urlResponse as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw WorkbookPDFError.loadFailed("Sotto returned HTTP \(http.statusCode) for the workbook PDF.")
            }

            guard PDFDocument(data: data) != nil else {
                throw WorkbookPDFError.loadFailed("Sotto returned a workbook file that PDFKit could not open.")
            }

            annotationStore.load(pdfData: data, documentID: response.document.classId)
            pdfData = data
        } catch {
            pdfData = nil
            annotationStore.reset()
            pdfLoadError = "The generated PDF could not be loaded here, so Sotto is showing the fallback notes canvas. \(error.localizedDescription)"
        }

        isLoadingPDF = false
    }

    @MainActor
    private func exportAnnotatedPDF() async {
        isExportingPDF = true
        exportError = nil

        do {
            let url = try annotationStore.exportAnnotatedPDF(title: response.document.title)
            exportedPDF = WorkbookPDFExport(url: url)
        } catch {
            exportError = error.localizedDescription
        }

        isExportingPDF = false
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

        let toolPicker = Self.makeWorkbookToolPicker()
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

private extension PencilCanvasView {
    static func makeWorkbookToolPicker() -> PKToolPicker {
        let toolPicker = PKToolPicker(toolItems: workbookToolItems())
        toolPicker.stateAutosaveName = "SottoWorkbookToolPicker"
        toolPicker.showsDrawingPolicyControls = false
        return toolPicker
    }

    static func workbookToolItems() -> [PKToolPickerItem] {
        [
            PKToolPickerInkingItem(type: .pen, color: .black, width: 4),
            PKToolPickerInkingItem(type: .pencil, color: .darkGray, width: 6),
            PKToolPickerInkingItem(type: .marker, color: UIColor.systemYellow.withAlphaComponent(0.55), width: 14),
            PKToolPickerInkingItem(type: .monoline, color: UIColor.systemBlue, width: 4),
            PKToolPickerInkingItem(type: .fountainPen, color: UIColor.label, width: 4),
            PKToolPickerInkingItem(type: .watercolor, color: UIColor.systemTeal.withAlphaComponent(0.65), width: 10),
            PKToolPickerInkingItem(type: .crayon, color: UIColor.systemPurple, width: 8),
            PKToolPickerEraserItem(type: .bitmap),
            PKToolPickerEraserItem(type: .fixedWidthBitmap, width: 16),
            PKToolPickerEraserItem(type: .vector),
            PKToolPickerLassoItem(),
            PKToolPickerRulerItem()
        ]
    }
}

/// Plain scrolling PDF, no markup layer. The iPhone workbook.
private struct WorkbookPDFReaderView: UIViewRepresentable {
    let pdfData: Data

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.backgroundColor = UIColor(red: 0.961, green: 0.957, blue: 0.941, alpha: 1)
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.displaysPageBreaks = true
        pdfView.autoScales = true
        pdfView.pageShadowsEnabled = true
        load(into: pdfView, coordinator: context.coordinator)
        return pdfView
    }

    func updateUIView(_ pdfView: PDFView, context: Context) {
        load(into: pdfView, coordinator: context.coordinator)
    }

    /// Rebuild the document only when the bytes change, so scrolling position
    /// survives SwiftUI's layout passes.
    private func load(into pdfView: PDFView, coordinator: Coordinator) {
        guard coordinator.loadedData != pdfData else { return }
        coordinator.loadedData = pdfData
        pdfView.document = PDFDocument(data: pdfData)
    }

    final class Coordinator {
        var loadedData: Data?
    }
}

private struct AnnotatedWorkbookPDFView: UIViewRepresentable {
    let pdfData: Data
    @ObservedObject var annotationStore: WorkbookAnnotationStore
    @Binding var pencilRecognized: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(annotationStore: annotationStore, pencilRecognized: $pencilRecognized)
    }

    func makeUIView(context: Context) -> PDFView {
        let pdfView = PDFView()
        pdfView.backgroundColor = UIColor(red: 0.961, green: 0.957, blue: 0.941, alpha: 1)
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        pdfView.displaysPageBreaks = true
        pdfView.autoScales = true
        pdfView.pageShadowsEnabled = true
        pdfView.isInMarkupMode = true
        pdfView.pageOverlayViewProvider = context.coordinator
        context.coordinator.configure(pdfView, pdfData: pdfData)
        return pdfView
    }

    func updateUIView(_ pdfView: PDFView, context: Context) {
        pdfView.isInMarkupMode = true
        pdfView.pageOverlayViewProvider = context.coordinator
        context.coordinator.pencilRecognized = $pencilRecognized
        context.coordinator.configure(pdfView, pdfData: pdfData)
    }

    final class Coordinator: NSObject, PDFPageOverlayViewProvider, PKCanvasViewDelegate {
        private let annotationStore: WorkbookAnnotationStore
        private let toolPicker = PencilCanvasView.makeWorkbookToolPicker()
        private var pdfData: Data?
        private var canvasesByPageIndex: [Int: WorkbookPageCanvasView] = [:]
        var pencilRecognized: Binding<Bool>

        init(annotationStore: WorkbookAnnotationStore, pencilRecognized: Binding<Bool>) {
            self.annotationStore = annotationStore
            self.pencilRecognized = pencilRecognized
        }

        func configure(_ pdfView: PDFView, pdfData: Data) {
            guard self.pdfData != pdfData else {
                return
            }

            self.pdfData = pdfData
            canvasesByPageIndex.removeAll()
            pdfView.document = PDFDocument(data: pdfData)
            pdfView.layoutDocumentView()
        }

        func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            guard let document = view.document else {
                return nil
            }

            let pageIndex = document.index(for: page)
            guard pageIndex != NSNotFound else {
                return nil
            }

            if let canvas = canvasesByPageIndex[pageIndex] {
                canvas.drawing = annotationStore.drawing(forPageAt: pageIndex)
                return canvas
            }

            let canvas = WorkbookPageCanvasView(pageIndex: pageIndex)
            canvas.delegate = self
            canvas.drawingPolicy = .pencilOnly
            canvas.backgroundColor = .clear
            canvas.isOpaque = false
            canvas.isScrollEnabled = false
            canvas.alwaysBounceVertical = false
            canvas.alwaysBounceHorizontal = false
            canvas.tool = PKInkingTool(.pen, color: .black, width: 4)
            canvas.drawing = annotationStore.drawing(forPageAt: pageIndex)
            canvasesByPageIndex[pageIndex] = canvas
            return canvas
        }

        func pdfView(_ pdfView: PDFView, willDisplayOverlayView overlayView: UIView, for page: PDFPage) {
            guard let canvas = overlayView as? WorkbookPageCanvasView else {
                return
            }

            toolPicker.addObserver(canvas)
            toolPicker.setVisible(true, forFirstResponder: canvas)
            canvas.becomeFirstResponder()
        }

        func pdfView(_ pdfView: PDFView, willEndDisplayingOverlayView overlayView: UIView, for page: PDFPage) {
            guard let canvas = overlayView as? WorkbookPageCanvasView else {
                return
            }

            annotationStore.record(
                drawing: canvas.drawing,
                canvasSize: canvas.bounds.size,
                forPageAt: canvas.pageIndex
            )
            toolPicker.removeObserver(canvas)
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            guard let canvas = canvasView as? WorkbookPageCanvasView else {
                return
            }

            annotationStore.record(
                drawing: canvas.drawing,
                canvasSize: canvas.bounds.size,
                forPageAt: canvas.pageIndex
            )

            if !canvas.drawing.strokes.isEmpty {
                pencilRecognized.wrappedValue = true
            }
        }
    }
}

private final class WorkbookPageCanvasView: PKCanvasView {
    let pageIndex: Int

    init(pageIndex: Int) {
        self.pageIndex = pageIndex
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("WorkbookPageCanvasView does not support Interface Builder.")
    }
}

@MainActor
private final class WorkbookAnnotationStore: ObservableObject {
    @Published private(set) var canExport = false

    private struct PageDrawing {
        let drawing: PKDrawing
        let canvasSize: CGSize
    }

    private struct PersistedPageDrawing: Codable {
        let pageIndex: Int
        let canvasWidth: Double
        let canvasHeight: Double
        let drawingData: Data
    }

    private struct PersistedWorkbookDrawing: Codable {
        let documentID: String
        let pages: [PersistedPageDrawing]
    }

    private var sourcePDFData: Data?
    private var documentID: String?
    private var drawingsByPageIndex: [Int: PageDrawing] = [:]

    func load(pdfData: Data, documentID: String) {
        if self.documentID != documentID {
            drawingsByPageIndex = loadPersistedDrawings(documentID: documentID)
        }

        self.documentID = documentID
        sourcePDFData = pdfData
        canExport = true
    }

    func reset() {
        sourcePDFData = nil
        documentID = nil
        drawingsByPageIndex.removeAll()
        canExport = false
    }

    func drawing(forPageAt pageIndex: Int) -> PKDrawing {
        drawingsByPageIndex[pageIndex]?.drawing ?? PKDrawing()
    }

    func record(drawing: PKDrawing, canvasSize: CGSize, forPageAt pageIndex: Int) {
        guard canvasSize.width > 0, canvasSize.height > 0 else {
            return
        }

        if drawing.strokes.isEmpty {
            drawingsByPageIndex.removeValue(forKey: pageIndex)
        } else {
            drawingsByPageIndex[pageIndex] = PageDrawing(drawing: drawing, canvasSize: canvasSize)
        }

        savePersistedDrawings()
    }

    func exportAnnotatedPDF(title: String) throws -> URL {
        guard let sourcePDFData else {
            throw WorkbookPDFError.exportFailed("No workbook PDF is loaded yet.")
        }

        guard let document = PDFDocument(data: sourcePDFData), document.pageCount > 0 else {
            throw WorkbookPDFError.exportFailed("The workbook PDF could not be opened for export.")
        }

        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(Self.safeFilename(title))-annotated-\(UUID().uuidString).pdf")

        let firstPage = document.page(at: 0)
        let firstBounds = firstPage?.bounds(for: .mediaBox) ?? CGRect(x: 0, y: 0, width: 612, height: 792)
        let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: firstBounds.size))

        try renderer.writePDF(to: outputURL) { context in
            for pageIndex in 0..<document.pageCount {
                guard let page = document.page(at: pageIndex) else {
                    continue
                }

                let pageBounds = page.bounds(for: .mediaBox)
                context.beginPage(withBounds: CGRect(origin: .zero, size: pageBounds.size), pageInfo: [:])

                let cgContext = context.cgContext
                cgContext.saveGState()
                cgContext.translateBy(x: -pageBounds.minX, y: pageBounds.height + pageBounds.minY)
                cgContext.scaleBy(x: 1, y: -1)
                page.draw(with: .mediaBox, to: cgContext)
                cgContext.restoreGState()

                guard let pageDrawing = drawingsByPageIndex[pageIndex] else {
                    continue
                }

                let drawingBounds = CGRect(origin: .zero, size: pageDrawing.canvasSize)
                let drawingImage = pageDrawing.drawing.image(from: drawingBounds, scale: 2)
                drawingImage.draw(in: CGRect(origin: .zero, size: pageBounds.size))
            }
        }

        return outputURL
    }

    private static func safeFilename(_ title: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let scalars = title.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        let cleaned = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Sotto-workbook" : cleaned
    }

    private func loadPersistedDrawings(documentID: String) -> [Int: PageDrawing] {
        guard let data = try? Data(contentsOf: persistenceURL(for: documentID)),
              let persisted = try? JSONDecoder().decode(PersistedWorkbookDrawing.self, from: data),
              persisted.documentID == documentID
        else {
            return [:]
        }

        var drawings: [Int: PageDrawing] = [:]
        for page in persisted.pages {
            guard let drawing = try? PKDrawing(data: page.drawingData) else {
                continue
            }

            drawings[page.pageIndex] = PageDrawing(
                drawing: drawing,
                canvasSize: CGSize(width: page.canvasWidth, height: page.canvasHeight)
            )
        }
        return drawings
    }

    private func savePersistedDrawings() {
        guard let documentID else {
            return
        }

        let pages = drawingsByPageIndex
            .sorted { $0.key < $1.key }
            .map { pageIndex, pageDrawing in
                PersistedPageDrawing(
                    pageIndex: pageIndex,
                    canvasWidth: pageDrawing.canvasSize.width,
                    canvasHeight: pageDrawing.canvasSize.height,
                    drawingData: pageDrawing.drawing.dataRepresentation()
                )
            }

        let persisted = PersistedWorkbookDrawing(documentID: documentID, pages: pages)
        let url = persistenceURL(for: documentID)

        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(persisted)
            try data.write(to: url, options: [.atomic])
        } catch {
            // Best-effort local cache; export still works from the in-memory drawing.
        }
    }

    private func persistenceURL(for documentID: String) -> URL {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory

        return baseURL
            .appendingPathComponent("Sotto", isDirectory: true)
            .appendingPathComponent("WorkbookInk", isDirectory: true)
            .appendingPathComponent("\(Self.safeFilename(documentID)).json")
    }
}

private struct WorkbookPDFExport: Identifiable {
    let id = UUID()
    let url: URL
}

private struct WorkbookShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private enum WorkbookPDFError: LocalizedError {
    case loadFailed(String)
    case exportFailed(String)

    var errorDescription: String? {
        switch self {
        case let .loadFailed(message), let .exportFailed(message):
            message
        }
    }
}
