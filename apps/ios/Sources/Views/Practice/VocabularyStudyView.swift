import SwiftUI

struct VocabularyStudyView: View {
    @EnvironmentObject private var model: SottoAppModel
    @ObservedObject var progress: LearningProgressStore
    @Binding var blocksDismissal: Bool
    @Binding var draftDurable: Bool
    let start: SottoPracticeStart
    @State private var index = 0
    @State private var drafts: [String: String] = [:]
    @State private var pending: SottoVocabularyAction?
    @State private var busy = false
    @State private var error: String?
    @State private var conflict = false
    @State private var confirmingReload = false
    @State private var recoveredDrafts = false
    @State private var savedServerDrafts: [String: String] = [:]
    @State private var draftStorageFailed = false

    private var session: SottoPracticeStart {
        model.practiceStart?.sessionId == start.sessionId ? (model.practiceStart ?? start) : start
    }
    private var mode: SottoVocabularyMode? { SottoVocabularyMode(rawValue: session.mode ?? "") }
    private var cards: [SottoVocabularyCard] { session.cards ?? [] }
    private var actionScope: String { "action/\(start.courseId ?? "")/\(start.sessionId)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if mode == nil {
                Text("This vocabulary mode is not supported by this version of the app.")
            } else if let receipt = session.receipt {
                Text("Session complete").font(.title2.bold())
                if mode == .flashcards, let summary = session.ratingSummary {
                    Text("\(summary.known) known · \(summary.unknown) still learning")
                    if summary.studied > 0 { Text("\(summary.studied) previously studied without a rating.") }
                } else {
                    Text(mode == .flashcards ? "\(receipt.studied) words studied." : "\(receipt.correct) of \(receipt.total) recalled.")
                }
                if mode == .flashcards, let courseId = session.courseId {
                    VocabularyRefillView(courseId: courseId, sessionId: session.sessionId) { next in
                        model.presentVocabularyStudy(next, courseId: courseId)
                    }
                }
            } else if cards.indices.contains(index) {
                let card = cards[index]
                HStack {
                    Label(mode?.title ?? "Vocabulary", systemImage: "rectangle.stack")
                        .font(.headline).foregroundStyle(SottoTheme.primary)
                    Spacer()
                    Text("\(index + 1) / \(cards.count)").font(.subheadline.weight(.semibold))
                        .foregroundStyle(SottoTheme.muted)
                }
                ProgressView(value: Double(cards.filter { $0.feedback != nil }.count), total: Double(cards.count))
                    .tint(SottoTheme.primary)
                    .accessibilityLabel("Words reviewed")
                    .accessibilityValue("\(cards.filter { $0.feedback != nil }.count) of \(cards.count)")
                VStack(alignment: .leading, spacing: 20) {
                    Text(mode == .word ? "MEANING" : mode == .flashcards ? "MEET THIS WORD" : "WHAT DOES THIS MEAN?")
                        .font(.caption.weight(.semibold)).tracking(1.2).foregroundStyle(SottoTheme.primary)
                    Text(card.prompt).font(.system(.largeTitle, design: .serif, weight: .bold))
                        .foregroundStyle(SottoTheme.ink).textSelection(.enabled)
                        .accessibilityAddTraits(.isHeader)
                    if mode != .word || card.feedback != nil {
                        VocabularyPronunciation(path: "/api/v1/practice/\(start.sessionId)/vocabulary/\(card.id)/audio").id(card.id)
                    }
                    if mode == .flashcards {
                        VocabularyExamplesView(sessionId: start.sessionId, cardId: card.id, revealed: card.feedback != nil).id(card.id)
                    }
                    if let feedback = card.feedback {
                        Divider()
                        Text(mode == .flashcards ? (feedback.selfRating == "KNOWN" ? "Known" : feedback.selfRating == "UNKNOWN" ? "Still learning" : "Meaning") : feedback.correct == true ? "Recalled" : "Keep practicing")
                            .font(.headline).foregroundStyle(SottoTheme.primary)
                        if mode != .meaning && mode != .flashcards { Text(feedback.lemma).font(.title3) }
                        Text(feedback.meaning).font(.title3).foregroundStyle(SottoTheme.ink)
                        if feedback.outcome == "REVEALED" && mode != .flashcards {
                            Text("Revealing an answer schedules more practice.").font(.caption)
                        }
                        Button {
                            if index + 1 < cards.count { index += 1 }
                            else { Task { await act("COMPLETE", card: card) } }
                        } label: {
                            Text(index + 1 < cards.count ? "Next word" : "Finish session").frame(maxWidth: .infinity)
                        }.buttonStyle(.borderedProminent).tint(SottoTheme.primary).controlSize(.large)
                            .disabled(busy || pending != nil || recoveredDrafts || draftStorageFailed)
                    } else {
                        if mode != .flashcards {
                            TextField(mode == .word ? "The word" : "Its meaning", text: Binding(
                                get: { drafts[card.id] ?? "" },
                                set: { drafts[card.id] = String($0.prefix(1000)); saveDrafts() }
                            )).textFieldStyle(.roundedBorder).disabled(busy || pending != nil || recoveredDrafts || draftStorageFailed)
                            Button("Check answer") { Task { await act("ANSWER", card: card) } }
                                .buttonStyle(.borderedProminent).tint(SottoTheme.primary).controlSize(.large)
                                .disabled(busy || pending != nil || recoveredDrafts || draftStorageFailed || (drafts[card.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        if mode == .flashcards {
                            Text("Swipe here: left to keep learning, right if you know it.")
                                .font(.callout).foregroundStyle(SottoTheme.muted)
                                .frame(maxWidth: .infinity, minHeight: 56)
                                .background(SottoTheme.primary.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .contentShape(Rectangle())
                                .simultaneousGesture(DragGesture(minimumDistance: 35).onEnded { gesture in
                                    guard session.selfRatingSupported == true, !busy, pending == nil,
                                          !recoveredDrafts, !draftStorageFailed,
                                          abs(gesture.translation.width) >= 80,
                                          abs(gesture.translation.width) > abs(gesture.translation.height) * 1.5 else { return }
                                    Task { await act("RATE", card: card, rating: gesture.translation.width > 0 ? "KNOWN" : "UNKNOWN") }
                                })
                            SottoAdaptiveStack(spacing: 8) {
                                Button("Still learning") { Task { await act("RATE", card: card, rating: "UNKNOWN") } }
                                    .buttonStyle(.bordered).tint(SottoTheme.primary).controlSize(.large)
                                Button("Know it") { Task { await act("RATE", card: card, rating: "KNOWN") } }
                                    .buttonStyle(.borderedProminent).tint(SottoTheme.primary).controlSize(.large)
                            }
                            .disabled(busy || pending != nil || recoveredDrafts || draftStorageFailed || session.selfRatingSupported != true)
                            Button { Task { await act("RATE", card: card, rating: "UNKNOWN") } } label: {
                                Text("Reveal meaning").frame(maxWidth: .infinity)
                            }
                                .buttonStyle(.bordered).tint(SottoTheme.primary).controlSize(.large)
                                .disabled(busy || pending != nil || recoveredDrafts || draftStorageFailed || session.selfRatingSupported != true)
                            Text("Revealing the meaning counts as still learning.")
                                .font(.caption).foregroundStyle(SottoTheme.muted)
                            if session.selfRatingSupported != true {
                                Text("Update your Sotto server to use flashcard ratings.")
                                    .font(.callout).foregroundStyle(SottoTheme.rose)
                            }
                        } else {
                            Button("I can’t recall it") { Task { await act("REVEAL", card: card) } }
                                .buttonStyle(.bordered).tint(SottoTheme.primary).controlSize(.large)
                                .disabled(busy || pending != nil || recoveredDrafts || draftStorageFailed)
                        }
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 280, alignment: .leading)
                .padding(24)
                .background(SottoTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(SottoTheme.line))
            } else {
                Text("This vocabulary session could not be read. Reopen it to try again.")
            }
            if let pending, cards.indices.contains(index) {
                Button("Retry saved response") { Task { await act(pending.action, card: cards[index], rating: pending.rating) } }
                    .disabled(busy || conflict || recoveredDrafts || draftStorageFailed)
            }
            if conflict {
                Button("Check saved progress") { confirmingReload = true }.disabled(busy)
            }
            if recoveredDrafts {
                Text("This device has a draft that differs from the latest saved work.")
                Button("Use this device’s draft") { progress.resume(); recoveredDrafts = false; saveDrafts() }
                Button("Use the server draft") { Task { await discardDrafts() } }
            }
            if draftStorageFailed {
                Button("Retry saving this draft") { progress.resume(); saveDrafts() }
                Button("Discard this draft", role: .destructive) { Task { await discardDrafts() } }
            }
            if let error { Text(error).foregroundStyle(.red) }
            LearningSaveFailureView(progress: progress)
        }
        .task {
            progress.configure(client: model.makeClient(), path: "/api/v1/practice/\(start.sessionId)", revision: start.progressRevision ?? 0)
            savedServerDrafts = start.writingDrafts ?? [:]
            drafts = savedServerDrafts
            index = cards.firstIndex(where: { $0.feedback == nil }) ?? max(0, cards.count - 1)
            if let client = model.makeClient() {
                do {
                    pending = try VocabularyPendingStore(client: client, scope: actionScope).load(SottoVocabularyAction.self)
                    let storedDraft = VocabularyPendingStore(client: client, scope: draftScope)
                    if let local = try storedDraft.load([String: String].self) {
                        if local != savedServerDrafts { drafts = local; recoveredDrafts = true }
                        else {
                            try storedDraft.clear()
                            if progress.isSuspended, let revision = start.progressRevision {
                                progress.replacePendingWithServerRevision(revision)
                            }
                        }
                    }
                    if let itemId = pending?.itemId, let savedIndex = cards.firstIndex(where: { $0.id == itemId }) { index = savedIndex }
                } catch { self.error = error.localizedDescription }
            }
        }
        .onChange(of: busy) { _, _ in blocksDismissal = busy || draftStorageFailed }
        .onChange(of: draftStorageFailed) { _, _ in blocksDismissal = busy || draftStorageFailed; draftDurable = !draftStorageFailed }
        .confirmationDialog("Load saved progress?", isPresented: $confirmingReload, titleVisibility: .visible) {
            Button("Load saved progress") { Task { await reload() } }
            Button("Keep this screen", role: .cancel) {}
        } message: {
            Text("This replaces the drafts on this screen with the latest saved work and resolves the pending response.")
        }
    }

    private func saveDrafts() {
        guard mode != .flashcards, let client = model.makeClient() else { return }
        do {
            try VocabularyPendingStore(client: client, scope: draftScope).replace(drafts)
            draftStorageFailed = false
            progress.update(answers: [:], writingDrafts: drafts)
        } catch { draftStorageFailed = true; self.error = error.localizedDescription }
    }

    private var draftScope: String { "draft/\(start.courseId ?? "")/\(start.sessionId)" }

    private func discardDrafts() async {
        guard let client = model.makeClient() else { return }
        busy = true
        defer { busy = false }
        await progress.suspend()
        do {
            let latest = try await client.fetchPractice(sessionId: start.sessionId)
            guard model.isCurrentLearningClient(client), model.practiceStart?.sessionId == start.sessionId,
                  latest.isVocabularyStudy, latest.sessionId == start.sessionId,
                  latest.courseId == start.courseId, latest.mode == start.mode,
                  let revision = latest.progressRevision else {
                throw SottoAPIError.message("The saved vocabulary session could not be read.")
            }
            try VocabularyPendingStore(client: client, scope: draftScope).clear()
            progress.replacePendingWithServerRevision(revision)
            drafts = latest.writingDrafts ?? [:]
            savedServerDrafts = drafts
            model.practiceStart = latest
            recoveredDrafts = false
            draftStorageFailed = false
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func act(_ action: String, card: SottoVocabularyCard, rating: String? = nil) async {
        guard !recoveredDrafts, !draftStorageFailed else { return }
        guard let client = model.makeClient() else { error = "Pair this device to continue."; return }
        busy = true
        defer { busy = false }
        do {
            let revision = try await progress.flushRevision()
            let input = pending ?? SottoVocabularyAction(action: action, expectedRevision: revision,
                itemId: action == "COMPLETE" ? nil : card.id,
                answer: action == "ANSWER" ? (drafts[card.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : nil,
                rating: action == "RATE" ? rating : nil)
            let store = VocabularyPendingStore(client: client, scope: actionScope)
            try store.save(input)
            pending = input
            let response = try await client.vocabularyAction(sessionId: start.sessionId, action: input)
            guard model.isCurrentLearningClient(client), model.practiceStart?.sessionId == start.sessionId else { throw CancellationError() }
            guard response.isVocabularyStudy, response.sessionId == start.sessionId,
                  response.courseId == start.courseId, response.mode == start.mode,
                  response.cards?.isEmpty == false, response.progressRevision != nil else {
                throw SottoAPIError.message("The saved vocabulary response could not be verified. Retry the same response.")
            }
            let feedback = response.cards?.first(where: { $0.id == input.itemId })?.feedback
            let confirmed = input.action == "COMPLETE" ? response.receipt != nil
                : input.action == "RATE" ? feedback?.outcome == "STUDIED" && feedback?.selfRating == input.rating
                : input.action == "ANSWER" ? feedback?.outcome == "ANSWERED" && feedback?.answer == input.answer
                : ["STUDIED", "REVEALED"].contains(feedback?.outcome ?? "")
            guard confirmed else { throw SottoAPIError.message("The server did not confirm this response. Retry the same response.") }
            try store.clear()
            try VocabularyPendingStore(client: client, scope: draftScope).clear()
            progress.acceptRevision(response.progressRevision ?? revision)
            savedServerDrafts = response.writingDrafts ?? drafts
            model.practiceStart = response
            if input.action == "RATE", input.rating == "KNOWN", index + 1 < (response.cards?.count ?? 0) {
                index += 1
            }
            pending = nil
            error = nil
        } catch let failure as SottoAPIError {
            if case let .http(status, _) = failure {
                if status == 409 { conflict = true }
                else if [400, 422].contains(status) {
                    do { try VocabularyPendingStore(client: client, scope: actionScope).clear(); pending = nil }
                    catch { self.error = error.localizedDescription; return }
                }
            }
            error = failure.localizedDescription
        } catch { self.error = error.localizedDescription }
    }

    private func reload() async {
        guard let client = model.makeClient() else { return }
        busy = true
        defer { busy = false }
        do {
            await progress.suspend()
            let latest = try await client.fetchPractice(sessionId: start.sessionId)
            guard model.isCurrentLearningClient(client), model.practiceStart?.sessionId == start.sessionId else { throw CancellationError() }
            guard latest.isVocabularyStudy, latest.sessionId == start.sessionId,
                  latest.courseId == start.courseId, latest.mode == start.mode,
                  let revision = latest.progressRevision else {
                throw SottoAPIError.message("The saved vocabulary session could not be read.")
            }
            try VocabularyPendingStore(client: client, scope: actionScope).clear()
            progress.replacePendingWithServerRevision(revision)
            drafts = latest.writingDrafts ?? [:]
            savedServerDrafts = drafts
            try VocabularyPendingStore(client: client, scope: draftScope).clear()
            recoveredDrafts = false
            model.practiceStart = latest
            index = (latest.cards ?? []).firstIndex(where: { $0.feedback == nil }) ?? max(0, (latest.cards ?? []).count - 1)
            pending = nil
            conflict = false
            error = nil
        } catch { progress.resume(); self.error = error.localizedDescription }
    }

}
