import Foundation

private let requiredClassSkills = ["GRAMMAR", "READING", "LISTENING", "SPEAKING", "WRITING"]

func classPresentationIssues(_ classDetail: SottoClassDetail) -> [String] {
    var issues: [String] = []
    let sectionsBySkill = classDetail.sections.reduce(into: [String: SottoClassSection]()) { result, section in
        result[section.skill.uppercased()] = section
    }
    for skill in requiredClassSkills where sectionsBySkill[skill] == nil {
        issues.append("Missing \(classSkillLabel(skill)) section.")
    }
    if let reading = sectionsBySkill["READING"],
       !reading.questions.contains(where: { ($0.passageText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false }) {
        issues.append("Reading section has no full reading passage.")
    }
    if let listening = sectionsBySkill["LISTENING"], listening.episode == nil {
        issues.append("Listening section has no audio episode.")
    } else if let listening = sectionsBySkill["LISTENING"], let episode = listening.episode, episode.audioUrl == nil {
        if episode.status == "FAILED" {
            let detail = episode.failureReason ?? episode.technicalError
            issues.append("Listening section audio failed\(detail.map { ": \($0)" } ?? ".")")
        } else { issues.append("Listening section audio is not ready yet.") }
    }
    if let speaking = sectionsBySkill["SPEAKING"], speaking.prompts.isEmpty {
        issues.append("Speaking section has no speaking prompts.")
    }
    if let writing = sectionsBySkill["WRITING"], writing.writingPrompts.isEmpty {
        issues.append("Writing section has no writing prompts.")
    }
    return issues
}

func isClassPresentationStillRendering(_ classDetail: SottoClassDetail) -> Bool {
    let listening = classDetail.sections.first { $0.skill.uppercased() == "LISTENING" }
    guard let episode = listening?.episode, episode.audioUrl == nil else { return false }
    return episode.status != "READY" && episode.status != "FAILED"
}
