import SwiftUI

struct PlayLobbyView: View {
    @EnvironmentObject private var model: SottoAppModel
    @ObservedObject var coordinator: PlayCoordinator
    @State private var kind: PlayKind = .mixed
    @State private var theme: PlayTheme = .everyday
    @State private var settings = PlaySettings()
    @State private var openQuestions = false
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("A few turns. A new word. An unexpected answer.")
                .font(.system(.largeTitle, design: .serif)).fixedSize(horizontal: false, vertical: true)
            Text("Pick for each other, describe a secret card, or talk your way through a short mission.")
                .foregroundStyle(SottoTheme.muted)
            if let profile = model.activeProfile {
                Label("Playing as \(profile.name)", systemImage: "person.crop.circle")
                if !coordinator.sharingAllowed {
                    Text(coordinator.safetyStatus?.sharingRestricted == true
                        ? "This profile is restricted from partner games. You can still manage blocks and reports."
                        : "Read and accept this server's game conduct before playing.")
                        .foregroundStyle(SottoTheme.muted)
                    Button("Open game safety") { coordinator.navigate(.safety) }
                        .buttonStyle(SottoPrimaryButtonStyle())
                }
                Picker("Game", selection: $kind) {
                    ForEach(PlayKind.allCases, id: \.self) { Text($0.title).tag($0) }
                }.frame(minHeight: 44)
                Picker("Theme", selection: $theme) {
                    ForEach(PlayTheme.allCases, id: \.self) { Text($0.title).tag($0) }
                }.frame(minHeight: 44)
                PlaySettingsFields(settings: $settings)
                if kind == .mixed || kind == .knowMe {
                    Toggle("Use open questions instead of quick picks", isOn: $openQuestions)
                }
                Button("Create a game") {
                    coordinator.run { try await coordinator.create(kind: kind, theme: theme, settings: settings, openQuestions: openQuestions) }
                }.buttonStyle(SottoPrimaryButtonStyle())
                    .disabled(coordinator.gameControlsDisabled || !settings.isValid)
                if !coordinator.requests.isEmpty {
                    Text("Profile approval").font(.title2.bold())
                    PlayAdmissionList(coordinator: coordinator)
                }
                if !coordinator.rooms.isEmpty {
                    Text("Your games").font(.title2.bold())
                    ForEach(coordinator.rooms) { room in
                        Button {
                            coordinator.navigate(.room(room.id))
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(room.kind.title).font(.headline)
                                    Text("\(room.host.name) · \(room.guest?.name ?? "Waiting for a partner")")
                                        .font(.caption).foregroundStyle(SottoTheme.muted)
                                }
                                Spacer()
                                Text(room.status.rawValue.capitalized).font(.caption)
                            }.frame(minHeight: 52)
                        }.buttonStyle(.plain)
                        Divider()
                    }
                    if coordinator.roomsCursor != nil {
                        Button("Older games") { coordinator.run { try await coordinator.loadOlderRooms() } }
                            .buttonStyle(SottoSecondaryButtonStyle()).disabled(!coordinator.active || coordinator.busy)
                    }
                }
            } else {
                Text("Pair this device and select a profile to host. An invitation can add you as a new learner with the server owner's approval.")
            }
            Button("Join with a link, code or QR") { coordinator.navigate(.join) }
                .buttonStyle(SottoSecondaryButtonStyle())
            PlaySavedDataView(coordinator: coordinator)
        }.pickerStyle(.menu)
    }
}

struct PlayAdmissionList: View {
    @ObservedObject var coordinator: PlayCoordinator
    var body: some View {
        ForEach(coordinator.requests) { request in
            VStack(alignment: .leading, spacing: 10) {
                Text(request.name).font(.headline)
                Text("\(request.settings.targetLang.uppercased()) · \(request.settings.level.rawValue) · \(request.status.rawValue.replacingOccurrences(of: "_", with: " ").lowercased())")
                    .font(.caption).foregroundStyle(SottoTheme.muted)
                if request.candidateKind == .new, request.allowedActions.contains(.approveProfile) {
                    Text("This creates a persistent learner on your server.").font(.callout)
                }
                ForEach(request.allowedActions, id: \.self) { action in
                    Button(label(action, request: request)) {
                        coordinator.run { try await coordinator.approve(request, type: action) }
                    }.buttonStyle(SottoSecondaryButtonStyle())
                        .disabled(!coordinator.active || coordinator.busy || coordinator.state?.pending != nil)
                }
            }
            Divider()
        }
    }
    private func label(_ action: PlayApproval, request: PlayPendingRequest) -> String {
        switch action {
        case .accept: "Let into this game"
        case .decline: "Decline"
        case .approveProfile:
            coordinator.room?.id == request.roomId && coordinator.room?.ownSeat == .host
                ? "Approve profile and let in" : "Approve new profile"
        }
    }
}
