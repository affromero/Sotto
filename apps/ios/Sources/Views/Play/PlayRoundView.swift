import SwiftUI

struct PlayRoundView: View {
    @ObservedObject var coordinator: PlayCoordinator
    let room: PlayRoom
    let round: PlayRound
    @State private var showMeanings = false
    private var locked: Bool { coordinator.gameControlsDisabled }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("ROUND \(round.order + 1) · \(round.targetLang.uppercased()) · \(round.level.rawValue)")
                .font(.caption.monospaced()).foregroundStyle(SottoTheme.muted)
            Text(round.prompt).font(.system(.title2, design: .serif)).textSelection(.enabled)
            Text(round.instruction).foregroundStyle(SottoTheme.muted)
            Text(round.guidance).font(.caption).foregroundStyle(SottoTheme.muted)
            switch round.content {
            case let .prediction(value): prediction(value)
            case let .describe(value): describe(value)
            case let .mission(value): mission(value)
            }
            ForEach(Array(round.hints.enumerated()), id: \.offset) { _, hint in
                Label(hint.text, systemImage: "lightbulb").textSelection(.enabled)
            }
            if round.allowedActions.contains(.feedback) {
                Text("Did you understand your partner?").font(.headline)
                PlayDraftField(coordinator: coordinator, room: room, round: round, action: .feedback,
                    label: "Optional correction", submitLabel: "Understood")
            }
            if round.allowedActions.contains(.hint) {
                DisclosureGroup("Give a hint") {
                    PlayDraftField(coordinator: coordinator, room: room, round: round, action: .hint,
                        label: "A short hint", submitLabel: "Send hint")
                }
            }
            if round.result != nil { PlayRoundRecap(round: round) }
            if round.allowedActions.contains(.skip) {
                Button("Skip this round") { coordinator.run { try await coordinator.command(.skip, in: room) } }
                    .frame(minHeight: 44).disabled(locked)
            }
            if !round.visibleTexts.isEmpty {
                PlayPhraseCapture(coordinator: coordinator, round: round)
                    .id("\(room.ownMember?.id ?? "")/\(room.id)/\(round.id)")
            }
        }.onChange(of: round.id) { _, _ in showMeanings = false }
    }
    @ViewBuilder private func prediction(_ value: PlayPrediction) -> some View {
        if value.questionStyle == .choices {
            ForEach(value.choices) { card in
                Button {
                    coordinator.run { try await coordinator.command(.choose(card.id), in: room) }
                } label: {
                    HStack(spacing: 16) {
                        Text(card.symbol).font(.largeTitle)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(card.text).font(.title3.bold())
                            if showMeanings, let support = card.supportText { Text(support).font(.caption).foregroundStyle(SottoTheme.muted) }
                        }
                        Spacer()
                        if value.ownAnswer == card.id.rawValue { Image(systemName: "checkmark.circle.fill") }
                    }.frame(maxWidth: .infinity, minHeight: 64, alignment: .leading).padding(16)
                        .background(SottoTheme.surface).clipShape(RoundedRectangle(cornerRadius: 14))
                }.buttonStyle(.plain).disabled(locked || !round.allowedActions.contains(.choose))
                    .accessibilityIdentifier("play.choice.\(card.id.rawValue)")
            }
            if value.choices.contains(where: { $0.supportText != nil }) {
                Button(showMeanings ? "Hide meanings" : "Show meanings") { showMeanings.toggle() }
                    .frame(minHeight: 44).accessibilityValue(showMeanings ? "Shown" : "Hidden")
            }
        } else if round.allowedActions.contains(.answer) {
            PlayDraftField(coordinator: coordinator, room: room, round: round, action: .answer,
                label: "Your answer", submitLabel: "Lock in answer")
        }
        if let own = value.ownAnswer { Text("Your pick: \(value.answerLabel(own))") }
        if let other = value.otherAnswer { Text("Partner's pick: \(value.answerLabel(other))") }
        else if value.otherCommitted { Text("Your partner has locked in a pick.").foregroundStyle(SottoTheme.muted) }
        else if value.ownAnswer != nil { Text("Waiting for your partner's pick.").foregroundStyle(SottoTheme.muted) }
    }
    @ViewBuilder private func describe(_ value: PlayDescribe) -> some View {
        if let target = value.target { Label(target, systemImage: "eye.slash").font(.title2).textSelection(.enabled) }
        if round.allowedActions.contains(.setTarget) {
            ForEach(value.targetSuggestions ?? []) { card in
                Button("\(card.symbol)  \(card.text)") {
                    coordinator.run { try await coordinator.command(.text(.setTarget, card.text), in: room) }
                }.buttonStyle(SottoSecondaryButtonStyle()).disabled(locked)
            }
        }
        if let clue = value.clue { Text(clue).font(.title3).textSelection(.enabled) }
        if let guess = value.guess { Text("Guess: \(guess)").textSelection(.enabled) }
        ForEach([PlayActionType.setTarget, .giveClue, .guess].filter { round.allowedActions.contains($0) }, id: \.self) { action in
            PlayDraftField(coordinator: coordinator, room: room, round: round, action: action,
                label: action == .setTarget ? "Or your own secret word" : action == .giveClue ? "Describe it without naming it" : "Your guess",
                submitLabel: action == .setTarget ? "Keep this word secret" : action == .giveClue ? "Send clue" : "Guess")
        }
    }
    @ViewBuilder private func mission(_ value: PlayMission) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Your secret objective", systemImage: "eye.slash").font(.caption.monospaced())
            Text(value.ownObjective).font(.headline)
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(SottoTheme.surface)
        ForEach(Array(value.messages.enumerated()), id: \.offset) { _, message in
            VStack(alignment: .leading, spacing: 4) {
                Text(message.seat == room.ownSeat ? "You" : "Partner").font(.caption).foregroundStyle(SottoTheme.muted)
                Text(message.text).textSelection(.enabled)
            }.accessibilityElement(children: .combine)
        }
        if let twist = value.twist {
            Label("Plot twist", systemImage: "sparkles").font(.headline).foregroundStyle(SottoTheme.primary)
            Text(twist)
        }
        Text("\(value.remainingMessages) messages left together").font(.caption).foregroundStyle(SottoTheme.muted)
        if round.allowedActions.contains(.message) {
            PlayDraftField(coordinator: coordinator, room: room, round: round, action: .message,
                label: "Your next line", submitLabel: "Send line")
        } else if value.remainingMessages > 0, round.phase == .exchange {
            Text("Your partner's turn.").foregroundStyle(SottoTheme.muted)
        }
        if round.allowedActions.contains(.missionDone) {
            Text("Did you achieve your objective?").font(.headline)
            ForEach([true, false], id: \.self) { achieved in
                Button(achieved ? "Yes, mission done" : "Not this time") {
                    coordinator.run { try await coordinator.command(.missionDone(achieved), in: room) }
                }.buttonStyle(SottoSecondaryButtonStyle()).disabled(locked)
            }
        }
        if let other = value.otherObjective { Text("Your partner's objective: \(other)") }
        if value.ownOutcome != nil, value.otherOutcome == nil { Text("Waiting for your partner's outcome.").foregroundStyle(SottoTheme.muted) }
    }
}

