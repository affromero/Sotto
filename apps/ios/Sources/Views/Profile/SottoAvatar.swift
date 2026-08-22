import SwiftUI

/// One avatar rendering for the whole app: the learner's uploaded photo or
/// preset avatar when the server has one, their initial when it does not.
/// Lives apart from the profile picker because the sidebar, the profile menu,
/// and settings all show the same face.
struct SottoAvatar: View {
    let name: String
    let avatarPath: String?
    let serverURL: URL?
    let size: CGFloat

    var body: some View {
        RemoteAvatar(
            url: avatarPath.flatMap { avatarURL(path: $0, serverURL: serverURL) },
            fallback: String(name.prefix(1)),
            size: size
        )
    }
}

struct RemoteAvatar: View {
    let url: URL?
    let fallback: String
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(SottoTheme.primary.opacity(0.1))

            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        fallbackView
                    }
                }
            } else {
                fallbackView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(SottoTheme.line))
    }

    private var fallbackView: some View {
        Text(fallback.uppercased())
            .font(.system(size: max(18, size * 0.34), weight: .bold, design: .serif))
            .foregroundStyle(SottoTheme.primary)
    }
}

func avatarURL(path: String, serverURL: URL?) -> URL? {
    guard let serverURL else { return nil }
    return URL(string: path, relativeTo: serverURL)?.absoluteURL
}
