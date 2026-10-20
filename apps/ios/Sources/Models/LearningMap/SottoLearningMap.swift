import Foundation

enum SottoLearningLevel: String, Codable, CaseIterable, Identifiable, Comparable {
    case a1 = "A1", a2 = "A2", b1 = "B1", b2 = "B2", c1 = "C1", c2 = "C2"
    var id: String { rawValue }
    static func < (lhs: Self, rhs: Self) -> Bool {
        allCases.firstIndex(of: lhs)! < allCases.firstIndex(of: rhs)!
    }
}

struct SottoLearningSelection: Codable, Equatable {
    let catalogVersion: Int?
    let nodeIds: [String]
    let level: SottoLearningLevel
    var materialFocusId: String?
    private enum CodingKeys: String, CodingKey { case catalogVersion, nodeIds, level, materialFocusId }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        if let catalogVersion { try values.encode(catalogVersion, forKey: .catalogVersion) }
        else { try values.encodeNil(forKey: .catalogVersion) }
        try values.encode(nodeIds, forKey: .nodeIds)
        try values.encode(level, forKey: .level)
        try values.encodeIfPresent(materialFocusId, forKey: .materialFocusId)
    }
}

struct SottoLearningMap: Decodable {
    struct Readiness: Decodable {
        let level: SottoLearningLevel
        let nextLevel: SottoLearningLevel?
        let ready: Bool
        let requiredCount: Int
        let confidentCount: Int
        let unassessedCount: Int
        let practisingCount: Int
        let needsWorkCount: Int
        let missingObjectiveIds: [String]
        let exemptSkills: [String]
    }
    struct Reference: Decodable, Identifiable {
        let title: String
        let url: URL
        var id: String { url.absoluteString }
    }
    let courseId: String
    let targetLang: String
    let currentLevel: SottoLearningLevel
    let viewedLevel: SottoLearningLevel
    let catalogVersion: Int
    let catalogHash: String
    let requirementId: String?
    let coverage: SottoSkillRequirements?
    let readiness: Readiness
    let blockers: [String]
    let completedAt: String?
    let references: [Reference]
    let nodes: [SottoLearningNodeView]

    var previewOnly: Bool { viewedLevel > currentLevel }
    var canAdvance: Bool {
        viewedLevel == currentLevel && readiness.ready && blockers.isEmpty && completedAt == nil
    }
    var roots: [SottoLearningNodeView] {
        nodes.filter { $0.node.parentId == nil }.sorted { $0.node.order < $1.node.order }
    }
    func children(of id: String) -> [SottoLearningNodeView] {
        nodes.filter { $0.node.parentId == id }.sorted { $0.node.order < $1.node.order }
    }
    func practiceSelection(source: SottoLearningSelection?, selected: Set<String>) throws -> SottoLearningSelection {
        guard !previewOnly, source == nil || source?.level == viewedLevel else {
            throw SottoAPIError.message("The source practice level changed. Review the current selection.")
        }
        let ids = selected.union(source?.nodeIds ?? [])
        guard ids.allSatisfy({ id in
            nodes.contains { $0.id == id && $0.node.kind == "OBJECTIVE" && $0.node.level == viewedLevel }
        }), !ids.isEmpty || source?.materialFocusId != nil else {
            throw SottoAPIError.message("Choose objectives from this level before reviewing practice.")
        }
        return SottoLearningSelection(catalogVersion: ids.isEmpty ? nil : catalogVersion,
            nodeIds: ids.sorted(), level: viewedLevel, materialFocusId: source?.materialFocusId)
    }
    func visibleNodeIds(query: String) -> Set<String> {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if needle.isEmpty { return Set(nodes.map(\.id)) }
        let matched = nodes.filter { entry in
            ([entry.node.title, entry.node.description, entry.node.assessment ?? ""] +
                (entry.node.examples ?? []) + (entry.node.grammarKeys ?? []) +
                Array((entry.node.skillCriteria ?? [:]).values))
                .contains { $0.lowercased().contains(needle) }
        }
        var visible = Set(matched.map(\.id))
        var groups = matched.filter { $0.node.kind == "GROUP" }.map(\.id)
        while let group = groups.popLast() {
            for child in children(of: group) where visible.insert(child.id).inserted {
                if child.node.kind == "GROUP" { groups.append(child.id) }
            }
        }
        let byId = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
        for id in Array(visible) {
            var parent = byId[id]?.node.parentId
            while let id = parent { visible.insert(id); parent = byId[id]?.node.parentId }
        }
        return visible
    }
    func validate(courseId: String, level: SottoLearningLevel?) throws {
        guard self.courseId == courseId, level == nil || level == viewedLevel,
              readiness.level == viewedLevel, catalogVersion > 0,
              catalogHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              Set(nodes.map(\.id)).count == nodes.count else {
            throw SottoAPIError.message("The learning map receipt changed. Reload this course.")
        }
        let byId = Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
        for entry in nodes {
            guard entry.id.hasPrefix("\(targetLang)."),
                  entry.node.kind == "GROUP" || entry.node.kind == "OBJECTIVE" && entry.node.level == viewedLevel,
                  entry.node.kind == "GROUP" || entry.progress?.objectiveId == entry.id else {
                throw SottoAPIError.message("The learning map objective identity changed.")
            }
            var seen = Set([entry.id])
            var parent = entry.node.parentId
            while let id = parent {
                guard seen.insert(id).inserted, let row = byId[id], row.node.kind == "GROUP",
                      row.node.branch == entry.node.branch else {
                    throw SottoAPIError.message("The learning map hierarchy is invalid.")
                }
                parent = row.node.parentId
            }
        }
    }
}

