import SwiftUI
import QuickLook

struct CourseMaterialList: View {
    @EnvironmentObject private var model: SottoAppModel
    let materials: [SottoCourseMaterial]
    @State private var previewURL: URL?
    @State private var selectedExtract: SottoCourseMaterial?
    @State private var downloadingId: String?
    @State private var downloadTask: Task<Void, Never>?
    @State private var error = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(materials) { material in
                VStack(alignment: .leading, spacing: 4) {
                    Button { open(material) } label: {
                        Label(downloadingId == material.id ? "Opening \(material.name)..." : material.name, systemImage: "doc")
                            .frame(minHeight: 44, alignment: .leading)
                            .multilineTextAlignment(.leading)
                    }
                    .disabled(downloadingId != nil)
                    Button("View imported text") { selectedExtract = material }
                        .font(.caption)
                        .frame(minHeight: 44)
                }
            }
            if !materials.isEmpty {
                Text("Uploaded documents are kept separately from editable notes.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }
            if !error.isEmpty {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .quickLookPreview($previewURL)
        .onChange(of: previewURL) { previous, current in
            if current == nil, let previous { removePreview(previous) }
        }
        .onDisappear {
            downloadTask?.cancel()
        }
        .sheet(item: $selectedExtract) { material in
            NavigationStack {
                ScrollView {
                    Text(material.extractedText)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                }
                .navigationTitle(material.name)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { selectedExtract = nil }
                    }
                }
            }
        }
    }

    private func open(_ material: SottoCourseMaterial) {
        downloadingId = material.id
        error = ""
        downloadTask = Task {
            defer { downloadingId = nil }
            do {
                let url = try await model.downloadCourseMaterial(material)
                guard !Task.isCancelled else { removePreview(url); return }
                previewURL = url
            } catch {
                guard !Task.isCancelled else { return }
                self.error = "Could not open this document. Try again."
            }
        }
    }

    private func removePreview(_ url: URL) {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}
