import SwiftUI

struct LearningMapView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.sottoLayout) private var layout
    let courseId: String
    @State private var map: SottoLearningMap?
    @State private var viewed: SottoLearningLevel?
    @State private var selected = Set<String>()
    @State private var preview: SottoLearningSelectionPreview?
    @State private var kind = "FULL"
    @StateObject private var activity = NativeLearningMapActivity()
    @State private var error = ""
    @State private var query = ""

    private var busy: Bool { activity.busy }
    private var context: NativeLearningMapContext? {
        guard let client = model.makeClient(), model.courses.contains(where: { $0.id == courseId }) else { return nil }
        return NativeLearningMapContext(learner: SottoLearnerIdentity(client), courseId: courseId, viewedLevel: viewed)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Picker("Viewed level", selection: Binding(get: { viewed }, set: {
                        activity.invalidate(); preview = nil; selected = []; viewed = $0
                    })) {
                        Text("Current level").tag(SottoLearningLevel?.none)
                        ForEach(SottoLearningLevel.allCases) { level in
                            Text(level.rawValue).tag(Optional(level))
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(minHeight: 44)
                    if busy { ProgressView("Checking the learning map") }
                    if !error.isEmpty {
                        Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                        Button("Retry saved action") { Task { await load() } }.frame(minHeight: 44)
                    }
                    if let map {
                        Text("Current \(map.currentLevel.rawValue) · Viewing \(map.viewedLevel.rawValue)")
                            .font(.headline)
                        if map.previewOnly {
                            Text("Reach this level to practise its objectives.")
                        } else if map.viewedLevel < map.currentLevel {
                            Text("Review at \(map.viewedLevel.rawValue). Your course level stays the same.")
                        }
                        Text("\(map.readiness.confidentCount) of \(map.readiness.requiredCount) required objectives confident")
                        if let coverage = map.coverage {
                            DisclosureGroup("Captured skill requirements") {
                                ForEach(coverage.skills.keys.sorted(), id: \.self) { skill in
                                    Text("\(skill.capitalized): \(coverage.skills[skill]?.state.replacingOccurrences(of: "_", with: " ").lowercased() ?? "")")
                                }
                            }
                        } else {
                            Text("Requirements will be captured when this band opens.").font(.caption)
                        }
                        if !map.readiness.missingObjectiveIds.isEmpty {
                            DisclosureGroup("Missing objectives (\(map.readiness.missingObjectiveIds.count))") {
                                ForEach(map.readiness.missingObjectiveIds, id: \.self) { id in
                                    Text(map.nodes.first(where: { $0.id == id })?.node.title ?? id)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                        let visibleIds = map.visibleNodeIds(query: query)
                        if visibleIds.isEmpty { Text("No objectives match this search.") }
                        ForEach(map.roots.filter { visibleIds.contains($0.id) }) { row in
                            LearningMapNodeRow(row: row, map: map, selected: $selected, disabled: busy || map.previewOnly, visibleIds: visibleIds)
                        }
                        SavedSourceFocusLibrary(courseId: courseId, target: map.targetLang, level: map.viewedLevel,
                            previewOnly: map.previewOnly, selectedObjectiveCount: selected.count,
                            onCombine: { request in Task { await resolveSelection(request: request, includeSelected: true) } }) { request in
                            Task { await resolveSelection(request: request) }
                        }.environmentObject(model).disabled(busy)
                        if !map.previewOnly {
                            Button("Review selected practice (\(selected.count))") { Task { await resolveSelection() } }
                                .buttonStyle(.bordered).frame(minHeight: 44)
                                .disabled(busy || selected.isEmpty)
                            if let preview {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Practice at \(preview.selection.level.rawValue)").font(.headline)
                                    ForEach(preview.selection.objectives, id: \.id) { Text($0.title) }
                                    if let credit = preview.sourceCreditMessage {
                                        Text(credit).font(.caption)
                                    }
                                    Picker("Practice format", selection: $kind) {
                                        ForEach(preview.availableKinds, id: \.self) { Text($0.capitalized).tag($0) }
                                    }
                                    .frame(minHeight: 44)
                                    .disabled(busy)
                                    Button("Start focused practice") { Task { await start(preview) } }
                                        .buttonStyle(.borderedProminent).frame(minHeight: 44).disabled(busy)
                                }
                            }
                        }
                        if map.currentLevel == map.viewedLevel {
                            ForEach(map.blockers, id: \.self) { Text($0).font(.callout) }
                            if map.completedAt != nil && map.currentLevel == .c2 {
                                Text("C2 completed. Continue maintenance practice.")
                            } else if map.canAdvance {
                                Button(map.readiness.nextLevel.map { "Complete \(map.currentLevel.rawValue) and open \($0.rawValue)" } ?? "Complete C2") {
                                    Task { await advance(map) }
                                }
                                .buttonStyle(.borderedProminent).frame(minHeight: 44).disabled(busy)
                            }
                        }
                        DisclosureGroup("Sources") {
                            ForEach(map.references) { reference in
                                if ["https", "http"].contains(reference.url.scheme?.lowercased() ?? "") {
                                    Link(reference.title, destination: reference.url).frame(minHeight: 44)
                                }
                            }
                        }
                    }
                }
                .padding(layout.pagePadding)
                .frame(maxWidth: layout.readableWidth, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Learning map")
            .searchable(text: $query, prompt: "Search objectives and examples")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await load() } }.disabled(busy)
                }
            }
            .task(id: context) { await load() }
            .onChange(of: selected) { _, _ in preview = nil }
            .onDisappear { activity.invalidate() }
        }
    }

    private func load() async {
        guard let owner = context else {
            activity.invalidate(); map = nil; preview = nil; selected = []
            return
        }
        let token = activity.begin(owner)
        error = ""; preview = nil; selected = []
        defer { activity.finish(token, context: context) }
        do {
            let value = try await model.learningMap(courseId: owner.courseId, level: owner.viewedLevel)
            try Task.checkCancellation()
            guard activity.accepts(token, context: context) else { return }
            map = value
            activity.reconcileAdvance(value, context: owner)
        } catch {
            if activity.accepts(token, context: context) && !Task.isCancelled { self.error = error.localizedDescription; map = nil }
        }
    }

    private func resolveSelection(request chosen: SottoLearningSelection? = nil, includeSelected: Bool = false) async {
        guard let map, !map.previewOnly, !busy, let owner = context,
              map.viewedLevel == (owner.viewedLevel ?? map.currentLevel) else { return }
        let token = activity.begin(owner)
        error = ""
        defer { activity.finish(token, context: context) }
        do {
            let request = try map.practiceSelection(source: chosen, selected: chosen == nil || includeSelected ? selected : [])
            let value = try await model.previewLearningSelection(courseId: owner.courseId, selection: request)
            guard activity.accepts(token, context: context), !Task.isCancelled else { return }
            let explicit = Set(request.nodeIds.filter { id in map.nodes.contains { $0.id == id && $0.node.kind == "OBJECTIVE" } })
            guard value.selection.targetLang == map.targetLang,
                  explicit.isSubset(of: Set(value.selection.objectives.map(\.id))) else {
                throw SottoAPIError.message("The practice preview dropped an explicit objective or changed its language.")
            }
            preview = value; kind = value.availableKinds.contains("FULL") ? "FULL" : value.availableKinds[0]
        } catch { if activity.accepts(token, context: context) && !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func start(_ preview: SottoLearningSelectionPreview) async {
        guard !busy, let map, !map.previewOnly, self.preview?.selection == preview.selection,
              preview.availableKinds.contains(kind), let owner = context,
              map.viewedLevel == (owner.viewedLevel ?? map.currentLevel),
              preview.selection.level == map.viewedLevel else { return }
        let token = activity.begin(owner)
        defer { activity.finish(token, context: context) }
        await model.startPractice(courseId: owner.courseId, kind: kind, learningSelection: preview.explicitSelection())
        guard activity.accepts(token, context: context), !Task.isCancelled else { return }
        if model.practiceStart != nil && model.errorMessage == nil { dismiss() }
        else { error = model.errorMessage ?? "Practice is not confirmed. Retry the saved request." }
    }

    private func advance(_ map: SottoLearningMap) async {
        guard map.canAdvance, !busy, let owner = context,
              map.viewedLevel == (owner.viewedLevel ?? map.currentLevel) else { return }
        let request = activity.advanceRequest(context: owner, level: map.currentLevel, catalogHash: map.catalogHash)
        let token = activity.begin(owner)
        error = ""
        defer { activity.finish(token, context: context) }
        do {
            try await model.advanceLearningLevel(courseId: owner.courseId, request: request)
            guard activity.accepts(token, context: context), !Task.isCancelled else { return }
            activity.confirmAdvance(request, context: owner)
            if viewed != nil { viewed = nil }
            else { await load() }
        } catch { if activity.accepts(token, context: context) && !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

private struct LearningMapNodeRow: View {
    let row: SottoLearningNodeView
    let map: SottoLearningMap
    @Binding var selected: Set<String>
    let disabled: Bool
    let visibleIds: Set<String>
    var body: some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 10) {
                if !row.node.description.isEmpty { Text(row.node.description) }
                if row.node.kind == "GROUP" {
                    ForEach(map.children(of: row.id).filter { visibleIds.contains($0.id) }) { child in
                        LearningMapNodeRow(row: child, map: map, selected: $selected, disabled: disabled, visibleIds: visibleIds)
                    }
                } else {
                    Toggle("Select \(row.node.title)", isOn: Binding(
                        get: { selected.contains(row.id) },
                        set: { if $0 { selected.insert(row.id) } else { selected.remove(row.id) } }
                    )).disabled(disabled).frame(minHeight: 44)
                    if let assessment = row.node.assessment { Text(assessment) }
                    ForEach(row.node.examples ?? [], id: \.self) { Text($0).italic() }
                    ForEach(row.progress?.skills ?? []) { skill in
                        VStack(alignment: .leading) {
                            Text("\(skill.skill.capitalized): \(skill.exempt ? "Exempt in this band" : skill.status.replacingOccurrences(of: "_", with: " ").lowercased())")
                            if let criterion = row.node.skillCriteria?[skill.skill] { Text(criterion).font(.caption) }
                        }
                    }
                }
            }.padding(.leading, 8)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.node.title).font(.headline)
                if let progress = row.progress {
                    Text(progress.status.replacingOccurrences(of: "_", with: " ").lowercased()).font(.caption)
                    if progress.reviewDue { Text("Review due").font(.caption).foregroundStyle(SottoTheme.primary) }
                } else {
                    Text("\(row.summary.confident)/\(row.summary.total) confident · \(row.summary.reviewDue) due").font(.caption)
                }
            }.frame(minHeight: 44, alignment: .leading)
        }
    }
}
