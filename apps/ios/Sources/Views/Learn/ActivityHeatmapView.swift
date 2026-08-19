import SwiftUI

/// A year of study days, coloured by what the learner did, plus streaks.
/// Mirrors the learn hub's heatmap: week columns, oldest on the left, today in
/// the last column.
struct ActivityHeatmapView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.sottoLayout) private var layout

    @State private var activity: SottoActivity?

    /// A phone cannot show 53 weeks at a legible cell size, so it shows a
    /// quarter. The scroller starts at today either way.
    private var weekCount: Int { layout == .compact ? 13 : 53 }

    private var cell: CGFloat { layout == .compact ? 11 : 13 }

    var body: some View {
        if let activity, !activity.days.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                header(activity)
                grid(activity)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SottoTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(SottoTheme.line)
            )
        } else {
            Color.clear
                .frame(height: 0)
                .task { await load() }
        }
    }

    private func header(_ activity: SottoActivity) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Label("Activity", systemImage: "square.grid.3x3.fill")
                .font(.caption.bold())
                .foregroundStyle(SottoTheme.ink)

            Spacer()

            Text(streakLabel(activity))
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)
        }
    }

    private func streakLabel(_ activity: SottoActivity) -> String {
        if activity.currentStreak > 0 {
            return "\(activity.currentStreak) day streak · best \(activity.longestStreak)"
        }
        return activity.longestStreak > 0 ? "Best streak \(activity.longestStreak) days" : ""
    }

    private func grid(_ activity: SottoActivity) -> some View {
        let days = calendarDays(endingOn: activity.todayIso, weeks: weekCount)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 3) {
                ForEach(Array(days.enumerated()), id: \.offset) { _, week in
                    VStack(spacing: 3) {
                        ForEach(week, id: \.self) { day in
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .fill(color(for: day, in: activity))
                                .frame(width: cell, height: cell)
                                .accessibilityLabel(accessibilityLabel(for: day, in: activity))
                        }
                    }
                }
            }
            .padding(.vertical, 2)
            .flipsForRightToLeftLayoutDirection(false)
        }
        .defaultScrollAnchor(.trailing)
    }

    private func color(for day: String, in activity: SottoActivity) -> Color {
        guard let category = activity.dominantCategory(on: day) else {
            return SottoTheme.line.opacity(0.5)
        }
        let count = activity.total(on: day)
        // Three tiers is as much as a cell this size can carry.
        let intensity = count >= 4 ? 1.0 : (count >= 2 ? 0.7 : 0.42)
        return categoryColor(category).opacity(intensity)
    }

    private func categoryColor(_ category: String) -> Color {
        switch category {
        case "class": return SottoTheme.primary
        case "exam": return Color(red: 0.72, green: 0.39, blue: 0.18)
        case "speaking": return Color(red: 0.24, green: 0.55, blue: 0.42)
        case "writing": return Color(red: 0.45, green: 0.35, blue: 0.66)
        case "listening": return Color(red: 0.20, green: 0.48, blue: 0.62)
        case "reading": return Color(red: 0.55, green: 0.44, blue: 0.20)
        case "vocab": return Color(red: 0.62, green: 0.28, blue: 0.44)
        default: return SottoTheme.primary
        }
    }

    private func accessibilityLabel(for day: String, in activity: SottoActivity) -> String {
        let count = activity.total(on: day)
        if count == 0 { return "\(day): nothing" }
        let category = activity.dominantCategory(on: day) ?? "study"
        return "\(day): \(count) \(category)"
    }

    /// Week columns ending on today, each running Sunday to Saturday, matching
    /// the web grid. Days are plain ISO strings because the server already
    /// bucketed them in the learner's timezone; re-deriving dates on the device
    /// would risk disagreeing with it.
    private func calendarDays(endingOn todayIso: String, weeks: Int) -> [[String]] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt

        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        guard let today = formatter.date(from: todayIso) else { return [] }

        let weekday = calendar.component(.weekday, from: today) - 1
        guard
            let lastColumnStart = calendar.date(byAdding: .day, value: -weekday, to: today),
            let firstDay = calendar.date(byAdding: .day, value: -7 * (weeks - 1), to: lastColumnStart)
        else { return [] }

        return (0..<weeks).map { week in
            (0..<7).compactMap { offset in
                calendar.date(byAdding: .day, value: week * 7 + offset, to: firstDay)
                    .map(formatter.string(from:))
            }
        }
    }

    private func load() async {
        activity = try? await model.fetchActivity()
    }
}
