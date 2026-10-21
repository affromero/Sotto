import SwiftUI

struct PlayRootView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.sottoLayout) private var layout
    @ObservedObject var coordinator: PlayCoordinator
    @State private var recovery = UUID()
    @State private var erasingGames = false
    @State private var discardingAction: UUID?
    @State private var discardingSafety: UUID?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let error = coordinator.error {
                        Text(error).foregroundStyle(SottoTheme.rose).accessibilityAddTraits(.updatesFrequently)
                    }
                    if let notice = coordinator.notice { Text(notice).foregroundStyle(SottoTheme.success) }
                    if coordinator.accessRevoked {
                        Text("Access changed. Reconnect with the same saved profile to check again.")
                        Button("Check access again") { recovery = UUID() }.buttonStyle(SottoSecondaryButtonStyle())
                    } else if coordinator.state == nil {
                        Text("Your saved game data has been preserved.")
                        Button("Try opening saved games again") {
                            do { coordinator.state = try coordinator.store.load(); coordinator.error = nil; recovery = UUID() }
                            catch { coordinator.report(error) }
                        }.buttonStyle(SottoSecondaryButtonStyle())
                        Button("Erase saved game data", role: .destructive) { erasingGames = true }.frame(minHeight: 44)
                    } else if coordinator.boundConnection != model.credentials {
                        ProgressView("Checking your connection")
                    } else {
                        if let pending = coordinator.state?.pendingSafety {
                            Text("A saved safety action needs confirmation. Retry sends its exact original request. Your game action and drafts are kept.")
                                .font(.callout).foregroundStyle(SottoTheme.muted)
                            if pending.connection != model.credentials {
                                Button("Restore safety action's original connection") {
                                    coordinator.runSafety { try await coordinator.switchConnection(pending.connection) }
                                }.buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.safetyBusy)
                            } else {
                                Button("Recover saved safety action") {
                                    coordinator.runSafety { try await coordinator.retryAction(slot: .safety) }
                                }.buttonStyle(SottoPrimaryButtonStyle()).disabled(coordinator.safetyBusy)
                            }
                            Button("Discard saved safety action", role: .destructive) { discardingSafety = pending.id }
                                .frame(minHeight: 44).disabled(coordinator.safetyBusy)
                        }
                        if let pending = coordinator.state?.pending {
                            Text("A saved action needs confirmation. Retry keeps its original identity.")
                                .font(.callout).foregroundStyle(SottoTheme.muted)
                            if pending.connection != model.credentials {
                                Button("Restore original connection") {
                                    coordinator.run { try await coordinator.switchConnection(pending.connection) }
                                }.buttonStyle(SottoSecondaryButtonStyle()).disabled(normalLocked || coordinator.busy)
                            } else {
                                Button("Recover pending action") { coordinator.run { try await coordinator.retryAction() } }
                                    .buttonStyle(SottoSecondaryButtonStyle()).disabled(normalLocked || coordinator.busy)
                            }
                            Button("Discard pending action", role: .destructive) { discardingAction = pending.id }
                                .frame(minHeight: 44).disabled(normalLocked || coordinator.busy)
                        }
                        switch coordinator.screen {
                        case .lobby: PlayLobbyView(coordinator: coordinator).disabled(normalLocked)
                        case .join: PlayJoinView(coordinator: coordinator).disabled(normalLocked)
                        case .room: PlayRoomView(coordinator: coordinator).disabled(normalLocked)
                        case .notebook: PlayNotebookView(coordinator: coordinator).disabled(normalLocked)
                        case .safety: PlaySafetyView(coordinator: coordinator)
                        case .report: PlayReportView(coordinator: coordinator)
                        }
                    }
                }
                .id(coordinator.connectionGeneration)
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(SottoTheme.paper)
            .foregroundStyle(SottoTheme.ink)
            .tint(SottoTheme.primary)
            .navigationTitle("Play together")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { coordinator.endForeground(); model.showingPlay = false }.frame(minHeight: 44)
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Games") { coordinator.navigate(.lobby) }
                        Button("Join a game") { coordinator.navigate(.join) }
                        if model.hasSelectedProfile {
                            Button("Private notebook") { coordinator.navigate(.notebook) }
                        }
                        Button("Game safety") { coordinator.navigate(.safety) }
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
                    }.accessibilityLabel("Play menu")
                }
            }
        }
        .task(id: Lifecycle(scene: scenePhase, screen: coordinator.screen,
            connection: coordinator.connectionGeneration, recovery: recovery)) {
            guard scenePhase == .active else { coordinator.endForeground(); return }
            await coordinator.foreground()
        }
        .onChange(of: model.credentials) { _, _ in coordinator.observeConnection() }
        .onDisappear { coordinator.endForeground() }
        .confirmationDialog("Erase saved invitations, game drafts and archived connections from this device?", isPresented: $erasingGames, titleVisibility: .visible) {
            Button("Erase saved game data", role: .destructive) {
                do { try coordinator.clearProtectedData(); coordinator.error = nil; recovery = UUID() }
                catch { coordinator.report(error) }
            }
            Button("Cancel", role: .cancel) { }
        }
        .confirmationDialog("The server may already have saved this action. Check the game before submitting again.", isPresented: discardBinding, titleVisibility: .visible, presenting: discardingAction) { id in
            Button("Discard pending action", role: .destructive) {
                do { try coordinator.discardPendingAction(id: id) }
                catch { coordinator.report(error) }
                discardingAction = nil
            }
            Button("Cancel", role: .cancel) { discardingAction = nil }
        }
        .confirmationDialog("This safety action may already have saved. Check your blocks and reports before submitting again.", isPresented: Binding(
            get: { discardingSafety != nil }, set: { if !$0 { discardingSafety = nil } }), titleVisibility: .visible) {
            if let id = discardingSafety {
                Button("Discard saved safety action", role: .destructive) {
                    do { try coordinator.discardSafetyAction(id: id) } catch { coordinator.report(error) }
                    discardingSafety = nil
                }
            }
            Button("Cancel", role: .cancel) { discardingSafety = nil }
        }
    }

    private struct Lifecycle: Equatable {
        let scene: ScenePhase
        let screen: PlayScreen
        let connection: UUID
        let recovery: UUID
    }
    private var discardBinding: Binding<Bool> {
        Binding(get: { discardingAction != nil }, set: { if !$0 { discardingAction = nil } })
    }
    private var normalLocked: Bool { coordinator.safetyBusy || coordinator.state?.pendingSafety != nil }
}

struct PlaySettingsFields: View {
    @Binding var settings: PlaySettings
    private let languages = [("en", "English"), ("de", "German"), ("es", "Spanish"),
        ("fr", "French"), ("pt", "Portuguese"), ("it", "Italian"),
        ("ja", "Japanese"), ("zh", "Chinese"), ("ko", "Korean")]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Support language", selection: $settings.nativeLang) {
                ForEach(languages, id: \.0) { Text($0.1).tag($0.0) }
            }.frame(minHeight: 44).accessibilityIdentifier("play.supportLanguage")
            Picker("Learning language", selection: $settings.targetLang) {
                ForEach(languages, id: \.0) { Text($0.1).tag($0.0) }
            }.frame(minHeight: 44).accessibilityIdentifier("play.targetLanguage")
            Picker("Your level", selection: $settings.level) {
                ForEach(PlayLevel.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }.frame(minHeight: 44)
            Text("Each player chooses their own languages and level. Turns alternate between you.")
                .font(.caption).foregroundStyle(SottoTheme.muted)
        }.pickerStyle(.menu)
    }
}
