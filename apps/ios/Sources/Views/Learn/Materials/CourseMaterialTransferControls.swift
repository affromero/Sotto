import SwiftUI
import UniformTypeIdentifiers

struct CourseMaterialTransferControls: View {
    @EnvironmentObject private var model: SottoAppModel
    let courseId: String
    let onComplete: (SottoCourseNotesResponse) -> Void
    @State private var showingImporter = false
    @State private var operation: Task<Void, Never>?
    @State private var busy = false
    @State private var message = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Upload up to ten originals, 100MiB each and 250MiB total. Transfers resume from saved, verified parts.")
                .font(.caption).foregroundStyle(SottoTheme.muted)
            Button("Upload original materials") { showingImporter = true }
                .buttonStyle(.bordered).frame(minHeight: 44).disabled(busy)
            Button("Resume saved upload") { upload([]) }.frame(minHeight: 44).disabled(busy)
            if busy {
                ProgressView("Saving original file parts")
                Button("Stop waiting") { operation?.cancel() }.frame(minHeight: 44)
            } else {
                Button("Cancel unfinished upload", role: .destructive) { cancelSaved() }.frame(minHeight: 44)
            }
            if !message.isEmpty { Text(message).font(.callout).accessibilityAddTraits(.updatesFrequently) }
        }
        .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case let .success(urls): upload(urls)
            case .failure: message = "Could not open the selected original files."
            }
        }
        .onDisappear { operation?.cancel() }
    }

    private func upload(_ urls: [URL]) {
        guard !busy else { return }
        busy = true; message = "Checking the learner and saved upload receipt."
        operation = Task {
            defer { busy = false; operation = nil }
            do {
                let response = try await model.importCourseMaterials(courseId: courseId, urls: urls)
                try Task.checkCancellation()
                onComplete(response)
                message = "Originals saved separately from editable notes. Inspect source pages for processing coverage."
            } catch {
                message = Task.isCancelled ? "Stopped waiting. The saved receipt and original bytes remain on this device for resume." : error.localizedDescription
            }
        }
    }

    private func cancelSaved() {
        guard !busy else { return }
        busy = true; message = "Checking unfinished upload cleanup."
        operation = Task {
            defer { busy = false; operation = nil }
            do {
                try await model.cancelMaterialTransfer(courseId: courseId)
                message = "Unfinished upload cleanup confirmed. Saved originals stay available."
            } catch { message = error.localizedDescription }
        }
    }
}
