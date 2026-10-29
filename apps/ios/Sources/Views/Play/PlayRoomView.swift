import CoreImage.CIFilterBuiltins
import SwiftUI

struct PlayRoomView: View {
    @EnvironmentObject private var model: SottoAppModel
    @ObservedObject var coordinator: PlayCoordinator
    var body: some View {
        if let room = coordinator.room {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .firstTextBaseline) {
                    Text(room.kind.title).font(.system(.title, design: .serif))
                    Spacer()
                    Text("\(room.points) points").font(.caption.monospaced())
                }
                Text("\(room.host.name) & \(room.guest?.name ?? "your partner")")
                    .foregroundStyle(SottoTheme.muted)
                if !room.reportOptions.isEmpty {
                    Button("Report or block partner") { coordinator.showReport(for: room) }
                        .buttonStyle(SottoSecondaryButtonStyle()).accessibilityIdentifier("play.reportOrBlock")
                }
                if room.status == .waiting {
                    waiting(room)
                } else if room.status == .playing, let round = room.round {
                    PlayRoundView(coordinator: coordinator, room: room, round: round)
                } else if room.status == .completed {
                    Text("Good game.").font(.system(.largeTitle, design: .serif))
                    Text("\(room.completedRounds.count) rounds together. Keep any words you want to remember.")
                    ForEach(room.completedRounds) { round in
                        DisclosureGroup("Round \(round.order + 1) · \(round.result?.points ?? 0) points") {
                            PlayRoundRecap(round: round)
                            PlayPhraseCapture(coordinator: coordinator, round: round)
                        }
                    }
                    if let next = room.rematchRoomId {
                        Button("Open your rematch") { coordinator.navigate(.room(next)) }
                            .buttonStyle(SottoPrimaryButtonStyle())
                    }
                } else {
                    Text(room.status == .expired ? "This game expired." : "This game has ended.")
                }
                ForEach(room.allowedActions, id: \.self) { action in
                    Button(actionLabel(action)) { coordinator.run { try await coordinator.roomAction(action, in: room) } }
                        .buttonStyle(SottoSecondaryButtonStyle())
                        .disabled(coordinator.gameControlsDisabled)
                }
            }.accessibilityElement(children: .contain).accessibilityIdentifier("play.room.\(room.id)")
        } else {
            if coordinator.gameUnavailable {
                Text("This game is unavailable. Your saved profile and private learning are kept.")
                Button("Open game safety") { coordinator.navigate(.safety) }.buttonStyle(SottoPrimaryButtonStyle())
            } else { ProgressView("Opening your game") }
        }
    }

    @ViewBuilder private func waiting(_ room: PlayRoom) -> some View {
        Text(room.ownSeat == .host ? "Stay here to let your partner in." : "Your host will start when you are both ready.")
            .font(.title2)
        if room.ownSeat == .host {
            Label(coordinator.leaseReady ? "You are in the waiting room" : "Connecting to the waiting room",
                systemImage: coordinator.leaseReady ? "circle.fill" : "circle")
                .font(.caption).foregroundStyle(coordinator.leaseReady ? SottoTheme.success : SottoTheme.muted)
            if let invitation = coordinator.invitation, let server = model.credentials?.serverURL,
               let invite = try? PlayInvitation(serverURL: server, code: invitation.code) {
                Text(invite.formattedCode).font(.system(.largeTitle, design: .monospaced))
                    .textSelection(.enabled).accessibilityIdentifier("play.roomCode")
                if let image = qr(invite.webURL) {
                    Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                        .frame(maxWidth: 220, maxHeight: 220).padding(12).background(.white)
                        .accessibilityLabel("Invitation QR code")
                }
                ShareLink("Share game invitation", item: invite.webURL).buttonStyle(SottoPrimaryButtonStyle())
                Text(invite.webURL.absoluteString).font(.caption).textSelection(.enabled)
            }
            Button(coordinator.invitation == nil ? "Create invitation" : "Replace invitation code") {
                coordinator.run { try await coordinator.rotateInvitation() }
            }.buttonStyle(SottoSecondaryButtonStyle()).disabled(!coordinator.active || coordinator.busy || coordinator.state?.pending != nil)
            PlayAdmissionList(coordinator: coordinator)
        }
    }
    private func qr(_ url: URL) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(url.absoluteString.utf8)
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
    private func actionLabel(_ action: PlayRoomAction) -> String {
        switch action {
        case .start: "Start playing"
        case .nextRound: "Next round"
        case .rematch: "Play again"
        case .leave: "Leave game"
        case .cancel: "End game"
        }
    }
}

struct PlayRoundRecap: View {
    let round: PlayRound
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let result = round.result {
                Text(result.skipped ? "Skipped" : "\(result.points) points")
                    .font(.headline).foregroundStyle(SottoTheme.primary)
                if let matched = result.matched { Text(matched ? "You picked the same answer." : "Different picks. Something new to learn about each other.") }
                if let correction = result.correction { Text("Try: \(correction)") }
            }
            ForEach(round.visibleTexts, id: \.self) { Text($0).textSelection(.enabled) }
        }
    }
}
