import SwiftUI

/// How much room the current window gives us. `regular` is an iPad (and an
/// iPhone Max held sideways): side-by-side panels, wide margins, handwriting.
/// `compact` is an iPhone: one column, tighter margins, no Pencil canvas.
enum SottoLayoutMode {
    case compact
    case regular

    init(_ sizeClass: UserInterfaceSizeClass?) {
        self = sizeClass == .compact ? .compact : .regular
    }

    /// Handwriting wants a big canvas and a Pencil, so the workbook stays on
    /// iPad. Compact still reads and shares the rendered PDF.
    var supportsHandwriting: Bool { self == .regular }

    /// Column count for the action and summary grids.
    var gridColumns: Int { self == .compact ? 1 : 2 }

    /// Page margin around a scrolling detail pane.
    var pagePadding: CGFloat { self == .compact ? 18 : 36 }

    /// Point size for the course/class display title.
    var heroTitleSize: CGFloat { self == .compact ? 27 : 38 }

    /// Widest a reading column should get before it stops growing.
    var readableWidth: CGFloat { self == .compact ? .infinity : 980 }
}

private struct SottoLayoutModeKey: EnvironmentKey {
    static let defaultValue = SottoLayoutMode.regular
}

extension EnvironmentValues {
    var sottoLayout: SottoLayoutMode {
        get { self[SottoLayoutModeKey.self] }
        set { self[SottoLayoutModeKey.self] = newValue }
    }
}

/// A row on iPad that becomes a column on iPhone. Alignments are given per
/// axis because "top-aligned row" and "leading-aligned column" are the pair we
/// want almost everywhere.
struct SottoAdaptiveStack<Content: View>: View {
    @Environment(\.sottoLayout) private var layout

    var horizontalAlignment: HorizontalAlignment = .leading
    var verticalAlignment: VerticalAlignment = .top
    var spacing: CGFloat
    @ViewBuilder var content: () -> Content

    var body: some View {
        if layout == .compact {
            VStack(alignment: horizontalAlignment, spacing: spacing, content: content)
        } else {
            HStack(alignment: verticalAlignment, spacing: spacing, content: content)
        }
    }
}