struct SottoLearningNode: Decodable {
    let id: String
    let parentId: String?
    let branch: String
    let kind: String
    let title: String
    let description: String
    let order: Int
    let level: SottoLearningLevel?
    let skills: [String]?
    let skillCriteria: [String: String]?
    let assessment: String?
    let examples: [String]?
    let grammarKeys: [String]?
}

struct SottoObjectiveProgress: Decodable {
    struct Skill: Decodable, Identifiable {
        let skill: String
        let status: String
        let exempt: Bool
        var id: String { skill }
    }
    let objectiveId: String
    let status: String
    let reviewDue: Bool
    let skills: [Skill]
}

struct SottoLearningNodeView: Decodable, Identifiable {
    struct Summary: Decodable {
        let total: Int
        let confident: Int
        let notAssessed: Int
        let reviewDue: Int
    }
    let node: SottoLearningNode
    let progress: SottoObjectiveProgress?
    let summary: Summary
    var id: String { node.id }
}

struct SottoLearningSelectionPreview: Decodable {
    struct Snapshot: Decodable, Equatable {
        struct Objective: Decodable, Equatable { let id: String; let title: String; let level: SottoLearningLevel }
        let catalogVersion: Int?
        let targetLang: String
        let level: SottoLearningLevel
        let nodeIds: [String]
        let objectives: [Objective]
        let materialFocusId: String?
    }
    let selection: Snapshot
    let availableKinds: [String]
    let requirementId: String?
    var sourceCreditMessage: String? {
        guard selection.materialFocusId != nil else { return nil }
        return selection.objectives.isEmpty
            ? "Private source practice. No canonical objective credit."
            : "Your source guides this practice. Eligible assessment results can contribute to the selected objectives."
    }
    func explicitSelection() -> SottoLearningSelection {
        SottoLearningSelection(catalogVersion: selection.catalogVersion,
            nodeIds: selection.objectives.map(\.id).sorted(), level: selection.level,
            materialFocusId: selection.materialFocusId)
    }
}

struct SottoLearningAdvanceRequest: Codable, Equatable {
    let requestId: UUID
    let expectedLevel: SottoLearningLevel
    let catalogHash: String
}

struct SottoLearningCompletion: Decodable {
    let completed: Bool
    let courseId: String
    let level: SottoLearningLevel
    let currentLevel: SottoLearningLevel
    let nextLevel: SottoLearningLevel?
    let requirementId: String
    let completedAt: String
    let exemptSkills: [String]
}
