import SwiftUI

struct ClassPreludeView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.scenePhase) private var scenePhase
    let navigation: ClassPreludeNavigation
    @State private var value: SottoClassPrelude?
    @State private var error: String?
    @State private var busy = false
    @State private var revision = 0
    @State private var operation: Operation = .read

    private enum Operation { case read, prepare, acknowledge, finish }
    private struct LoadID: Equatable { let revision: Int; let scene: ScenePhase }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Before you practise").font(.caption.bold()).foregroundStyle(SottoTheme.primary)
                    if let teaching = value?.teaching { teachingView(teaching) }
                    if let content = value?.content { contentView(content) }
                    if value?.status == .available {
                        Text("Get an explanation of the ideas you need before the exercises. This uses your configured AI provider and may take several minutes.")
                    }
                    if value?.status == .failed || value?.status == .stale {
                        Text(value?.failure == "UNSAFE" ? "This explanation could not be prepared safely." : "This explanation could not be prepared for this class.")
                    }
                    if value?.kind == .unavailable || value?.status == .unavailable || value?.status == .unresolved {
                        Text("This lesson needs recovery before practice can start.")
                    }
                    if busy { ProgressView(value?.kind == .generating ? "Preparing your class" : "Checking your lesson") }
                    if let error {
                        Text(error).foregroundStyle(SottoTheme.ink)
                        action("Check saved status", .read)
                    } else if let value, !busy {
                        if value.kind == .addendum && (value.status == .available ||
                            ([.failed, .stale].contains(value.status) && value.canRetry == true)) {
                            action("Explain the basics", .prepare)
                        } else if [.base, .addendum].contains(value.kind), value.acknowledged == false,
                                  value.receiptId != nil {
                            action("Mark basics as read", .acknowledge)
                        } else if value.kind == .unavailable || [.unavailable, .unresolved, .failed, .stale].contains(value.status) {
                            action("Check saved status", .read)
                        } else if value.kind == .notRequired || value.kind == .replay || value.acknowledged == true {
                            action("Continue", .finish)
                        }
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding(24)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Your class")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("Back") { model.cancelClassPrelude(navigation) }.frame(minHeight: 44)
            } }
            .task(id: LoadID(revision: revision, scene: scenePhase)) {
                guard scenePhase == .active else { return }
                await load(generation: revision, operation: operation)
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { request(.read) }
                else { model.suspendClassPrelude(navigation); value = nil; busy = false; revision += 1 }
            }
        }
    }

    private func action(_ title: String, _ action: Operation) -> some View {
        Button(title) { request(action) }.buttonStyle(.bordered).disabled(busy).frame(minHeight: 44)
    }

    private func request(_ action: Operation) {
        guard !busy else { return }
        error = nil
        operation = action
        revision += 1
    }

    @MainActor private func load(generation: Int, operation: Operation) async {
        guard scenePhase == .active, model.isCurrentClassPrelude(navigation), let client = model.makeClient() else { return }
        busy = true
        error = nil
        defer { if generation == revision && model.isCurrentClassPrelude(navigation) { busy = false } }
        let loader = ClassPreludeLoader(
            read: { try await client.fetchClassPrelude(classId: navigation.classId) },
            prepare: { try await client.prepareClassPrelude(classId: navigation.classId, request: $0, recovery: $1) },
            acknowledge: { try await client.acknowledgeClassPrelude(classId: navigation.classId, request: $0) },
            isCurrent: { model.isCurrentClassPrelude(navigation) && scenePhase == .active && generation == revision }
        )
        do {
            let result: SottoClassPrelude
            switch operation {
            case .read:
                result = try await loader.load { value = $0 }
            case .prepare:
                guard let value else { throw SottoAPIError.message("Check saved status before preparing.") }
                result = try await loader.start(displayed: value) { self.value = $0 }
            case .acknowledge:
                guard let value else { throw SottoAPIError.message("Check saved status before continuing.") }
                result = try await loader.acknowledge(displayed: value)
            case .finish:
                result = try await loader.load { value = $0 }
            }
            guard !Task.isCancelled, generation == revision, model.isCurrentClassPrelude(navigation), scenePhase == .active else { return }
            value = result
            if result.kind == .notRequired || result.kind == .replay || result.acknowledged == true {
                await model.finishClassPrelude(navigation)
            }
        } catch {
            guard !Task.isCancelled, generation == revision, model.isCurrentClassPrelude(navigation), scenePhase == .active else { return }
            value = nil
            self.error = SottoClassPrerequisiteFailure.normalized(error).localizedDescription
        }
    }

    private func teachingView(_ teaching: SottoClassPreludeTeaching) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(teaching.title).font(.system(.title, design: .serif).bold())
            Text(teaching.explanation)
            Text("Worked examples").font(.headline)
            ForEach(Array(teaching.workedExamples.enumerated()), id: \.offset) { _, example in
                VStack(alignment: .leading, spacing: 8) {
                    Text(example.prompt)
                    Text(example.answer).environment(\.locale, Locale(identifier: value?.targetLang ?? ""))
                    Text(example.explanation)
                }.padding(.vertical, 6)
            }
            Text("Notice the difference").font(.headline)
            Text(teaching.commonMistake.incorrect).environment(\.locale, Locale(identifier: value?.targetLang ?? ""))
            Text(teaching.commonMistake.correction).environment(\.locale, Locale(identifier: value?.targetLang ?? ""))
            Text(teaching.commonMistake.explanation)
        }.environment(\.locale, Locale(identifier: value?.nativeLang ?? ""))
    }

    private func contentView(_ content: SottoClassPreludeContent) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(content.title).font(.system(.title, design: .serif).bold())
            Text(content.explanation)
            ForEach(Array(content.examples.enumerated()), id: \.offset) { _, example in
                VStack(alignment: .leading, spacing: 8) {
                    Text(example.target).environment(\.locale, Locale(identifier: value?.targetLang ?? ""))
                    Text(example.meaning)
                    Text(example.explanation)
                }.padding(.vertical, 6)
            }
        }.environment(\.locale, Locale(identifier: value?.nativeLang ?? ""))
    }
}
