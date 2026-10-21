import SwiftUI

struct PlayJoinView: View {
    @EnvironmentObject private var model: SottoAppModel
    @ObservedObject var coordinator: PlayCoordinator
    @State private var link = ""
    @State private var server = ""
    @State private var code = ""
    @State private var name = ""
    @State private var settings = PlaySettings()
    @State private var consent = false
    @State private var scanner = false
    @State private var conduct = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Join your partner").font(.system(.largeTitle, design: .serif))
            if let invite = coordinator.state?.admission?.invitation ?? coordinator.state?.invitation {
                Text(invite.serverURL.absoluteString).font(.callout.monospaced()).textSelection(.enabled)
                Text(invite.formattedCode).font(.title2.monospaced()).textSelection(.enabled)
                if let preview = coordinator.preview {
                    Text("\(preview.hostName) invited you to \(preview.kind.title.lowercased()).")
                    Text(preview.hostWaiting ? "Your host is waiting." : "Your host must return to the waiting room before you can enter.")
                        .foregroundStyle(SottoTheme.muted)
                }
                if let pending = coordinator.state?.admission {
                    if pending.command.acceptedConductVersion == nil, pending.conductVersion == nil {
                        PlayConductPanel(coordinator: coordinator, accepted: $conduct)
                        Button("Accept conduct for saved invitation") {
                            coordinator.run { try await coordinator.acceptSavedAdmissionConduct() }
                        }.buttonStyle(SottoPrimaryButtonStyle()).disabled(coordinator.busy || !conduct)
                        if pending.delivery == nil {
                            Button("Keep unavailable old request and start again") {
                                coordinator.run { try await coordinator.retainUnknownLegacyAdmission() }
                            }.buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.busy || !conduct)
                            Text("Use this only if the server cannot find the saved request. Its original proof is kept in recoveries.")
                                .font(.caption).foregroundStyle(SottoTheme.muted)
                        }
                    }
                    Text("Joining as \(pending.command.candidate.name ?? pending.existingConnection?.selectedProfile?.name ?? "your profile")")
                        .font(.headline)
                    Text(statusText).foregroundStyle(SottoTheme.muted)
                    if let original = pending.existingConnection, original != model.credentials {
                        Button("Return to \(original.selectedProfile?.name ?? "original profile") at \(original.serverURL.host() ?? "server")") {
                            coordinator.run { try await coordinator.switchConnection(original) }
                        }.buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.busy)
                    }
                    if coordinator.joinStatus == .accepted || coordinator.joinStatus == .claimed || pending.delivery != nil {
                        Text("Join as \(pending.delivery?.profile.name ?? pending.command.candidate.name ?? pending.existingConnection?.selectedProfile?.name ?? "your profile") at \(invite.serverURL.host() ?? "this server").\(pending.command.candidate.kind == .new ? " Your current connection, \(model.activeProfile?.name ?? "unpaired") at \(model.credentials?.serverURL.host() ?? "this device"), stays saved." : "")")
                            .font(.callout)
                        Button("Finish joining") { coordinator.run { try await coordinator.finishAdmission() } }
                            .buttonStyle(SottoPrimaryButtonStyle()).disabled(coordinator.busy
                                || (pending.command.acceptedConductVersion == nil && pending.conductVersion == nil))
                    } else {
                        Button("Retry saved request") { coordinator.run { try await coordinator.retryIntake() } }
                            .buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.busy)
                    }
                    if pending.delivery == nil {
                        Button("Discard this invitation", role: .destructive) {
                            do { try coordinator.discardInvitation() } catch { coordinator.report(error) }
                        }.frame(minHeight: 44).disabled(coordinator.busy)
                    } else {
                        Button("Keep credential and leave invitation") {
                            do { try coordinator.retainDeliveredInvitation() } catch { coordinator.report(error) }
                        }.frame(minHeight: 44).disabled(coordinator.busy)
                    }
                } else {
                    PlayConductPanel(coordinator: coordinator, accepted: $conduct)
                    PlaySettingsFields(settings: $settings)
                    if let profile = model.activeProfile, model.credentials?.serverURL == invite.serverURL {
                        Button("Ask to join as \(profile.name)") {
                            coordinator.run { try await coordinator.join(settings: settings, name: "", existing: true, acceptedConduct: conduct) }
                        }.buttonStyle(SottoPrimaryButtonStyle()).disabled(coordinator.busy || !settings.isValid || !conduct
                            || coordinator.policyServer != invite.serverURL)
                        Divider()
                    }
                    TextField("Your name", text: $name).textContentType(.name).textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("play.newName")
                        .disabled(!conduct || coordinator.policyServer != invite.serverURL)
                    Toggle("Create my learner profile on this server", isOn: $consent)
                    Text("The server owner must approve your new profile. Your host then lets you into the game. This device will use the approved profile; your current connection stays saved.")
                        .font(.callout).foregroundStyle(SottoTheme.muted)
                    Button("Ask to join as a new learner") {
                        coordinator.run { try await coordinator.join(settings: settings, name: name, existing: false, acceptedConduct: conduct) }
                    }.buttonStyle(SottoSecondaryButtonStyle())
                        .disabled(coordinator.busy || !conduct || coordinator.policyServer != invite.serverURL
                            || !consent || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !settings.isValid)
                    Button("Use another invitation") {
                        do { try coordinator.discardInvitation() } catch { coordinator.report(error) }
                    }.frame(minHeight: 44)
                }
            } else {
                TextField("Paste invitation link", text: $link).textInputAutocapitalization(.never)
                    .autocorrectionDisabled().textFieldStyle(.roundedBorder).accessibilityIdentifier("play.inviteLink")
                Button("Open invitation") { coordinator.receive(link) }.buttonStyle(SottoPrimaryButtonStyle())
                Button("Scan invitation QR") { scanner = true }.buttonStyle(SottoSecondaryButtonStyle())
                Divider()
                Text("Have a code?").font(.headline)
                TextField("https://your-sotto-server", text: $server).textInputAutocapitalization(.never)
                    .autocorrectionDisabled().keyboardType(.URL).textFieldStyle(.roundedBorder)
                TextField("XXXX-XXXX-XXXX", text: $code).textInputAutocapitalization(.characters)
                    .autocorrectionDisabled().textFieldStyle(.roundedBorder)
                Button("Use code") {
                    do {
                        guard let url = SottoAppModel.serverURL(fromTyped: server) else { throw SottoAPIError.message("Enter the host's server address.") }
                        let invite = try PlayInvitation(serverURL: url, code: code)
                        coordinator.receive(invite.appURL.absoluteString)
                    } catch { coordinator.report(error) }
                }.buttonStyle(SottoSecondaryButtonStyle())
            }
        }
        .onAppear { if server.isEmpty { server = model.credentials?.serverURL.absoluteString ?? "" } }
        .onChange(of: coordinator.policyServer) { _, _ in conduct = false }
        .sheet(isPresented: $scanner) {
            NavigationStack {
                QRScannerView { value in scanner = false; coordinator.receive(value) }
                    .navigationTitle("Scan game invitation")
                    .toolbar { Button("Close") { scanner = false } }
            }
        }
    }
    private var statusText: String {
        switch coordinator.joinStatus {
        case .waitingForOwner: "Waiting for the server owner to approve your profile."
        case .waitingForHost: "Waiting for your host to let you in."
        case .hostUnavailable: "Your host must return to the waiting room."
        case .accepted, .claimed: "Your game seat is ready."
        case .declined: "This request was declined."
        case .expired: "This invitation request expired."
        case .revoked: "This invitation was revoked."
        case nil: "Checking your saved request."
        }
    }
}
