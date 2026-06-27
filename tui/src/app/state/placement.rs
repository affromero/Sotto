/// A readable course title from native + target codes, e.g.
/// "English → Spanish". Falls back to "Your course" when codes are missing.
pub(crate) fn course_title(native: &str, target: &str) -> String {
    if native.is_empty() || target.is_empty() {
        "Your course".to_string()
    } else {
        format!("{} → {}", language_name(native), language_name(target))
    }
}

/// Which column of the placement language picker is focused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LangColumn {
    Native,
    Target,
}

/// One placement question (the public MC projection). Reuses the same shape as
/// a [`ClassQuestion`] so it renders through the shared MC machinery.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PlacementQuestion {
    pub id: String,
    pub prompt: String,
    pub options: Vec<String>,
}

impl From<&types::PlacementQuestion> for PlacementQuestion {
    fn from(q: &types::PlacementQuestion) -> Self {
        // Surface the CEFR band + skill in the prompt for context.
        let prompt = format!("[{} · {}] {}", q.cefr, q.skill, q.prompt);
        Self {
            id: q.id.clone(),
            prompt,
            options: q.options.clone(),
        }
    }
}

/// Validate + convert a generated placement batch. Returns `None` (malformed)
/// when there are no questions or any question has no answer options.
pub(crate) fn placement_questions(
    resp: &types::GeneratePlacementResponse,
) -> Option<Vec<PlacementQuestion>> {
    if resp.questions.is_empty() {
        return None;
    }
    if resp.questions.iter().any(|q| q.options.is_empty()) {
        return None;
    }
    Some(resp.questions.iter().map(PlacementQuestion::from).collect())
}

/// Build the placement submit payload from questions + recorded selections.
/// Unanswered questions are omitted; an answered question whose id is empty
/// errors rather than being silently dropped (the contract requires non-empty
/// ids; a partial payload would misgrade).
pub(crate) fn build_placement_answers(
    questions: &[PlacementQuestion],
    selected: &[Option<usize>],
) -> Result<Vec<types::SubmitPlacementRequestAnswersItem>, String> {
    let mut answers = Vec::new();
    for (q, choice) in questions.iter().zip(selected.iter()) {
        if let Some(idx) = choice {
            if q.id.is_empty() {
                return Err("a placement answer has an empty question id".to_string());
            }
            answers.push(types::SubmitPlacementRequestAnswersItem {
                id: q.id.clone(),
                selected_index: *idx as i64,
            });
        }
    }
    Ok(answers)
}

/// The assessed outcome of a submitted placement: the created/updated course id,
/// the CEFR level, and per-skill ratios (0..100 percentages, sorted by skill).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PlacementOutcome {
    pub course_id: String,
    pub level: String,
    pub score_by_skill: Vec<(String, u32)>,
    /// The languages the learner submitted placement for; carried so the course
    /// the learner lands in shows real native/target metadata, not blanks.
    pub native: String,
    pub target: String,
}

impl PlacementOutcome {
    /// Build the outcome from the response plus the `native`/`target` the learner
    /// submitted (the response carries the assessed level + course id, but not
    /// the languages — those come from the submitted request).
    pub fn from_response(
        r: &types::SubmitPlacementResponse,
        native: String,
        target: String,
    ) -> Self {
        let mut score_by_skill: Vec<(String, u32)> = r
            .score_by_skill
            .iter()
            .map(|(k, v)| (k.clone(), pct(*v)))
            .collect();
        score_by_skill.sort_by(|a, b| a.0.cmp(&b.0));
        Self {
            course_id: r.course_id.clone(),
            level: r.level.to_string(),
            score_by_skill,
            native,
            target,
        }
    }
}

/// One memory-graph node, reduced to what the read-only memory screen renders.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MemoryItem {
    /// "vocab" or "grammar".
    pub kind: String,
    pub label: String,
    pub translation: Option<String>,
    /// Mastery, as a 0..100 percentage.
    pub mastery: u32,
    pub due: bool,
}

/// Convert a memory graph into a sorted, renderable item list: vocab first,
/// then grammar; within each, due items first, then by descending mastery.
pub(crate) fn memory_items(graph: &types::MemoryGraphResponse) -> Vec<MemoryItem> {
    let mut items: Vec<MemoryItem> = graph
        .nodes
        .iter()
        .map(|n| MemoryItem {
            kind: match n.kind {
                types::MemoryNodeKind::Vocab => "vocab".to_string(),
                types::MemoryNodeKind::Grammar => "grammar".to_string(),
            },
            label: n.label.clone(),
            translation: n.translation.clone(),
            mastery: pct(n.strength),
            due: n.due,
        })
        .collect();
    // Rank vocab before grammar (not alphabetical, which would invert them).
    let rank = |kind: &str| if kind == "vocab" { 0 } else { 1 };
    items.sort_by(|a, b| {
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then(b.due.cmp(&a.due))
            .then(b.mastery.cmp(&a.mastery))
            .then(a.label.cmp(&b.label))
    });
    items
}

/// The non-secret instance/owner config the settings screen renders.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ConfigView {
    pub self_hosted: bool,
    pub is_owner: bool,
    /// Present only when self-hosted AND the user is the owner.
    pub infra: Option<ConfigInfra>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ConfigInfra {
    pub ai_provider: Option<String>,
    pub ai_model: Option<String>,
    pub stt_provider: Option<String>,
    pub tts_provider: Option<String>,
    pub storage_provider: Option<String>,
}

impl From<&types::OnboardingConfigResponse> for ConfigView {
    fn from(c: &types::OnboardingConfigResponse) -> Self {
        Self {
            self_hosted: c.self_hosted,
            is_owner: c.is_owner,
            infra: c.infra.as_ref().map(|i| ConfigInfra {
                ai_provider: i.ai_provider.clone(),
                ai_model: i.ai_model.clone(),
                stt_provider: i.stt_provider.clone(),
                tts_provider: i.tts_provider.clone(),
                storage_provider: i.storage_provider.clone(),
            }),
        }
    }
}

/// Phases of the notes-based placement flow.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum NotesPhase {
    /// Typing or pasting the materials.
    Entry,
    /// The deduction request is in flight.
    Deducing,
    /// The deduced level, awaiting "start here" or "verify with the test".
    Result {
        level: String,
        rationale: String,
        /// Confidence as a whole percentage (0..100).
        confidence: u8,
    },
    /// The confirm (course creation) request is in flight.
    Confirming,
}
