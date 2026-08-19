import SwiftUI

/// Everything the learner has met on a course, with its spaced-repetition
/// state. The web renders this as a force-directed graph; on a phone the edges
/// are unreadable, so this is a weak-first list — the same data, ordered by
/// what needs work, with a tap through to vocabulary practice.
struct MemoryGraphView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout

    let course: SottoCourse

    @State private var graph: SottoMemoryGraph?
    @State private var errorMessage: String?
    @State private var filter: Filter = .all

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All"
        case due = "Due"
        case vocab = "Words"
        case grammar = "Grammar"

        var id: String { rawValue }
    }

    private var nodes: [SottoMemoryNode] {
        let all = graph?.byStrength ?? []
        switch filter {
        case .all: return all
        case .due: return all.filter(\.due)
        case .vocab: return all.filter(\.isVocab)
        case .grammar: return all.filter { !$0.isVocab }
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let graph {
                        summary(graph)

                        Picker("Show", selection: $filter) {
                            ForEach(Filter.allCases) { option in
                                Text(option.rawValue).tag(option)
                            }
                        }
                        .pickerStyle(.segmented)

                        if nodes.isEmpty {
                            Text("Nothing here yet. Take a class and words start collecting.")
                                .font(.callout)
                                .foregroundStyle(SottoTheme.muted)
                        } else {
                            ForEach(nodes) { node in
                                MemoryNodeRow(node: node)
                            }
                        }
                    } else if let errorMessage {
                        ExamNoticeCard(
                            title: "Could not load your memory",
                            message: errorMessage,
                            systemImage: "exclamationmark.triangle"
                        )
                    } else {
                        ProgressView("Loading memory")
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }
                }
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        dismiss()
                        Task { await model.startPractice(courseId: course.id, kind: "VOCAB") }
                    } label: {
                        Label("Review", systemImage: "target")
                    }
                    .disabled((graph?.dueNodes.isEmpty ?? true))
                }
            }
            .task { await load() }
        }
    }

    private func summary(_ graph: SottoMemoryGraph) -> some View {
        let due = graph.dueNodes.count
        return VStack(alignment: .leading, spacing: 6) {
            Text("\(graph.nodes.count) items")
                .font(.system(size: layout.heroTitleSize, weight: .semibold, design: .serif))
                .foregroundStyle(SottoTheme.ink)
            Text(due == 0 ? "Nothing due right now." : "\(due) due for review.")
                .font(.callout)
                .foregroundStyle(due == 0 ? SottoTheme.muted : SottoTheme.primary)
        }
    }

    private func load() async {
        do {
            graph = try await model.fetchMemoryGraph(courseId: course.id)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct MemoryNodeRow: View {
    let node: SottoMemoryNode

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(node.label)
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                    if node.due {
                        Text("DUE")
                            .font(.caption2.bold())
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(SottoTheme.primary.opacity(0.12))
                            .foregroundStyle(SottoTheme.primary)
                            .clipShape(Capsule())
                    }
                }

                if let translation = node.translation, !translation.isEmpty {
                    Text(translation)
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 8) {
                    if let level = node.cefrLevel {
                        Text(level)
                    }
                    if let pos = node.partOfSpeech, !pos.isEmpty {
                        Text(pos)
                    }
                    if node.lapseCount > 0 {
                        Text("\(node.lapseCount) lapses")
                    }
                }
                .font(.caption)
                .foregroundStyle(SottoTheme.muted)
            }

            Spacer(minLength: 8)

            MasteryBar(strength: node.strength)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

private struct MasteryBar: View {
    let strength: Double

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text("\(Int((max(0, min(1, strength)) * 100).rounded()))%")
                .font(.caption.monospacedDigit())
                .foregroundStyle(SottoTheme.muted)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(SottoTheme.line)
                Capsule()
                    .fill(SottoTheme.primary)
                    .frame(width: 56 * max(0.02, min(1, strength)))
            }
            .frame(width: 56, height: 5)
        }
    }
}
