import SwiftUI

struct MaterialSourceView: View {
    @EnvironmentObject private var model: SottoAppModel
    let material: SottoCourseMaterial
    @State private var inventory: SottoMaterialProcessing?
    @State private var text: SottoMaterialPageText?
    @State private var legacy: SottoLegacyMaterialText?
    @State private var selectedPage: Int?
    @State private var selectedOrigin: String?
    @State private var busy = false
    @State private var error = ""
    @State private var epoch = UUID()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Source exposure does not count as demonstrated mastery.").font(.callout)
                if busy { ProgressView("Reading source receipt") }
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
                Button("Refresh processing") { Task { await loadPages(after: 0) } }.disabled(busy).frame(minHeight: 44)
                if material.textRetained == true || material.legacyTextUrl != nil {
                    Button("Read retained legacy text") { Task { await loadLegacy(offset: 0) } }.disabled(busy).frame(minHeight: 44)
                }
                if let inventory {
                    Text("Processing: \(inventory.status.lowercased())")
                    if let diagnostic = inventory.diagnostic { Text(diagnostic) }
                    if let hash = inventory.originalSha256 { Text("Original SHA256: \(hash)").font(.caption.monospaced()).textSelection(.enabled) }
                    ForEach(inventory.pages) { page in
                        DisclosureGroup("Page \(page.pageNumber): \(page.visual.state.replacingOccurrences(of: "_", with: " ").lowercased())") {
                            Text("Embedded text: \(page.embeddedText.state.lowercased())").font(.caption)
                            ForEach(page.textStreams, id: \.source.origin) { stream in
                                Button("Read \(stream.source.origin == "EMBEDDED_TEXT" ? "embedded text" : "visual recognition")") {
                                    Task { await loadText(page: page.pageNumber, origin: stream.source.origin, after: -1) }
                                }.disabled(busy).frame(minHeight: 44)
                            }
                            if page.textStreams.isEmpty { Text("No text stream is available for this page.") }
                        }
                    }
                    if let next = inventory.nextPage {
                        Button("Next pages") { Task { await loadPages(after: next) } }.disabled(busy).frame(minHeight: 44)
                    }
                }
                if let text {
                    Divider()
                    Text("Page \(text.manifest.pageNumber) · \(text.manifest.source.origin == "EMBEDDED_TEXT" ? "Embedded text" : "Visual recognition")").font(.headline)
                    Text("Text SHA256: \(text.manifest.textSha256)").font(.caption.monospaced()).textSelection(.enabled)
                    ForEach(text.chunks) { chunk in
                        Text("Characters \(chunk.codePointStart) to \(chunk.codePointEnd)").font(.caption)
                        Text(chunk.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if text.chunks.isEmpty { Text("This source text stream is empty.") }
                    if let next = text.nextIndex, let page = selectedPage, let origin = selectedOrigin {
                        Button("Next text chunks") { Task { await loadText(page: page, origin: origin, after: next) } }.disabled(busy).frame(minHeight: 44)
                    }
                }
                if let legacy {
                    Divider()
                    Text("Legacy imported text").font(.headline)
                    Text("Retained source text. Page and visual coverage were not captured for this legacy import.").font(.caption)
                    Text("Characters \(legacy.offset) to \(legacy.offset + legacy.text.unicodeScalars.count) of \(legacy.totalCodePoints)").font(.caption)
                    Text(legacy.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    if let next = legacy.nextOffset {
                        Button("Next retained text range") { Task { await loadLegacy(offset: next) } }.disabled(busy).frame(minHeight: 44)
                    }
                }
            }.padding()
        }
        .navigationTitle(material.name)
        .task { await loadPages(after: 0) }
        .onDisappear { epoch = UUID() }
    }

    private func loadPages(after: Int) async {
        let token = UUID(); epoch = token; busy = true; error = ""
        inventory = nil; text = nil; legacy = nil
        defer { if epoch == token { busy = false } }
        do {
            let value = try await model.materialProcessing(id: material.id, afterPage: after)
            guard epoch == token, !Task.isCancelled else { return }
            inventory = value; text = nil; selectedPage = nil; selectedOrigin = nil
        } catch { if epoch == token && !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func loadText(page: Int, origin: String, after: Int) async {
        guard let run = inventory?.run else { return }
        let token = UUID(); epoch = token; busy = true; error = ""
        text = nil; legacy = nil
        defer { if epoch == token { busy = false } }
        do {
            let value = try await model.materialPageText(id: material.id, runId: run.id, page: page, origin: origin, afterIndex: after)
            guard epoch == token, !Task.isCancelled else { return }
            selectedPage = page; selectedOrigin = origin; text = value
        } catch { if epoch == token && !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func loadLegacy(offset: Int) async {
        let token = UUID(); epoch = token; busy = true; error = ""; text = nil; legacy = nil
        defer { if epoch == token { busy = false } }
        do {
            let value = try await model.legacyMaterialText(id: material.id, offset: offset)
            guard epoch == token, !Task.isCancelled else { return }
            legacy = value
        } catch { if epoch == token && !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
