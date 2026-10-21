import SwiftUI

struct PlaySafetyView: View {
    @ObservedObject var coordinator: PlayCoordinator
    @State private var accepted = false
    @State private var unblocking: PlayBlock?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Game safety").font(.system(.largeTitle, design: .serif))
            PlayConductPanel(coordinator: coordinator, accepted: $accepted)
            if coordinator.safetyStatus != nil {
                if coordinator.conductAccepted {
                    Label("Conduct accepted for this profile", systemImage: "checkmark.circle")
                } else {
                    Button("Accept game conduct") { coordinator.runSafety { try await coordinator.acceptConduct() } }
                        .buttonStyle(SottoPrimaryButtonStyle())
                        .disabled(!accepted || coordinator.safetyPolicy == nil || controlsDisabled)
                }
                if coordinator.safetyStatus?.sharingRestricted == true {
                    Text("The server owner has restricted this profile from partner games. You can still manage blocks and reports. Your private learning remains available.")
                }
                Button("Refresh safety settings") {
                    coordinator.runSafety {
                        guard let connection = coordinator.model?.credentials else { return }
                        coordinator.resetSafetyPages()
                        try await coordinator.loadSafetyStatus(generation: coordinator.epoch, connection: connection)
                        try await coordinator.refreshSafetyLists(generation: coordinator.epoch, connection: connection)
                    }
                }.buttonStyle(SottoSecondaryButtonStyle()).disabled(controlsDisabled)
                if let room = coordinator.reportRoom, !room.reportOptions.isEmpty {
                    Button("Report content from your last game") { coordinator.showReport(for: room) }
                        .buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.safetyBusy)
                }
                Text("Your blocked players").font(.title2)
                if coordinator.blocks.isEmpty { Text("You have no blocked players.").foregroundStyle(SottoTheme.muted) }
                ForEach(coordinator.blocks) { blocked in
                    HStack {
                        Text(blocked.name)
                        Spacer()
                        Button("Unblock") { unblocking = blocked }
                            .frame(minWidth: 44, minHeight: 44).disabled(controlsDisabled)
                            .accessibilityLabel("Unblock \(blocked.name)")
                    }
                }
                if coordinator.blocksCursor != nil {
                    Button("More blocked players") { coordinator.runSafety { try await coordinator.loadOlderSafety(blocked: true) } }
                        .frame(minHeight: 44).disabled(controlsDisabled)
                }
                Text("Your reports").font(.title2)
                Text("Only you and this server's owner can read your report and the owner's response.")
                    .font(.callout).foregroundStyle(SottoTheme.muted)
                ForEach(coordinator.safetyReports) { report in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(report.category.title) · \(report.status == .open ? "Open" : "Resolved")").font(.headline)
                        Text(report.evidence.text).textSelection(.enabled)
                        if !report.detail.isEmpty { Text(report.detail) }
                        if let response = report.response {
                            Text("Server owner's response").font(.caption.bold())
                            Text(response).textSelection(.enabled)
                        } else { Text("Awaiting the server owner's response.").font(.caption).foregroundStyle(SottoTheme.muted) }
                    }
                    Divider()
                }
                if coordinator.safetyReportsCursor != nil {
                    Button("More reports") { coordinator.runSafety { try await coordinator.loadOlderSafety(blocked: false) } }
                        .frame(minHeight: 44).disabled(controlsDisabled)
                }
                if coordinator.safetyStatus?.canReviewReports == true,
                   let server = coordinator.safetyServer, let policy = coordinator.safetyPolicy,
                   let url = URL(string: policy.reviewPath, relativeTo: server) {
                    Link("Review reports as server owner", destination: url).frame(minHeight: 44)
                    Text("Sign in to this server in your browser to review reports.").font(.caption)
                }
            } else {
                Text("Select a paired profile to manage its blocks and reports.").foregroundStyle(SottoTheme.muted)
            }
            Button("Return to games") { coordinator.navigate(.lobby) }.buttonStyle(SottoSecondaryButtonStyle())
        }
        .onChange(of: coordinator.policyServer) { _, _ in accepted = false }
        .confirmationDialog("Unblock this player? Old games stay closed.", isPresented: Binding(
            get: { unblocking != nil }, set: { if !$0 { unblocking = nil } }), titleVisibility: .visible) {
            if let value = unblocking {
                Button("Unblock \(value.name)") {
                    unblocking = nil
                    coordinator.runSafety { try await coordinator.unblock(value) }
                }
            }
            Button("Cancel", role: .cancel) { unblocking = nil }
        }
    }

    private var controlsDisabled: Bool { coordinator.safetyBusy || coordinator.state?.pendingSafety != nil }
}

struct PlayConductPanel: View {
    @ObservedObject var coordinator: PlayCoordinator
    @Binding var accepted: Bool

    var body: some View {
        if let policy = coordinator.safetyPolicy, coordinator.policyServer == coordinator.safetyServer {
            VStack(alignment: .leading, spacing: 12) {
                Text(policy.title).font(.title2)
                ForEach(policy.paragraphs, id: \.self) { Text($0).font(.callout) }
                if let server = coordinator.safetyServer {
                    HStack {
                        if let url = URL(string: policy.termsPath, relativeTo: server) {
                            Link("Server terms", destination: url).frame(minHeight: 44)
                        }
                        if let url = URL(string: policy.privacyPath, relativeTo: server) {
                            Link("Server privacy", destination: url).frame(minHeight: 44)
                        }
                    }
                }
                if let contact = policy.operatorContactUrl, let url = URL(string: contact) {
                    Link("Contact this server's operator", destination: url).frame(minHeight: 44)
                } else {
                    Text("This server has not published an operator contact. Reports go to its owner.")
                        .font(.caption).foregroundStyle(SottoTheme.muted)
                }
                Toggle("I accept this server's game conduct", isOn: $accepted)
                    .frame(minHeight: 44).accessibilityIdentifier("play.conductConsent")
            }
        } else { ProgressView("Loading this server's game conduct") }
    }
}
