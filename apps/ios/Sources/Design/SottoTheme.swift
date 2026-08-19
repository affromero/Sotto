import SwiftUI

enum SottoTheme {
    static let paper = Color(red: 0.961, green: 0.957, blue: 0.941)
    static let surface = Color.white
    static let ink = Color(red: 0.118, green: 0.129, blue: 0.157)
    static let muted = Color(red: 0.337, green: 0.357, blue: 0.408)
    static let primary = Color(red: 0.247, green: 0.310, blue: 0.690)
    static let success = Color(red: 0.071, green: 0.478, blue: 0.231)
    static let line = Color.black.opacity(0.12)
}

struct SottoPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(minHeight: 48)
            .background(SottoTheme.primary.opacity(configuration.isPressed ? 0.82 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct SottoSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(SottoTheme.primary)
            .padding(.horizontal, 18)
            .frame(minHeight: 48)
            .background(SottoTheme.surface.opacity(configuration.isPressed ? 0.72 : 1))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(SottoTheme.line)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
