import SwiftUI

struct ClassPrerequisiteScope: Hashable {
    let credentials: SottoCredentials
    let classId: String
    let sourceHash: String

    func hash(into hasher: inout Hasher) {
        hasher.combine(credentials.serverURL)
        hasher.combine(credentials.apiKey)
        hasher.combine(credentials.selectedProfile?.id)
        hasher.combine(classId)
        hasher.combine(sourceHash)
    }
}

struct ScopedClassPrerequisite {
    let scope: ClassPrerequisiteScope
    let response: SottoClassPrerequisiteResponse
}

struct ClassPrerequisiteView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.scenePhase) private var scenePhase
    let detail: SottoClassDetail
    let scope: ClassPrerequisiteScope
    @Binding var saved: ScopedClassPrerequisite?
    @State private var value: SottoClassPrerequisiteResponse?
    @State private var error: String?
    @State private var busy = false
    @State private var operation: Operation = .read
    @State private var reload = 0
    @State private var capacityExceeded = false

    private struct LoadID: Equatable {
        let scope: ClassPrerequisiteScope
        let reload: Int
    }

    private enum Operation: Equatable {
        case read
        case prepare
        case acknowledge(SottoClassPrerequisiteAcknowledgment)
    }

    private var isCurrent: Bool {
        scenePhase == .active && model.credentials == scope.credentials && model.selectedClass?.id == scope.classId &&
            model.selectedClass?.prerequisiteSourceHash == scope.sourceHash
    }

    private var statusMessage: String {
        if case .acknowledge = operation { return "Saving your place" }
        return value?.status == .pending ? "Preparing your explanation" : "Checking your lesson"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Before you practise").font(.caption.bold()).foregroundStyle(SottoTheme.primary)
            Text("Build the basics").font(.title2.bold())
            if busy { ProgressView(statusMessage) }
            if let error {
                Text(error).foregroundStyle(SottoTheme.ink)
                if !capacityExceeded {
                    Button("Check saved status") { request(.read) }.disabled(busy).frame(minHeight: 44)
                }
            } else if let value {
                switch value.status {
                case .available:
                    Text("Get an explanation of the ideas you need before the exercises. This uses your configured AI provider and may take several minutes.")
                    Button("Explain the basics") { request(.prepare) }.disabled(busy).frame(minHeight: 44)
                case .failed, .stale:
                    Text(value.failure == "UNSAFE" ? "This explanation could not be prepared safely." : "The explanation could not be prepared for this class.")
                    if value.canRetry == true {
                        Button("Prepare a new explanation") { request(.prepare) }.disabled(busy).frame(minHeight: 44)
                    }
                case .unresolved:
                    Text("This request needs recovery on the server before it can be tried again.")
                case .ready:
                    if let content = value.content {
                        contentView(content, nativeLang: value.nativeLang, targetLang: value.targetLang)
                        if value.acknowledged == false, let receiptId = value.receiptId {
                            Button("Mark basics as read") {
                                request(.acknowledge(SottoClassPrerequisiteAcknowledgment(
                                    sourceHash: value.request.sourceHash, receiptId: receiptId)))
                            }.disabled(busy).frame(minHeight: 44)
                        } else if value.acknowledged == true {
                            Text("Basics marked as read.").font(.callout).foregroundStyle(SottoTheme.muted)
                        }
                    }
                case .pending, .unavailable:
                    EmptyView()
                }
            }
        }
        .buttonStyle(.bordered)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .task(id: LoadID(scope: scope, reload: reload)) {
            await load(generation: reload, operation: operation)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                request(.read)
            } else {
                saved = nil
                value = nil
                busy = false
                reload += 1
            }
        }
    }

    private func request(_ operation: Operation) {
        guard !capacityExceeded else { return }
        saved = nil
        value = nil
        self.operation = operation
        reload += 1
    }

    @MainActor private func load(generation: Int, operation: Operation) async {
        guard isCurrent else { return }
        busy = true
        error = nil
        value = nil
        saved = nil
        defer { if generation == reload && isCurrent { busy = false } }
        do {
            let loader = ClassPrerequisiteLoader(
                detail: detail,
                read: { try await model.fetchClassPrerequisite(classId: scope.classId) },
                start: { try await model.startClassPrerequisite(classId: scope.classId, request: $0) }
            )
            if case let .acknowledge(request) = operation {
                _ = try await loader.acknowledge(request, perform: {
                    try await model.acknowledgeClassPrerequisite(classId: scope.classId, request: $0)
                }) { response in
                    guard !Task.isCancelled, generation == reload, isCurrent else { return }
                    value = response
                    saved = ScopedClassPrerequisite(scope: scope, response: response)
                }
                return
            }
            _ = try await loader.load(prepare: operation == .prepare) { response in
                guard !Task.isCancelled, generation == reload, isCurrent else { return }
                value = response
                saved = response.status == .ready ? ScopedClassPrerequisite(scope: scope, response: response) : nil
            }
        } catch {
            guard !Task.isCancelled, generation == reload, isCurrent else { return }
            if case SottoAPIError.http(422, _) = error { capacityExceeded = true }
            self.error = error.localizedDescription
        }
    }

    private func contentView(_ content: SottoClassPrerequisiteContent, nativeLang: String, targetLang: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(content.title).font(.headline)
            Text(content.explanation)
            ForEach(Array(content.examples.enumerated()), id: \.offset) { _, example in
                VStack(alignment: .leading, spacing: 6) {
                    Text(example.target).foregroundStyle(SottoTheme.primary)
                        .environment(\.locale, Locale(identifier: targetLang))
                    Text(example.meaning)
                    Text(example.explanation)
                }
            }
        }
        .environment(\.locale, Locale(identifier: nativeLang))
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct ClassPrerequisiteDirection: View {
    let instruction: String
    let language: String

    var body: some View {
        Text(instruction)
            .font(.callout)
            .foregroundStyle(SottoTheme.ink)
            .environment(\.locale, Locale(identifier: language))
            .fixedSize(horizontal: false, vertical: true)
    }
}
