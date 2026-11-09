import SwiftUI
import UIKit

struct LearningSaveFailureView: View {
    @ObservedObject var progress: LearningProgressStore
    var discardAndReload: (() async throws -> Void)? = nil
    @State private var confirming = false
    @State private var checking = false
    @State private var error: String?
    @State private var confirmingDiscard = false

    var body: some View {
        if let message = progress.errorMessage {
            VStack(alignment: .leading, spacing: 10) {
                Text(message).foregroundStyle(.red)
                if let error { Text(error).foregroundStyle(.red) }
                if let edits = progress.recoverableText {
                    Button("Copy unsaved work") { UIPasteboard.general.string = edits }
                        .buttonStyle(.bordered)
                }
                if discardAndReload != nil {
                    Button("Discard local edits and reload") { confirmingDiscard = true }
                        .buttonStyle(.bordered).disabled(checking)
                }
                Button("Retry saving") { progress.retry() }.buttonStyle(.bordered)
                Button("Check latest saved work") {
                    Task {
                        checking = true
                        defer { checking = false }
                        do { try await progress.prepareReconciliation(); confirming = true; error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                }.buttonStyle(.bordered).disabled(checking)
            }
            .confirmationDialog("Save this screen's edits over the latest saved work?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Save this screen's edits") { progress.confirmReconciliation() }
                Button("Keep local edits without saving", role: .cancel) {}
            } message: {
                Text("This can replace choices or drafts saved on another device. Your current edits stay on this device if you cancel.")
            }
            .confirmationDialog("Discard local choices and drafts?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Discard and reload", role: .destructive) {
                    Task {
                        checking = true
                        defer { checking = false }
                        do { try await discardAndReload?(); error = nil }
                        catch { self.error = error.localizedDescription }
                    }
                }
                Button("Keep local edits", role: .cancel) {}
            } message: {
                Text("This reloads saved practice. Copy any local work you want to keep first.")
            }
        }
    }
}
