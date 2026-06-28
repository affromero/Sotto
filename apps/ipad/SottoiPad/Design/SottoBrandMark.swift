import SwiftUI

struct SottoBrandMark: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isAnimating = false

    let progress: Double?
    var showsProgressRing = true

    private static let logoGradient = LinearGradient(
        colors: [
            Color(red: 0.416, green: 0.627, blue: 1.0),
            Color(red: 0.545, green: 0.482, blue: 1.0),
            Color(red: 1.0, green: 0.561, blue: 0.694),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    private var clampedProgress: Double? {
        guard let progress else { return nil }
        return max(0, min(1, progress))
    }

    var body: some View {
        GeometryReader { proxy in
            let size = min(proxy.size.width, proxy.size.height)
            let ringWidth = max(2, size * 0.069)
            let logoSize = showsProgressRing ? size * 0.655 : size
            let progressEnd = clampedProgress.map { max(0.08, $0) } ?? 0.34
            let shouldPulse = !reduceMotion && size >= 40

            ZStack {
                if showsProgressRing {
                    Circle()
                        .stroke(SottoTheme.primary.opacity(0.16), lineWidth: ringWidth)

                    Circle()
                        .trim(from: 0, to: progressEnd)
                        .stroke(
                            SottoTheme.primary,
                            style: StrokeStyle(lineWidth: ringWidth, lineCap: .round)
                        )
                        .rotationEffect(.degrees(clampedProgress == nil && isAnimating && !reduceMotion ? 270 : -90))
                        .animation(
                            clampedProgress == nil && !reduceMotion
                                ? .linear(duration: 1.2).repeatForever(autoreverses: false)
                                : (reduceMotion ? nil : .easeOut(duration: 0.3)),
                            value: isAnimating
                        )
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.35), value: clampedProgress)
                }

                ZStack {
                    Circle()
                        .fill(Self.logoGradient)

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.357, green: 0.553, blue: 0.937).opacity(0.95),
                                    Color(red: 0.357, green: 0.553, blue: 0.937).opacity(0.0),
                                ],
                                center: UnitPoint(x: 0.28, y: 0.72),
                                startRadius: 0,
                                endRadius: max(12, logoSize * 0.6)
                            )
                        )

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 1.0, green: 0.561, blue: 0.694).opacity(0.95),
                                    Color(red: 1.0, green: 0.561, blue: 0.694).opacity(0.0),
                                ],
                                center: UnitPoint(x: 0.72, y: 0.76),
                                startRadius: 0,
                                endRadius: max(12, logoSize * 0.55)
                            )
                        )

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.137, green: 0.141, blue: 0.306).opacity(0.48),
                                    Color(red: 0.137, green: 0.141, blue: 0.306).opacity(0.0),
                                ],
                                center: .bottom,
                                startRadius: 0,
                                endRadius: max(12, logoSize * 0.65)
                            )
                        )

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    .white.opacity(0.95),
                                    .white.opacity(0.22),
                                    .clear,
                                ],
                                center: UnitPoint(x: 0.34, y: 0.26),
                                startRadius: 0,
                                endRadius: max(12, logoSize * 0.42)
                            )
                        )

                    Ellipse()
                        .fill(
                            RadialGradient(
                                colors: [
                                    .white.opacity(0.95),
                                    .white.opacity(0.0),
                                ],
                                center: .center,
                                startRadius: 0,
                                endRadius: max(3, logoSize * 0.18)
                            )
                        )
                        .frame(width: logoSize * 0.27, height: logoSize * 0.17)
                        .offset(x: -logoSize * 0.16, y: -logoSize * 0.26)

                    Circle()
                        .stroke(.white.opacity(0.28), lineWidth: max(0.5, logoSize * 0.013))
                }
                .frame(width: logoSize, height: logoSize)
                .shadow(color: SottoTheme.primary.opacity(0.24), radius: max(2, logoSize * 0.21), y: max(1, logoSize * 0.105))
                .scaleEffect(shouldPulse ? (isAnimating ? 1.04 : 0.96) : 1)
                .opacity(shouldPulse ? (isAnimating ? 1 : 0.82) : 1)
                .animation(
                    shouldPulse ? .easeInOut(duration: 1.8).repeatForever(autoreverses: true) : nil,
                    value: isAnimating
                )
            }
            .frame(width: size, height: size)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
        .onAppear {
            isAnimating = true
        }
    }
}
