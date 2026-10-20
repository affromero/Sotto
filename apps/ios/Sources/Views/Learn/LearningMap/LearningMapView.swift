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
    @State private var busy = false
    @State private var error = ""
    @State private var epoch = UUID()
    @State private var pendingAdvance: SottoLearningAdvanceRequest?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Picker("Viewed level", selection: $viewed) {
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
                            previewOnly: map.previewOnly) { request in
                            Task { await resolveSelection(request: request) }
                        }.environmentObject(model)
                        if !map.previewOnly {
                            Button("Review selected practice (\(selected.count))") { Task { await resolveSelection() } }
                                .buttonStyle(.bordered).frame(minHeight: 44)
                                .disabled(busy || selected.isEmpty)
                            if let preview {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Practice at \(preview.selection.level.rawValue)").font(.headline)
                                    ForEach(preview.selection.objectives, id: \.id) { Text($0.title) }
                                    if preview.selection.materialFocusId != nil {
                                        Text("Private source practice. No canonical objective credit.").font(.caption)
                                    }
                                    Picker("Practice format", selection: $kind) {
                                        ForEach(preview.availableKinds, id: \.self) { Text($0.capitalized).tag($0) }
                                    }
                                    .frame(minHeight: 44)
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
            .task(id: viewed) { await load() }
            .onChange(of: selected) { _, _ in preview = nil }
            .onDisappear { epoch = UUID() }
        }
    }

    private func load() async {
        let token = UUID(); epoch = token
        busy = true; error = ""; preview = nil; selected = []
        defer { if epoch == token { busy = false } }
        do {
            let value = try await model.learningMap(courseId: courseId, level: viewed)
            try Task.checkCancellation()
            guard epoch == token else { return }
            map = value
            if let pendingAdvance, value.currentLevel != pendingAdvance.expectedLevel || value.completedAt != nil {
                self.pendingAdvance = nil
            }
        } catch {
            if epoch == token && !Task.isCancelled { self.error = error.localizedDescription; map = nil }
        }
    }

    private func resolveSelection(request chosen: SottoLearningSelection? = nil) async {
        guard let map, !map.previewOnly, !busy else { return }
        let request = chosen ?? SottoLearningSelection(catalogVersion: map.catalogVersion,
            nodeIds: selected.sorted(), level: map.viewedLevel)
        busy = true; error = ""
        let token = epoch
        defer { if epoch == token { busy = false } }
        do {
            let value = try await model.previewLearningSelection(courseId: courseId, selection: request)
            guard epoch == token else { return }
            let explicit = Set(request.nodeIds.filter { id in map.nodes.contains { $0.id == id && $0.node.kind == "OBJECTIVE" } })
            guard value.selection.targetLang == map.targetLang,
                  explicit.isSubset(of: Set(value.selection.objectives.map(\.id))) else {
                throw SottoAPIError.message("The practice preview dropped an explicit objective or changed its language.")
            }
            preview = value; kind = value.availableKinds.contains("FULL") ? "FULL" : value.availableKinds[0]
        } catch { if epoch == token { self.error = error.localizedDescription } }
    }

    private func start(_ preview: SottoLearningSelectionPreview) async {
        guard !busy, map?.previewOnly == false, preview.availableKinds.contains(kind) else { return }
        busy = true
        await model.startPractice(courseId: courseId, kind: kind, learningSelection: preview.explicitSelection())
        busy = false
        if model.practiceStart != nil && model.errorMessage == nil { dismiss() }
        else { error = model.errorMessage ?? "Practice is not confirmed. Retry the saved request." }
    }

    private func advance(_ map: SottoLearningMap) async {
        guard map.canAdvance, !busy else { return }
        let request = pendingAdvance ?? SottoLearningAdvanceRequest(requestId: UUID(), expectedLevel: map.currentLevel, catalogHash: map.catalogHash)
        pendingAdvance = request
        busy = true; error = ""
        do {
            try await model.advanceLearningLevel(courseId: courseId, request: request)
            pendingAdvance = nil; viewed = nil
            await load()
        } catch { self.error = error.localizedDescription; busy = false }
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
