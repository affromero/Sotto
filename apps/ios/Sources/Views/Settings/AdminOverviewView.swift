import SwiftUI

/// Server status for the owner, read-only.
///
/// Every mutating admin operation the web has — retrying queues, editing
/// pricing, site config, roles, storage migration, factory reset — is
/// deliberately absent. Those are how a server is run, and this device is a
/// client of one; a mis-tap on a phone should not be able to reset an install.
/// The one exception is revoking an API key, because cutting off a lost device
/// is exactly the thing you need to do from the device you still have.
struct AdminOverviewView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.sottoLayout) private var layout

    @State private var health: SottoHealth?
    @State private var queues: SottoQueueSnapshot?
    @State private var pricing: [SottoModelPrice] = []
    @State private var keys: [SottoApiKeySummary] = []
    @State private var errorMessage: String?
    @State private var revoking: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let errorMessage {
                    ExamNoticeCard(
                        title: "Could not read server status",
                        message: errorMessage,
                        systemImage: "exclamationmark.triangle"
                    )
                }

                healthCard
                queueCard
                keysCard
                pricingCard

                Text("Changing any of this happens on the web app. This screen reads server state so you can see it from here.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(layout.pagePadding)
            .frame(maxWidth: layout.readableWidth, alignment: .leading)
        }
        .background(SottoTheme.paper)
        .navigationTitle("Server admin")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder
    private var healthCard: some View {
        SettingsCard(title: "Health") {
            if let health {
                HStack {
                    Image(systemName: health.isHealthy ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(health.isHealthy ? Color.green : Color.orange)
                    Text(health.status.capitalized)
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                }

                ForEach(health.checks?.keys.sorted() ?? [], id: \.self) { key in
                    if let check = health.checks?[key] {
                        HStack {
                            Text(key.capitalized)
                                .font(.callout)
                                .foregroundStyle(SottoTheme.ink)
                            Spacer()
                            Text(check.status)
                                .font(.callout.monospaced())
                                .foregroundStyle(check.isOk ? SottoTheme.muted : Color.orange)
                            if let latency = check.latencyMs {
                                Text("\(latency)ms")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(SottoTheme.muted)
                            }
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
    }

    @ViewBuilder
    private var queueCard: some View {
        if let queues, !queues.queues.isEmpty {
            SettingsCard(title: "Queues") {
                HStack {
                    Text("In flight")
                        .font(.callout)
                        .foregroundStyle(SottoTheme.ink)
                    Spacer()
                    Text("\(queues.backlog)")
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(SottoTheme.ink)
                }
                HStack {
                    Text("Failed")
                        .font(.callout)
                        .foregroundStyle(SottoTheme.ink)
                    Spacer()
                    Text("\(queues.failed)")
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(queues.failed > 0 ? Color.orange : SottoTheme.muted)
                }

                ForEach(queues.queues.keys.sorted(), id: \.self) { name in
                    if let depth = queues.queues[name] {
                        HStack {
                            Text(name)
                                .font(.caption.monospaced())
                                .foregroundStyle(SottoTheme.muted)
                            Spacer()
                            Text("\(depth.waiting) waiting · \(depth.active) active · \(depth.failed) failed")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(SottoTheme.muted)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var keysCard: some View {
        if !keys.isEmpty {
            SettingsCard(title: "Paired devices and keys") {
                ForEach(keys) { key in
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(key.name ?? key.keyPrefix)
                                .font(.callout)
                                .foregroundStyle(key.isRevoked ? SottoTheme.muted : SottoTheme.ink)
                                .strikethrough(key.isRevoked)
                            Text(key.keyPrefix)
                                .font(.caption.monospaced())
                                .foregroundStyle(SottoTheme.muted)
                        }

                        Spacer()

                        if key.isRevoked {
                            Text("Revoked")
                                .font(.caption)
                                .foregroundStyle(SottoTheme.muted)
                        } else {
                            Button(role: .destructive) {
                                Task { await revoke(key) }
                            } label: {
                                Text(revoking == key.id ? "Revoking" : "Revoke")
                                    .font(.caption.bold())
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.red)
                            .disabled(revoking != nil)
                        }
                    }
                }

                Text("New devices are added by pairing, not from here.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
    }

    @ViewBuilder
    private var pricingCard: some View {
        if !pricing.isEmpty {
            SettingsCard(title: "Model pricing") {
                ForEach(pricing.prefix(8)) { row in
                    HStack {
                        Text(row.modelId)
                            .font(.caption.monospaced())
                            .foregroundStyle(SottoTheme.ink)
                            .lineLimit(1)
                        Spacer()
                        Text(priceLabel(row))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(SottoTheme.muted)
                    }
                }
                if pricing.count > 8 {
                    Text("+\(pricing.count - 8) more on the web")
                        .font(.caption)
                        .foregroundStyle(SottoTheme.muted)
                }
            }
        }
    }

    private func priceLabel(_ row: SottoModelPrice) -> String {
        guard let input = row.inputPerMTok, let output = row.outputPerMTok else {
            return "unpriced"
        }
        return String(format: "$%.2f / $%.2f per Mtok", input, output)
    }

    private func load() async {
        // Each card stands alone: a server with no Redis should still show its
        // health, so one failure must not blank the screen.
        health = try? await model.fetchHealth()
        queues = try? await model.fetchQueues()
        pricing = (try? await model.fetchModelPricing()) ?? []
        do {
            keys = try await model.fetchApiKeys()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func revoke(_ key: SottoApiKeySummary) async {
        revoking = key.id
        defer { revoking = nil }
        do {
            try await model.revokeApiKey(id: key.id)
            keys = (try? await model.fetchApiKeys()) ?? keys
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
