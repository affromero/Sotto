import SwiftUI
import UIKit

enum SottoTheme {
    static let paper = adaptive(light: 0xF5F4F0, dark: 0x121310)
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x1B1D17)
    static let ink = adaptive(light: 0x1E2128, dark: 0xE9E3D3)
    static let muted = adaptive(light: 0x565B68, dark: 0x9D9684)
    static let primary = adaptive(light: 0x3F4FB0, dark: 0x6A9BFF)
    static let onPrimary = adaptive(light: 0xFFFFFF, dark: 0x121310)
    static let success = adaptive(light: 0x127A3B, dark: 0x34D399)
    static let teal = adaptive(light: 0x217A69, dark: 0x5EEAD4)
    static let rose = adaptive(light: 0xAD3E64, dark: 0xFDA4AF)
    static let amber = adaptive(light: 0x9C4F1E, dark: 0xFBBF24)
    static let introductionTint = adaptive(light: 0xF5FAF2, dark: 0x1A2E25)
    static let readingTint = adaptive(light: 0xFAF2E0, dark: 0x2B2417)
    static let cameraOverlay = Color.black.opacity(0.70)
    static let onCameraOverlay = Color.white
    static let cameraCaption = Color.white.opacity(0.82)
    static let line = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 1, alpha: 0.18)
            : UIColor(white: 0, alpha: 0.12)
    })

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

struct SottoPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(SottoTheme.onPrimary)
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
