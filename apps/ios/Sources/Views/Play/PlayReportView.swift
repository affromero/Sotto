import SwiftUI

struct PlayReportView: View {
    @ObservedObject var coordinator: PlayCoordinator
    @State private var optionID = "name"
    @State private var category: PlayReportCategory = .harassment
    @State private var detail = ""
    @State private var confirmingBlock = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Report or block").font(.system(.largeTitle, design: .serif))
            if let room = coordinator.reportRoom {
                Text("Reports go to this server's owner. Select only content you can see. Blocking ends your games together and prevents new games between these profiles.")
                    .font(.callout).foregroundStyle(SottoTheme.muted)
                Picker("Content to report", selection: $optionID) {
                    ForEach(room.reportOptions) { Text($0.label).tag($0.id) }
                }.frame(minHeight: 44)
                if let option = room.reportOptions.first(where: { $0.id == optionID }) {
                    Text(option.text).textSelection(.enabled)
                    Picker("Reason", selection: $category) {
                        ForEach(PlayReportCategory.allCases, id: \.self) { Text($0.title).tag($0) }
                    }.frame(minHeight: 44)
                    TextField("Explanation (optional)", text: $detail, axis: .vertical)
                        .lineLimit(3...8).textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("play.reportExplanation")
                        .onChange(of: detail) { _, value in if value.count > 1000 { detail = String(value.prefix(1000)) } }
                    Text("\(detail.count)/1,000").font(.caption.monospaced()).foregroundStyle(SottoTheme.muted)
                    Button("Send report to server owner") {
                        coordinator.runSafety { try await coordinator.sendReport(option: option, category: category, detail: detail) }
                    }.buttonStyle(SottoPrimaryButtonStyle()).disabled(controlsDisabled)
                }
                if let partner = room.ownSeat == .host ? room.guest : room.host {
                    if coordinator.blocks.contains(where: { $0.id == partner.id }) {
                        Label("Partner blocked", systemImage: "hand.raised")
                    } else {
                        Button("Block \(partner.name)", role: .destructive) { confirmingBlock = true }
                            .frame(minHeight: 44).disabled(controlsDisabled)
                    }
                }
            } else { Text("Open a game to select its visible content.") }
            Button("Blocks and report responses") { coordinator.navigate(.safety) }
                .buttonStyle(SottoSecondaryButtonStyle())
        }
        .pickerStyle(.menu)
        .confirmationDialog("Block this partner and end your games together?", isPresented: $confirmingBlock, titleVisibility: .visible) {
            if let room = coordinator.reportRoom {
                Button("Block partner", role: .destructive) { coordinator.runSafety { try await coordinator.blockPartner(in: room) } }
            }
            Button("Cancel", role: .cancel) { }
        }
    }
    private var controlsDisabled: Bool { coordinator.safetyBusy || coordinator.state?.pendingSafety != nil }
}
