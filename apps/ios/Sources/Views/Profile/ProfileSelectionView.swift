import SwiftUI

struct ProfileSelectionView: View {
    @EnvironmentObject private var model: SottoAppModel
    @State private var showingCreateProfile = false

    private var serverHost: String {
        model.credentials?.serverURL.host() ?? "Sotto server"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 220), spacing: 16)],
                    alignment: .leading,
                    spacing: 16
                ) {
                    ForEach(model.profiles) { profile in
                        Button {
                            Task {
                                await model.selectProfile(profile)
                            }
                        } label: {
                            ProfileCard(profile: profile, serverURL: model.credentials?.serverURL)
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        showingCreateProfile = true
                    } label: {
                        AddProfileCard()
                    }
                    .buttonStyle(.plain)
                }

                Button(role: .destructive) {
                    model.signOut()
                } label: {
                    Label("Unpair device", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .buttonStyle(SottoSecondaryButtonStyle())
            }
            .padding(48)
            .frame(maxWidth: 980, alignment: .leading)
        }
        .background(SottoTheme.paper)
        .task {
            if model.profiles.isEmpty {
                await model.loadProfiles()
            }
        }
        .sheet(isPresented: $showingCreateProfile) {
            CreateProfileView()
                .environmentObject(model)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who's learning?")
                .font(.system(size: 54, weight: .bold, design: .serif))
                .foregroundStyle(SottoTheme.ink)

            Text("Choose a profile for this device or create a new learner on \(serverHost).")
                .font(.title3)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ProfileCard: View {
    let profile: SottoProfile
    let serverURL: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ProfileAvatar(profile: profile, serverURL: serverURL, size: 76)

            VStack(alignment: .leading, spacing: 4) {
                Text(profile.name)
                    .font(.title3.bold())
                    .foregroundStyle(SottoTheme.ink)
                    .lineLimit(1)

                Text(profileSummary(profile))
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .lineLimit(2)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 178, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
        .accessibilityElement(children: .combine)
    }

    private func profileSummary(_ profile: SottoProfile) -> String {
        if let primaryCourse = profile.primaryCourse {
            return "\(primaryCourse.targetLang.uppercased()) / \(primaryCourse.level)"
        }

        if profile.isOwner {
            return "Owner profile"
        }

        return "New learner"
    }
}

private struct AddProfileCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ZStack {
                Circle()
                    .fill(SottoTheme.primary.opacity(0.1))
                Image(systemName: "plus")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(SottoTheme.primary)
            }
            .frame(width: 76, height: 76)

            VStack(alignment: .leading, spacing: 4) {
                Text("Add learner")
                    .font(.title3.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text("Create a separate profile")
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 178, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
        .accessibilityElement(children: .combine)
    }
}

private struct CreateProfileView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var avatarSlug = avatarOptions[0].slug

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Add a learner")
                            .font(.largeTitle.bold())
                            .foregroundStyle(SottoTheme.ink)
                        Text("This creates a separate course list, progress, and practice history.")
                            .font(.body)
                            .foregroundStyle(SottoTheme.muted)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Name")
                            .font(.headline)
                            .foregroundStyle(SottoTheme.ink)
                        TextField("Learner name", text: $name)
                            .textInputAutocapitalization(.words)
                            .font(.title3)
                            .padding(14)
                            .background(SottoTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(SottoTheme.line)
                            )
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Avatar")
                            .font(.headline)
                            .foregroundStyle(SottoTheme.ink)

                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 112), spacing: 12)],
                            alignment: .leading,
                            spacing: 12
                        ) {
                            ForEach(avatarOptions) { option in
                                AvatarChoice(
                                    option: option,
                                    serverURL: model.credentials?.serverURL,
                                    selected: avatarSlug == option.slug
                                ) {
                                    avatarSlug = option.slug
                                }
                            }
                        }
                    }
                }
                .padding(28)
            }
            .background(SottoTheme.paper)
            .navigationTitle("New profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        model.run {
                            await model.createProfile(name: name, avatarSlug: avatarSlug)
                            if model.errorMessage == nil {
                                dismiss()
                            }
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.large])
    }
}

private struct AvatarChoice: View {
    let option: AvatarOption
    let serverURL: URL?
    let selected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 8) {
                RemoteAvatar(
                    url: avatarURL(path: "/avatars/\(option.slug).png", serverURL: serverURL),
                    fallback: String(option.name.prefix(1)),
                    size: 58
                )

                Text(option.name)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.ink)
                    .lineLimit(1)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 106)
            .background(selected ? SottoTheme.primary.opacity(0.08) : SottoTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(selected ? SottoTheme.primary : SottoTheme.line, lineWidth: selected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct ProfileAvatar: View {
    let profile: SottoProfile
    let serverURL: URL?
    let size: CGFloat

    var body: some View {
        SottoAvatar(
            name: profile.name,
            avatarPath: profile.avatarUrl,
            serverURL: serverURL,
            size: size
        )
    }
}

private struct AvatarOption: Identifiable {
    let slug: String
    let name: String

    var id: String { slug }
}

private let avatarOptions: [AvatarOption] = [
    AvatarOption(slug: "capybara", name: "Capybara"),
    AvatarOption(slug: "iguana", name: "Iguana"),
    AvatarOption(slug: "sloth", name: "Sloth"),
    AvatarOption(slug: "toucan", name: "Toucan"),
    AvatarOption(slug: "macaw", name: "Macaw"),
    AvatarOption(slug: "frog", name: "Frog"),
    AvatarOption(slug: "hummingbird", name: "Hummingbird"),
    AvatarOption(slug: "jaguar", name: "Jaguar"),
]

struct ProfileToolbarMenu: View {
    @EnvironmentObject private var model: SottoAppModel
    var onExitProfile: (() -> Void)?

    private var profileName: String {
        model.activeProfile?.name ?? "Profile"
    }

    var body: some View {
        Menu {
            Button {
                onExitProfile?()
                model.clearSelectedProfile()
            } label: {
                Label("Switch learner", systemImage: "person.2")
            }

            Button(role: .destructive) {
                onExitProfile?()
                model.signOut()
            } label: {
                Label("Unpair device", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            SottoAvatar(
                name: profileName,
                avatarPath: model.activeProfile?.avatarUrl,
                serverURL: model.credentials?.serverURL,
                size: 42
            )
        }
        .accessibilityLabel("Profile menu for \(profileName)")
    }
}
