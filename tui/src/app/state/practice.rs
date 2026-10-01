use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ProductiveWork {
    Speaking(SpeakingPhase),
    Writing { text: String, phase: WritingPhase },
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProgressSave {
    pub revision: i64,
    pub dirty: bool,
    pub in_flight: Option<u64>,
    pub sequence: u64,
    pub conflict: bool,
    pub reconcile_confirmation: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PracticeSnapshot {
    session_id: String,
    #[serde(default)] items: Vec<types::PracticeItem>,
    episode_id: Option<String>,
    #[serde(default)] speaking_prompts: Vec<types::PracticeSpeakingPrompt>,
    #[serde(default)] writing_prompts: Vec<types::PracticeWritingPrompt>,
    #[serde(default)] prompts: Vec<serde_json::Value>,
    #[serde(default)] learner_answers: BTreeMap<String, i64>,
    #[serde(default)] writing_drafts: BTreeMap<String, String>,
    #[serde(default)] progress_revision: i64,
    submission_result: Option<types::SubmitPracticeResponse>,
    skill_requirements: Option<serde_json::Value>,
}

fn practice_view(course: Course, response: &types::StartPracticeResponse) -> Result<View, Box<Course>> {
    let value = serde_json::to_value(response).map_err(|_| Box::new(course.clone()))?;
    let mut saved: PracticeSnapshot = serde_json::from_value(value.clone()).map_err(|_| Box::new(course.clone()))?;
    if let Some(receipt) = saved.submission_result {
        return Ok(View::Result { course, result: PracticeResult::from(&receipt) });
    }
    let status = value["status"].as_str().unwrap_or_default();
    if status == "ready_writing" {
        saved.writing_prompts = serde_json::from_value(serde_json::Value::Array(saved.prompts)).map_err(|_| Box::new(course.clone()))?;
    } else if status == "ready_speaking" {
        saved.speaking_prompts = serde_json::from_value(serde_json::Value::Array(saved.prompts)).map_err(|_| Box::new(course.clone()))?;
    }
    let kind = value["kind"].as_str().unwrap_or_default();
    let mut sections = Vec::new();
    let groups = if kind == "FULL" { vec![("f", "Focus review", types::SkillType::Grammar), ("v", "Vocabulary review", types::SkillType::Grammar), ("g", "Grammar", types::SkillType::Grammar), ("r", "Reading", types::SkillType::Reading), ("l", "Listening", types::SkillType::Listening)] }
        else { vec![("", skill_name(value["kind"].as_str().and_then(|kind| serde_json::from_value(serde_json::json!(kind)).ok()).unwrap_or(types::PracticeKind::Grammar)), match kind { "READING" => types::SkillType::Reading, "LISTENING" => types::SkillType::Listening, _ => types::SkillType::Grammar })] };
    let mut identities = std::collections::BTreeSet::new();
    for (prefix, label, skill) in groups {
        let items: Vec<_> = saved.items.iter().filter(|item| prefix.is_empty() || item.id.starts_with(prefix)).collect();
        if items.is_empty() { continue; }
        if items.iter().any(|item| item.options.is_empty() || !identities.insert(item.id.clone())) { return Err(Box::new(course)); }
        let questions = items.iter().map(|item| {
            let converted = VocabItem::from(*item);
            ClassQuestion { id: converted.id, prompt: converted.prompt, options: converted.options }
        }).collect::<Vec<_>>();
        let selected: Vec<Option<usize>> = questions.iter().map(|q| saved.learner_answers.get(&q.id).and_then(|choice| usize::try_from(*choice).ok()).filter(|choice| *choice < q.options.len())).collect();
        let index = selected.iter().position(Option::is_none).unwrap_or(0);
        let progress = if skill == types::SkillType::Listening {
            let Some(episode_id) = saved.episode_id.clone() else { return Err(Box::new(course)); };
            SectionProgress::Listening { episode_id, episode: None, questions, selected, index, cursor: 0, audio_note: None, ask: Box::new(AskState::closed()) }
        } else { SectionProgress::Mc { questions, selected, index, cursor: 0, prompt_scroll: 0 } };
        sections.push(ClassSection { id: prefix.to_string(), skill, progress, label: Some(label.to_string()), work: BTreeMap::new() });
    }
    if identities.len() != saved.items.len() { return Err(Box::new(course)); }
    if !saved.speaking_prompts.is_empty() {
        let work = saved.speaking_prompts.iter().map(|prompt| {
            let phase = match &prompt.latest_recording {
                Some(recording) => match recording.status {
                    types::PracticeSpeakingPromptLatestRecordingStatus::Scored if recording.overall_score.is_some() => SpeakingPhase::Graded { score: recording.overall_score.map(pct), transcript: recording.transcript.clone(), feedback: recording.feedback.clone() },
                    types::PracticeSpeakingPromptLatestRecordingStatus::Failed => SpeakingPhase::Failed { message: "This recording could not be graded. Record another attempt.".into() },
                    _ => SpeakingPhase::Polling { recording_id: recording.recording_id.clone() },
                },
                None => SpeakingPhase::Idle,
            };
            (prompt.id.clone(), ProductiveWork::Speaking(phase))
        }).collect::<BTreeMap<_, _>>();
        let prompts: Vec<_> = saved.speaking_prompts.iter().map(SpeakingPrompt::from).collect();
        let index = prompts.iter().position(|prompt| !matches!(work.get(&prompt.id), Some(ProductiveWork::Speaking(SpeakingPhase::Graded { .. })))).unwrap_or(0);
        let phase = match work.get(&prompts[index].id) { Some(ProductiveWork::Speaking(phase)) => phase.clone(), _ => SpeakingPhase::Idle };
        sections.push(ClassSection { id: "speaking".into(), skill: types::SkillType::Speaking, progress: SectionProgress::Speaking { prompts, index, phase }, label: None, work });
    }
    if !saved.writing_prompts.is_empty() {
        let work = saved.writing_prompts.iter().map(|prompt| {
            let text = saved.writing_drafts.get(&prompt.id).cloned().or_else(|| prompt.saved_draft.clone()).or_else(|| prompt.response.as_ref().map(|response| response.text.clone())).unwrap_or_default();
            let phase = prompt.response.as_ref().filter(|response| response.text.trim() == text.trim()).map(|response| WritingPhase::Graded { score: pct(response.overall_score), feedback: writing_feedback(&response.feedback, &response.corrections.iter().map(|correction| (correction.old.as_str(), correction.new.as_str(), correction.why.as_str())).collect::<Vec<_>>()) }).unwrap_or(WritingPhase::Editing);
            (prompt.id.clone(), ProductiveWork::Writing { text, phase })
        }).collect::<BTreeMap<_, _>>();
        let prompts: Vec<_> = saved.writing_prompts.iter().map(|prompt| ClassWritingPrompt { id: prompt.id.clone(), task: prompt.task.clone(), guidance: prompt.guidance.clone() }).collect();
        let index = prompts.iter().position(|prompt| !matches!(work.get(&prompt.id), Some(ProductiveWork::Writing { phase: WritingPhase::Graded { .. }, .. }))).unwrap_or(0);
        let (input, phase) = match work.get(&prompts[index].id) { Some(ProductiveWork::Writing { text, phase }) => (WritingInput::from_text(text), phase.clone()), _ => (WritingInput::new(), WritingPhase::Editing) };
        sections.push(ClassSection { id: "writing".into(), skill: types::SkillType::Writing, progress: SectionProgress::Writing { prompts, index, input, phase }, label: None, work });
    }
    if sections.is_empty() { return Err(Box::new(course)); }
    let requirements = saved.skill_requirements.and_then(|value| value.get("skills").cloned()).and_then(|skills| skills.as_object().cloned()).map(|skills| skills.iter().filter_map(|(skill, rule)| {
        if rule["state"] == "EXEMPT_NO_PROVIDER" { Some(format!("{} unavailable: {}", skill.to_lowercase(), rule["reason"].as_str().unwrap_or("provider missing").to_lowercase().replace('_', " "))) } else { None }
    }).collect()).unwrap_or_default();
    let cursor = sections.iter().position(|section| !section_complete(section)).unwrap_or(0);
    Ok(View::Practice { course, session_id: saved.session_id, sections: Some(sections), cursor, submitting: false, progress: ProgressSave { revision: saved.progress_revision, ..Default::default() }, requirements })
}

pub(crate) fn writing_feedback(feedback: &str, corrections: &[(&str, &str, &str)]) -> String {
    let mut text = feedback.to_string();
    for (old, new, why) in corrections { text.push_str(&format!("\n\n{old} → {new}\n{why}")); }
    text
}

impl ClassSection {
    pub fn remember_productive_work(&mut self) {
        match &self.progress {
            SectionProgress::Speaking { prompts, index, phase } => if let Some(prompt) = prompts.get(*index) { self.work.insert(prompt.id.clone(), ProductiveWork::Speaking(phase.clone())); },
            SectionProgress::Writing { prompts, index, input, phase } => if let Some(prompt) = prompts.get(*index) { self.work.insert(prompt.id.clone(), ProductiveWork::Writing { text: input.text(), phase: phase.clone() }); },
            _ => {}
        }
    }
}

pub(crate) fn refresh_cached_practice(cached: &mut View, fresh: &View) {
    let cached_sections = match cached { View::Practice { sections: Some(sections), .. } | View::Class { sections: Some(sections), .. } => sections, _ => return };
    let fresh_sections = match fresh { View::Practice { sections: Some(sections), .. } | View::Class { sections: Some(sections), .. } => sections, _ => return };
    for section in cached_sections {
        section.remember_productive_work();
        let Some(latest) = fresh_sections.iter().find(|latest| latest.id == section.id) else { continue; };
        for (id, work) in &latest.work {
            if matches!(section.work.get(id), Some(ProductiveWork::Speaking(SpeakingPhase::UnknownUpload { .. } | SpeakingPhase::Uploading))) {
                let recorded_id = |progress: &SectionProgress| match progress {
                    SectionProgress::Speaking { prompts, .. } => prompts.iter().find(|prompt| &prompt.id == id).and_then(|prompt| prompt.recording_id.clone()),
                    _ => None,
                };
                let fresh_id = recorded_id(&latest.progress);
                if fresh_id.is_none() || fresh_id == recorded_id(&section.progress) { continue; }
                if let (SectionProgress::Speaking { prompts, .. }, Some(fresh_id)) = (&mut section.progress, fresh_id)
                    && let Some(prompt) = prompts.iter_mut().find(|prompt| &prompt.id == id) {
                    prompt.recording_id = Some(fresh_id);
                }
            }
            match (section.work.get(id), work) {
                (Some(ProductiveWork::Writing { text, .. }), ProductiveWork::Writing { text: graded_text, phase }) if text.trim() == graded_text.trim() => {
                    section.work.insert(id.clone(), ProductiveWork::Writing { text: text.clone(), phase: phase.clone() });
                },
                (Some(ProductiveWork::Speaking(SpeakingPhase::UnknownUpload { .. } | SpeakingPhase::Uploading)), ProductiveWork::Speaking(SpeakingPhase::Idle)) => {},
                (_, ProductiveWork::Speaking(phase)) => {
                    if let (SectionProgress::Speaking { prompts, .. }, SectionProgress::Speaking { prompts: fresh_prompts, .. }) = (&mut section.progress, &latest.progress)
                        && let Some(prompt) = prompts.iter_mut().find(|prompt| &prompt.id == id) {
                        prompt.recording_id = fresh_prompts.iter().find(|prompt| &prompt.id == id).and_then(|prompt| prompt.recording_id.clone());
                    }
                    section.work.insert(id.clone(), ProductiveWork::Speaking(phase.clone()));
                },
                _ => {},
            }
        }
        match &mut section.progress {
            SectionProgress::Writing { prompts, index, phase, .. } => {
                if let Some(ProductiveWork::Writing { phase: latest, .. }) = prompts.get(*index).and_then(|prompt| section.work.get(&prompt.id)) { *phase = latest.clone(); }
            },
            SectionProgress::Speaking { prompts, index, phase } => {
                if let Some(ProductiveWork::Speaking(latest)) = prompts.get(*index).and_then(|prompt| section.work.get(&prompt.id)) { *phase = latest.clone(); }
            },
            _ => {}
        }
    }
}

impl View {
    pub(crate) fn has_uncertain_upload(&self) -> bool {
        let sections = match self {
            View::Class { sections: Some(sections), .. } | View::Practice { sections: Some(sections), .. } => sections,
            _ => return false,
        };
        sections.iter().any(|section| matches!(&section.progress, SectionProgress::Speaking { phase: SpeakingPhase::UnknownUpload { .. } | SpeakingPhase::Uploading, .. }) ||
            section.work.values().any(|work| matches!(work, ProductiveWork::Speaking(SpeakingPhase::UnknownUpload { .. } | SpeakingPhase::Uploading))))
    }
}