struct PlayDraftField: View {
    @ObservedObject var coordinator: PlayCoordinator
    let room: PlayRoom
    let round: PlayRound
    let action: PlayActionType
    let label: String
    let submitLabel: String
    @State private var text = ""
    private var key: String { coordinator.draftKey(room: room, round: round, action: action) }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField(label, text: $text, axis: .vertical).lineLimit(1...5).textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("play.draft.\(action.rawValue)")
            Button(submitLabel) {
                let submitted = text.trimmingCharacters(in: .whitespacesAndNewlines)
                coordinator.run {
                    let command: PlayCommand = action == .feedback
                        ? .feedback(understood: true, correction: submitted.isEmpty ? nil : submitted)
                        : .text(action, submitted)
                    try await coordinator.command(command, in: room)
                }
            }.buttonStyle(SottoSecondaryButtonStyle())
                .disabled(coordinator.gameControlsDisabled || (action != .feedback && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            if action == .feedback {
                Button("Needs another try") {
                    let submitted = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    coordinator.run {
                        try await coordinator.command(.feedback(understood: false, correction: submitted.isEmpty ? nil : submitted), in: room)
                    }
                }.buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.gameControlsDisabled)
            }
        }
        .id(key)
        .onAppear { text = coordinator.state?.drafts[key] ?? "" }
        .onChange(of: key) { _, value in text = coordinator.state?.drafts[value] ?? "" }
        .onChange(of: text) { _, value in
            if value.count > 500 { text = String(value.prefix(500)) }
            else { coordinator.saveDraft(value, key: key) }
        }
        .onChange(of: coordinator.state?.drafts[key]) { previous, next in
            if next == nil, text == previous { text = "" }
        }
    }
}
