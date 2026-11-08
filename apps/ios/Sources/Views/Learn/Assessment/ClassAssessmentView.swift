import SwiftUI

struct ClassAssessmentView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let classId: String
    let attempt: Int
    let onComplete: (SottoClassSubmitResult) -> Void

    @State private var status: SottoClassAssessmentStatus?
    @State private var material: SottoClassAssessmentMaterial?
    @State private var work = ClassAssessmentWork()
    @State private var storage: ClassAssessmentWorkStore?
    @State private var writing: [String: SottoClassAssessmentWritingStatus] = [:]
    @State private var speaking: [String: SottoClassAssessmentSpeakingStatus] = [:]
    @State private var hasSavedSpeaking = false
    @State private var verified = false
    @State private var captures: [PendingAssessmentCapture] = []
    @State private var captureToDiscard: PendingAssessmentCapture?
    @State private var confirmDiscardCapture = false
    @State private var recordingPrompt: String?
    @State private var owner: SottoLearnerIdentity?
    @State private var busy = false
    @State private var error: String?

    private func current(_ client: SottoAPIClient) -> Bool {
        !Task.isCancelled && owner == SottoLearnerIdentity(client) && model.isCurrentLearningClient(client) &&
            model.selectedClass?.id == classId && (model.selectedClass?.attempt ?? 1) == attempt
    }

    private var ownerIsCurrent: Bool {
        guard let client = model.makeClient() else { return false }
        return current(client)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Show what you have learned").font(.title.bold())
                    if let error { Text(error).foregroundStyle(.red) }
                    if ownerIsCurrent {
                        ForEach(captures, id: \.requestId) { capture in
                            VStack(alignment: .leading, spacing: 8) {
                                Text("A speaking recording from an assessment needs recovery.")
                                if let url = capture.audioURL {
                                    ShareLink("Save recording", item: url)
                                }
                                if capture.hasRetained {
                                    Text("Check the saved response before removing this recording.")
                                } else {
                                    Button("Discard unsent recording", role: .destructive) {
                                        captureToDiscard = capture
                                        confirmDiscardCapture = true
                                    }
                                }
                            }
                        }
                    }
                    if status == nil && error == nil { ProgressView("Checking assessment") }
                    if status?.status == .practiceRequired { Text("Finish the practice exercises before starting the assessment.") }
                    if status?.status == .unresolved { Text("This assessment needs recovery before it can continue.") }
                    if status?.status == .available {
                        Button("Prepare assessment") { Task { await prepare() } }
                            .buttonStyle(SottoPrimaryButtonStyle()).disabled(busy || !verified || hasSavedSpeaking)
                    }
                    if status?.status == .pending { ProgressView("Preparing assessment") }
                    if hasSavedSpeaking && material == nil {
                        Text("A saved recording needs recovery before this assessment can continue.")
                            .foregroundStyle(SottoTheme.muted)
                    }
                    if ownerIsCurrent, let material { assessment(material) }
                    if owner != nil && !ownerIsCurrent {
                        Text("Reopen the assessment for the current learner and class.")
                    }
                    if error != nil {
                        Button("Check saved status") { Task { await refresh() } }
                            .buttonStyle(SottoSecondaryButtonStyle()).disabled(busy)
                    }
                }
                .padding(20)
                .frame(maxWidth: 760, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Assessment")
            .toolbar { Button("Close") { dismiss() }.disabled(busy) }
            .confirmationDialog("Discard this unsent recording?", isPresented: $confirmDiscardCapture) {
                Button("Discard recording", role: .destructive) { Task { await discardCapture() } }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Save a copy first if you want to keep it.")
            }
        }
        .task { await refresh() }
        .task(id: status?.status) {
            while status?.status == .pending && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if !Task.isCancelled { await refresh() }
            }
        }
    }

    @ViewBuilder private func assessment(_ material: SottoClassAssessmentMaterial) -> some View {
        ForEach(material.sections) { section in
            VStack(alignment: .leading, spacing: 12) {
                Text(section.skill.capitalized).font(.title2.bold())
                if let passage = section.passageText { Text(passage) }
                if section.skill == "LISTENING", section.audioAvailable == true {
                    LearnerAudioPlayer(reference: "/api/v1/classes/\(classId)/assessment/\(material.id)/audio/listening/\(section.id)")
                }
                ForEach(section.items) { item in
                    if let question = item.question, let options = item.options {
                        Text(question).font(.headline)
                        ForEach(Array(options.enumerated()), id: \.offset) { index, option in
                            Button {
                                updateWork { $0.choices[item.id] = index }
                            } label: {
                                Label(option, systemImage: work.choices[item.id] == index ? "largecircle.fill.circle" : "circle")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            }
                            .disabled(busy || work.pending != nil)
                        }
                    } else if section.skill == "WRITING", let task = item.task {
                        Text(task).font(.headline)
                        TextEditor(text: Binding(
                            get: { work.drafts[item.id] ?? "" },
                            set: { value in updateWork { $0.drafts[item.id] = value } }
                        ))
                        .frame(minHeight: 120)
                        .disabled(busy || work.pending != nil || (writing[item.id]?.status ?? .notStarted) != .notStarted)
                        if let saved = writing[item.id], saved.status != .notStarted {
                            Text(saved.status == .completed ? "Response saved." : "Check saved writing status before continuing.")
                            if saved.status != .completed {
                                Button("Check saved writing") { Task { await refresh() } }
                                    .disabled(busy)
                            }
                            if let text = saved.text, work.drafts[item.id] != text {
                                Text("Saved response: \(text)")
                                Button("Use saved response") { updateWork { $0.drafts[item.id] = text } }
                                    .disabled(busy || work.pending != nil)
                            }
                        } else {
                            Button("Save response") { Task { await saveWriting(item.id) } }
                                .disabled(busy || work.pending != nil || (work.drafts[item.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    } else if section.skill == "SPEAKING" {
                        if let task = item.task { Text(task) }
                        if let client = model.makeClient(), let revision = status?.revision {
                            ClassAssessmentSpeakingView(client: client, classId: classId, attempt: attempt,
                                assessmentId: material.id, revision: revision, promptId: item.id,
                                allowed: { current(client) && verified && !busy && (recordingPrompt == nil || recordingPrompt == item.id) },
                                onRecording: { active in recordingPrompt = active ? item.id : nil },
                                onChanged: { Task { await refresh() } })
                        }
                    }
                }
            }
        }
        Button(work.pending == nil ? "Submit assessment" : "Retry submission") { Task { await submit() } }
            .buttonStyle(SottoPrimaryButtonStyle())
            .disabled(busy || recordingPrompt != nil || !canSubmit(material))
        if hasSavedSpeaking {
            Text("A saved recording needs recovery before this assessment can be submitted.")
                .foregroundStyle(SottoTheme.muted)
        }
        if work.rejected == true {
            Button("Change answers") { Task { await unlockAnswers() } }
                .buttonStyle(SottoSecondaryButtonStyle()).disabled(busy)
        }
    }

    private func canSubmit(_ material: SottoClassAssessmentMaterial) -> Bool {
        guard verified, !hasSavedSpeaking, material.speakingIsComplete(speaking) else { return false }
        return material.sections.allSatisfy { section in
            section.items.allSatisfy { item in
                if item.options != nil { return work.choices[item.id] != nil }
                if section.skill == "WRITING" {
                    return writing[item.id]?.status == .completed && writing[item.id]?.text == work.drafts[item.id]
                }
                if section.skill == "SPEAKING" { return speaking[item.id]?.status == .completed }
                return false
            }
        }
    }

    private func updateWork(_ update: (inout ClassAssessmentWork) -> Void) {
        var next = work
        update(&next)
        do {
            guard let storage else { throw SottoAPIError.message("Assessment storage is unavailable.") }
            try storage.saveDrafts(choices: next.choices, drafts: next.drafts)
            work = next
        } catch { self.error = error.localizedDescription }
    }

    private func refresh() async {
        guard !busy, let client = model.makeClient() else { return }
        if owner == nil { owner = SottoLearnerIdentity(client) }
        guard current(client) else { return }
        busy = true
        verified = false
        defer { busy = false }
        do {
            captures = try AssessmentSpeakingStore.pendingCaptures(client: client, classId: classId, classAttempt: attempt)
            let pending = try ClassAssessmentWorkStore.pending(client: client, classId: classId, classAttempt: attempt)
            guard pending.count <= 1 else {
                throw SottoAPIError.message("More than one saved assessment needs recovery.")
            }
            if let saved = pending.first {
                let retained = try saved.load()
                guard let choices = retained.pending else { throw CancellationError() }
                if retained.rejected != true {
                    let recordings = try AssessmentSpeakingStore.pending(client: client, classId: classId, classAttempt: attempt)
                    let captures = try AssessmentSpeakingStore.hasCapture(client: client, classId: classId, classAttempt: attempt)
                    guard recordings.isEmpty, !captures else {
                        throw SottoAPIError.message("A saved recording needs recovery before this assessment can continue.")
                    }
                    do {
                        let receipt = try await client.submitClassAssessment(classId: classId,
                            assessmentId: saved.assessmentId, choices: choices)
                        guard current(client) else { return }
                        var confirmed: [String: String] = [:]
                        for (promptId, text) in retained.drafts where !text.isEmpty {
                            let writing = try await client.fetchAssessmentWriting(classId: classId,
                                assessmentId: saved.assessmentId, promptId: promptId)
                            guard current(client), writing.status == .completed, writing.text == text else {
                                throw SottoAPIError.message("Saved writing differs from your retained draft.")
                            }
                            confirmed[promptId] = text
                        }
                        try saved.clearConfirmed(choices: choices, receipt: receipt, confirmedWriting: confirmed)
                        onComplete(receipt)
                        return
                    } catch let SottoAPIError.http(code, _) where code == 400 || code == 409 {
                        guard current(client) else { return }
                        try saved.markRejected(choices: choices)
                    }
                }
            }
            let next = try await client.fetchClassAssessmentStatus(classId: classId, attempt: attempt)
            guard current(client) else { return }
            var nextMaterial: SottoClassAssessmentMaterial?
            var nextWriting: [String: SottoClassAssessmentWritingStatus] = [:]
            var nextSpeaking: [String: SottoClassAssessmentSpeakingStatus] = [:]
            var confirmedRecordings: [(AssessmentSpeakingStore, RetainedAssessmentSpeaking, SottoClassAssessmentSpeakingStatus)] = []
            var savedSpeaking = try AssessmentSpeakingStore.hasCapture(client: client, classId: classId, classAttempt: attempt)
            let priorRecordings = try AssessmentSpeakingStore.pending(client: client, classId: classId, classAttempt: attempt)
            savedSpeaking = savedSpeaking || !priorRecordings.isEmpty
            if next.status == .ready, let id = next.assessmentId, let revision = next.revision {
                let loaded = try await client.fetchClassAssessment(classId: classId, assessmentId: id, attempt: attempt)
                for section in loaded.sections where section.skill == "WRITING" {
                    for item in section.items {
                        nextWriting[item.id] = try await client.fetchAssessmentWriting(classId: classId, assessmentId: id, promptId: item.id)
                    }
                }
                for section in loaded.sections where section.skill == "SPEAKING" {
                    for item in section.items {
                        let response = try await client.fetchAssessmentSpeaking(classId: classId, assessmentId: id, promptId: item.id)
                        guard current(client) else { return }
                        let saved = try AssessmentSpeakingStore(client: client, classId: classId, classAttempt: attempt,
                                                               assessmentId: id, revision: revision, promptId: item.id)
                        if let recording = try saved.load(), response.status == .completed,
                           response.requestId?.lowercased() == recording.requestId.uuidString.lowercased() {
                            confirmedRecordings.append((saved, recording, response))
                        }
                        if try saved.recoverCapture() != nil { savedSpeaking = true }
                        nextSpeaking[item.id] = response
                    }
                }
                let confirmed = try await client.fetchClassAssessmentStatus(classId: classId, attempt: attempt)
                guard current(client), confirmed == next else {
                    throw SottoAPIError.message("The assessment changed. Check its status again.")
                }
                for (store, recording, response) in confirmedRecordings {
                    try store.clearConfirmed(recording, status: response)
                }
                let pendingRecordings = try AssessmentSpeakingStore.pending(client: client, classId: classId, classAttempt: attempt)
                let pendingCaptures = try AssessmentSpeakingStore.hasCapture(client: client, classId: classId, classAttempt: attempt)
                savedSpeaking = !pendingRecordings.isEmpty || pendingCaptures
                let store = ClassAssessmentWorkStore(client: client, classId: classId, classAttempt: attempt,
                                                     assessmentId: id, revision: revision)
                var retained = try store.load()
                for (id, saved) in nextWriting where retained.drafts[id] == nil {
                    if let text = saved.text { retained.drafts[id] = text }
                }
                if retained.pending == nil { try store.saveDrafts(choices: retained.choices, drafts: retained.drafts) }
                storage = store
                work = retained
                nextMaterial = loaded
            }
            guard current(client) else { return }
            status = next
            material = nextMaterial
            writing = nextWriting
            speaking = nextSpeaking
            hasSavedSpeaking = savedSpeaking
            captures = try AssessmentSpeakingStore.pendingCaptures(client: client, classId: classId, classAttempt: attempt)
            verified = true
            error = nil
        } catch {
            guard current(client) else { return }
            self.error = error.localizedDescription
        }
    }

    private func discardCapture() async {
        guard !busy, let client = model.makeClient(), current(client), let capture = captureToDiscard else { return }
        do {
            let saved = try AssessmentSpeakingStore(client: client, classId: classId, classAttempt: attempt,
                                                   assessmentId: capture.assessmentId, revision: capture.revision,
                                                   promptId: capture.promptId)
            try saved.discardUnsentCapture(requestId: capture.requestId)
            captureToDiscard = nil
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    private func prepare() async {
        guard !busy, let client = model.makeClient(), current(client),
              let displayed = status, displayed.status == .available, let revision = displayed.revision else { return }
        busy = true
        do {
            let checked = try await client.fetchClassAssessmentStatus(classId: classId, attempt: attempt)
            guard current(client), checked == displayed else { throw CancellationError() }
            _ = try await client.prepareClassAssessment(classId: classId, attempt: attempt, revision: revision)
            busy = false
            await refresh()
        } catch {
            busy = false
            if current(client) { self.error = error.localizedDescription }
        }
    }

    private func saveWriting(_ promptId: String) async {
        guard !busy, let client = model.makeClient(), current(client), let material,
              let text = work.drafts[promptId] else { return }
        busy = true
        do {
            _ = try await client.saveAssessmentWriting(classId: classId, assessmentId: material.id, promptId: promptId, text: text)
            busy = false
            await refresh()
        } catch {
            busy = false
            if current(client) { self.error = error.localizedDescription }
        }
    }

    private func submit() async {
        guard !busy, let client = model.makeClient(), current(client), let material, let storage,
              canSubmit(material) else { return }
        busy = true
        defer { busy = false }
        do {
            let recordings = try AssessmentSpeakingStore.pending(client: client, classId: classId, classAttempt: attempt)
            let captures = try AssessmentSpeakingStore.hasCapture(client: client, classId: classId, classAttempt: attempt)
            guard recordings.isEmpty, !captures else {
                throw SottoAPIError.message("A saved recording needs recovery before this assessment can be submitted.")
            }
            let choices = try storage.lockSubmission()
            work = try storage.load()
            let receipt = try await client.submitClassAssessment(classId: classId, assessmentId: material.id, choices: choices)
            guard current(client) else { return }
            let confirmed = writing.compactMapValues { $0.status == .completed ? $0.text : nil }
            try storage.clearConfirmed(choices: choices, receipt: receipt, confirmedWriting: confirmed)
            onComplete(receipt)
        } catch {
            if current(client) {
                if case let SottoAPIError.http(code, _) = error, (code == 400 || code == 409),
                   let choices = work.pending {
                    do {
                        try storage.markRejected(choices: choices)
                        work = try storage.load()
                    } catch { self.error = error.localizedDescription; return }
                }
                self.error = error.localizedDescription
            }
        }
    }

    private func unlockAnswers() async {
        guard !busy, let client = model.makeClient(), current(client), let material, let status,
              let storage, let choices = work.pending, work.rejected == true else { return }
        busy = true
        defer { busy = false }
        do {
            let saved = try await client.fetchClass(classId: classId)
            let checked = try await client.fetchClassAssessmentStatus(classId: classId, attempt: attempt)
            guard current(client), status.revision == storage.revision else {
                throw SottoAPIError.message("The assessment changed. Check its saved status.")
            }
            try checked.validateUnlock(classDetail: saved, classId: classId, attempt: attempt,
                                       assessmentId: material.id, revision: storage.revision)
            try storage.unlockRejected(choices: choices)
            work = try storage.load()
            error = nil
        } catch {
            if current(client) { self.error = error.localizedDescription }
        }
    }
}
