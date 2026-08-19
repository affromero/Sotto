import PhotosUI
import SwiftUI

/// Learner settings: who you are, what language you read the app in, and which
/// model writes your classes.
///
/// Provider keys, voices, and anything that configures the server itself stay
/// on the web. This device pairs with a server; it does not set one up. Where
/// a preference depends on that configuration (the TTS and STT models, which
/// only exist once a provider is set up) the current value is shown read-only.
struct SettingsView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout

    @State private var account: SottoAccount?
    @State private var aiModels: [SottoAiModel] = []
    @State private var name = ""
    @State private var preferredAiModel = ""
    @State private var showAgentUsageStatus = true
    @State private var photoItem: PhotosPickerItem?
    @State private var status: String?
    @State private var errorMessage: String?
    @State private var isSaving = false

    private static let presetAvatars = [
        "bear", "cat", "deer", "fox", "hedgehog", "otter", "owl", "rabbit",
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let account {
                        profileCard(account)
                        modelCard(account)
                        readOnlyCard(account)

                        if account.isAdmin {
                            NavigationLink {
                                AdminOverviewView()
                                    .environmentObject(model)
                            } label: {
                                Label("Server admin", systemImage: "server.rack")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(SottoSecondaryButtonStyle())
                        }
                    } else if let errorMessage {
                        ExamNoticeCard(
                            title: "Could not load settings",
                            message: errorMessage,
                            systemImage: "exclamationmark.triangle"
                        )
                    } else {
                        ProgressView("Loading settings")
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }

                    if let status {
                        Text(status)
                            .font(.caption)
                            .foregroundStyle(SottoTheme.muted)
                    }
                }
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(isSaving || account == nil)
                }
            }
            .task { await load() }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task { await upload(item) }
            }
        }
    }

    private func profileCard(_ account: SottoAccount) -> some View {
        SettingsCard(title: "Profile") {
            TextField("Name", text: $name)
                .textFieldStyle(.roundedBorder)

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Upload a photo", systemImage: "photo")
            }
            .buttonStyle(SottoSecondaryButtonStyle())

            Text("Or pick an avatar")
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)

            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible()), count: layout == .compact ? 4 : 8),
                spacing: 8
            ) {
                ForEach(Self.presetAvatars, id: \.self) { slug in
                    Button {
                        Task { await setPresetAvatar(slug) }
                    } label: {
                        Text(slug.prefix(2).uppercased())
                            .font(.caption.bold())
                            .frame(width: 42, height: 42)
                            .background(
                                account.image == "/avatars/\(slug).png"
                                    ? SottoTheme.primary.opacity(0.16)
                                    : SottoTheme.paper
                            )
                            .clipShape(Circle())
                            .overlay(Circle().stroke(SottoTheme.line))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(slug)
                }
            }
        }
    }

    private func modelCard(_ account: SottoAccount) -> some View {
        SettingsCard(title: "Class model") {
            if aiModels.isEmpty {
                Text("Your server has no language model configured yet. Set one up on the web app.")
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Picker("Model", selection: $preferredAiModel) {
                    Text("Server default").tag("")
                    ForEach(aiModels) { aiModel in
                        Text(aiModel.displayName).tag(aiModel.id)
                    }
                }
                .pickerStyle(.menu)
            }

            Toggle("Show provider usage on the course list", isOn: $showAgentUsageStatus)
        }
    }

    private func readOnlyCard(_ account: SottoAccount) -> some View {
        SettingsCard(title: "Set up on the web") {
            settingRow("Voice model", account.preferredTtsModel)
            settingRow("Speech recognition", account.preferredSttModel)
            settingRow("Interface language", account.preferredLanguage)
            Text("Provider keys and voices are part of your server's setup, so they are changed there rather than on this device.")
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func settingRow(_ label: String, _ value: String?) -> some View {
        HStack {
            Text(label)
                .font(.callout)
                .foregroundStyle(SottoTheme.ink)
            Spacer()
            Text(value?.isEmpty == false ? value! : "Server default")
                .font(.callout)
                .foregroundStyle(SottoTheme.muted)
                .lineLimit(1)
        }
    }

    private func load() async {
        do {
            let loaded = try await model.fetchAccount()
            account = loaded
            name = loaded.name ?? ""
            preferredAiModel = loaded.preferredAiModel ?? ""
            showAgentUsageStatus = loaded.showAgentUsageStatus ?? true
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            return
        }

        // A server with no model configured answers this with an empty list
        // rather than an error, so a failure here is not worth surfacing.
        aiModels = (try? await model.fetchAiModels())?.models ?? []
    }

    private func save() async {
        guard let current = account else { return }
        isSaving = true
        status = nil
        defer { isSaving = false }

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        var update = SottoAccountUpdate()
        if !trimmedName.isEmpty, trimmedName != current.name {
            update.name = trimmedName
        }
        if preferredAiModel != (current.preferredAiModel ?? "") {
            update.preferredAiModel = preferredAiModel.isEmpty ? nil : preferredAiModel
        }
        if showAgentUsageStatus != (current.showAgentUsageStatus ?? true) {
            update.showAgentUsageStatus = showAgentUsageStatus
        }

        guard update != SottoAccountUpdate() else {
            status = "Nothing to save."
            return
        }

        do {
            account = try await model.updateAccount(update)
            status = "Saved."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func setPresetAvatar(_ slug: String) async {
        do {
            account = try await model.updateAccount(
                SottoAccountUpdate(image: "/avatars/\(slug).png")
            )
            status = "Avatar updated."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            // The route accepts jpeg/png/webp/gif up to 2MB.
            guard data.count <= 2 * 1024 * 1024 else {
                errorMessage = "That image is over the 2MB limit."
                return
            }
            _ = try await model.uploadAvatar(
                imageData: data,
                fileName: "avatar.jpg",
                contentType: "image/jpeg"
            )
            await load()
            status = "Avatar updated."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct SettingsCard<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.bold())
                .textCase(.uppercase)
                .foregroundStyle(SottoTheme.muted)
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}
