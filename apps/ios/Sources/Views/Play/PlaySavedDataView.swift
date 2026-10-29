import SwiftUI

struct PlaySavedDataView: View {
    @EnvironmentObject private var model: SottoAppModel
    @ObservedObject var coordinator: PlayCoordinator
    @State private var removing: UUID?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let retained = coordinator.state?.retainedAdmissions, !retained.isEmpty {
                DisclosureGroup("Saved invitation recoveries") {
                    ForEach(retained, id: \.command.requestId) { pending in
                        VStack(alignment: .leading) {
                            Button("Resume \(pending.delivery?.profile.name ?? "profile") at \(pending.invitation.serverURL.host() ?? "server")") {
                                do { try coordinator.resumeAdmission(pending) } catch { coordinator.report(error) }
                            }.frame(minHeight: 44).disabled(coordinator.busy)
                            Button("Delete saved recovery", role: .destructive) { removing = pending.command.requestId }
                                .frame(minHeight: 44).disabled(coordinator.busy)
                        }
                    }
                }
            }
            if let connections = coordinator.state?.archivedConnections, !connections.isEmpty {
                DisclosureGroup("Saved connections") {
                    ForEach(Array(connections.enumerated()), id: \.offset) { _, connection in
                        VStack(alignment: .leading) {
                            Button("Use \(connection.selectedProfile?.name ?? "Unselected profile") at \(connection.serverURL.host() ?? "server")") {
                                coordinator.run { try await coordinator.switchConnection(connection) }
                            }.frame(minHeight: 44).disabled(!coordinator.active || coordinator.busy)
                            Button("Remove saved copy", role: .destructive) {
                                do { try coordinator.save { $0.archivedConnections.removeAll { $0 == connection } } }
                                catch { coordinator.report(error) }
                            }.frame(minHeight: 44).disabled(coordinator.busy)
                        }
                    }
                }
            }
            if !drafts.isEmpty {
                DisclosureGroup("Saved drafts") {
                    ForEach(drafts, id: \.key) { draft in
                        VStack(alignment: .leading) {
                            Text(draft.value).textSelection(.enabled)
                            Button("Discard saved draft", role: .destructive) {
                                coordinator.saveDraft("", key: draft.key)
                            }.frame(minHeight: 44).disabled(coordinator.busy || coordinator.state?.pending != nil)
                        }
                    }
                }
            }
        }
        .confirmationDialog("Delete this recovery and its issued credential from this device?", isPresented: removalBinding, titleVisibility: .visible, presenting: removing) { id in
            Button("Delete saved recovery", role: .destructive) {
                do { try coordinator.save { $0.retainedAdmissions.removeAll { $0.command.requestId == id } } }
                catch { coordinator.report(error) }
                removing = nil
            }
            Button("Cancel", role: .cancel) { removing = nil }
        }
    }
    private var drafts: [(key: String, value: String)] {
        guard let credentials = model.credentials, let id = credentials.selectedProfile?.id else { return [] }
        let prefix = "\(credentials.serverURL.absoluteString)/\(id)/"
        return (coordinator.state?.drafts ?? [:]).filter { $0.key.hasPrefix(prefix) }.sorted { $0.key < $1.key }
    }
    private var removalBinding: Binding<Bool> {
        Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
    }
}
