/// Per-section interactive state, one variant per skill. Mixed-skill class
/// sections reuse the same machinery the standalone practice screens use.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SectionProgress {
    /// GRAMMAR / READING (and any listening comprehension) multiple-choice.
    Mc {
        questions: Vec<ClassQuestion>,
        index: usize,
        cursor: usize,
        selected: Vec<Option<usize>>,
        prompt_scroll: u16,
    },
    /// LISTENING: play the episode, then answer comprehension MCs (if any).
    Listening {
        episode_id: String,
        episode: Option<EpisodeDetail>,
        questions: Vec<ClassQuestion>,
        index: usize,
        cursor: usize,
        selected: Vec<Option<usize>>,
        audio_note: Option<String>,
        /// "Ask a question" overlay state (P6e). Boxed to keep the enum
        /// variant size small.
        ask: Box<AskState>,
    },
    /// SPEAKING: one prompt at a time, record → upload → poll.
    Speaking {
        prompts: Vec<SpeakingPrompt>,
        index: usize,
        phase: SpeakingPhase,
    },
    /// WRITING: free-text response per prompt, graded synchronously.
    Writing {
        prompts: Vec<ClassWritingPrompt>,
        index: usize,
        input: WritingInput,
        phase: WritingPhase,
    },
}

/// One class section: its id, skill, and interactive progress.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClassSection {
    pub id: String,
    pub skill: types::SkillType,
    pub progress: SectionProgress,
}

impl ClassSection {
    /// Build a section's progress from the generated section by its skill. MC
    /// sections (grammar/reading) and listening comprehension use `questions`;
    /// speaking uses `prompts`; writing uses `writing_prompts`.
    fn from_generated(s: &types::ClassSection) -> Self {
        let questions: Vec<ClassQuestion> = s.questions.iter().map(ClassQuestion::from).collect();
        let progress = match s.skill {
            types::SkillType::Speaking => SectionProgress::Speaking {
                prompts: s.prompts.iter().map(SpeakingPrompt::from).collect(),
                index: 0,
                phase: SpeakingPhase::Idle,
            },
            types::SkillType::Writing => SectionProgress::Writing {
                prompts: s
                    .writing_prompts
                    .iter()
                    .map(ClassWritingPrompt::from)
                    .collect(),
                index: 0,
                input: WritingInput::new(),
                phase: WritingPhase::Editing,
            },
            types::SkillType::Listening => SectionProgress::Listening {
                episode_id: s.episode.as_ref().map(|e| e.id.clone()).unwrap_or_default(),
                episode: None,
                selected: vec![None; questions.len()],
                questions,
                index: 0,
                cursor: 0,
                audio_note: None,
                ask: Box::new(AskState::closed()),
            },
            // GRAMMAR / READING.
            _ => SectionProgress::Mc {
                selected: vec![None; questions.len()],
                questions,
                index: 0,
                cursor: 0,
                prompt_scroll: 0,
            },
        };
        Self {
            id: s.id.clone(),
            skill: s.skill,
            progress,
        }
    }
}

/// The graded outcome of a class submission.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClassResult {
    pub passed: bool,
    pub overall_score: u32,
    pub passed_sections: u32,
    pub total_sections: u32,
}

impl From<&types::SubmitClassResponse> for ClassResult {
    fn from(r: &types::SubmitClassResponse) -> Self {
        Self {
            passed: r.passed,
            overall_score: (r.overall_score.clamp(0.0, 1.0) * 100.0).round() as u32,
            passed_sections: count(r.passed_sections),
            total_sections: count(r.total_sections),
        }
    }
}

/// Validate + convert the generated class into orderable sections. Returns the
/// sections (already in route order) or `None` when malformed: no sections, or
/// any section that lacks the content its skill needs to be worked through.
/// Rejecting up front prevents entering a dead section that the learner could
/// neither answer nor leave except by backing out.
pub(crate) fn class_sections(cls: &types::ClassDetailResponse) -> Option<Vec<ClassSection>> {
    if cls.sections.is_empty() {
        return None;
    }
    if !cls.sections.iter().all(section_is_valid) {
        return None;
    }
    Some(
        cls.sections
            .iter()
            .map(ClassSection::from_generated)
            .collect(),
    )
}

/// Whether a section carries the content its skill requires:
/// - GRAMMAR/READING: at least one question, each with at least one option.
/// - LISTENING: an episode is present; any questions must each be answerable
///   (transcript-only with zero questions is valid — the episode is the content).
/// - SPEAKING: at least one prompt.
/// - WRITING: at least one prompt.
fn section_is_valid(s: &types::ClassSection) -> bool {
    // Any present MC question must have options (a zero-option item would let
    // Enter fabricate an answer).
    let questions_answerable = s.questions.iter().all(|q| !q.options.is_empty());
    match s.skill {
        types::SkillType::Grammar | types::SkillType::Reading => {
            !s.questions.is_empty() && questions_answerable
        }
        types::SkillType::Listening => s.episode.is_some() && questions_answerable,
        types::SkillType::Speaking => !s.prompts.is_empty(),
        types::SkillType::Writing => !s.writing_prompts.is_empty(),
    }
}

// ===========================================================================
// Exams — ungated mock exams. They reuse the class section-walk machinery
// ([`SectionProgress`], [`ClassSection`]); only the source shape differs, so a
// parallel converter/validator maps `types::ExamSection` into the same
// `ClassSection`. The exam ends with a band/score result (no level advance).
// ===========================================================================

impl ClassSection {
    /// Build a section's progress from a generated EXAM section by its skill.
    /// The exam section shape parallels the class section (same `ClassQuestion`
    /// and `ClassWritingPrompt` types are reused in the contract); only the
    /// speaking-prompt and episode types differ.
    fn from_exam_section(s: &types::ExamSection) -> Self {
        let questions: Vec<ClassQuestion> = s.questions.iter().map(ClassQuestion::from).collect();
        let progress = match s.skill {
            types::SkillType::Speaking => SectionProgress::Speaking {
                prompts: s
                    .speaking_prompts
                    .iter()
                    .map(SpeakingPrompt::from)
                    .collect(),
                index: 0,
                phase: SpeakingPhase::Idle,
            },
            types::SkillType::Writing => SectionProgress::Writing {
                prompts: s
                    .writing_prompts
                    .iter()
                    .map(ClassWritingPrompt::from)
                    .collect(),
                index: 0,
                input: WritingInput::new(),
                phase: WritingPhase::Editing,
            },
            types::SkillType::Listening => SectionProgress::Listening {
                episode_id: s.episode.as_ref().map(|e| e.id.clone()).unwrap_or_default(),
                episode: None,
                selected: vec![None; questions.len()],
                questions,
                index: 0,
                cursor: 0,
                audio_note: None,
                ask: Box::new(AskState::closed()),
            },
            // GRAMMAR / READING.
            _ => SectionProgress::Mc {
                selected: vec![None; questions.len()],
                questions,
                index: 0,
                cursor: 0,
                prompt_scroll: 0,
            },
        };
        Self {
            id: s.id.clone(),
            skill: s.skill,
            progress,
        }
    }
}

/// The graded band/score outcome of an exam submission.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ExamResult {
    /// Weighted overall, presented as a whole percentage (0..100).
    pub overall_score: u32,
    pub band: String,
    pub feedback: String,
    /// Per-section scores (skill label + percentage).
    pub sections: Vec<ExamSectionResult>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ExamSectionResult {
    pub skill: String,
    pub score: u32,
}

impl From<&types::SubmitExamResponse> for ExamResult {
    fn from(r: &types::SubmitExamResponse) -> Self {
        Self {
            overall_score: pct(r.overall_score),
            band: r.band.clone(),
            feedback: r.feedback.clone(),
            sections: r
                .sections
                .iter()
                .map(|s| ExamSectionResult {
                    skill: s.skill.to_string(),
                    score: pct(s.score),
                })
                .collect(),
        }
    }
}

/// Validate + convert the generated exam into orderable sections, mirroring
/// [`class_sections`]: rejects an empty exam or any section lacking the content
/// its skill needs (so the walk never enters a dead section).
pub(crate) fn exam_sections(exam: &types::ExamDetailResponse) -> Option<Vec<ClassSection>> {
    if exam.sections.is_empty() {
        return None;
    }
    if !exam.sections.iter().all(exam_section_is_valid) {
        return None;
    }
    Some(
        exam.sections
            .iter()
            .map(ClassSection::from_exam_section)
            .collect(),
    )
}

/// Per-skill content validity for an exam section (same rules as classes).
fn exam_section_is_valid(s: &types::ExamSection) -> bool {
    let questions_answerable = s.questions.iter().all(|q| !q.options.is_empty());
    match s.skill {
        types::SkillType::Grammar | types::SkillType::Reading => {
            !s.questions.is_empty() && questions_answerable
        }
        types::SkillType::Listening => s.episode.is_some() && questions_answerable,
        types::SkillType::Speaking => !s.speaking_prompts.is_empty(),
        types::SkillType::Writing => !s.writing_prompts.is_empty(),
    }
}

/// A 0..1 score as a whole percentage (0..100), clamped.
fn pct(score: f64) -> u32 {
    (score.clamp(0.0, 1.0) * 100.0).round() as u32
}

/// Which section-walk flow is active. Classes and exams share the section-walk
/// machinery; only the dispatch endpoints + the final result/submit differ, so
/// the shared handlers branch on this.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FlowKind {
    Class,
    Exam,
}

// ===========================================================================
// Placement, memory graph, onboarding/settings (P6d).
// ===========================================================================

/// Selectable languages for the placement picker: ISO 639-1 code + display
/// name. Mirrors the common subset of `@sotto/shared` LANGUAGE_DISPLAY; the
/// placement route accepts any 2-letter code, so this is a convenience list.
pub(crate) const LANGUAGES: &[(&str, &str)] = &[
    ("en", "English"),
    ("es", "Spanish"),
    ("fr", "French"),
    ("de", "German"),
    ("pt", "Portuguese"),
    ("it", "Italian"),
    ("ja", "Japanese"),
    ("ko", "Korean"),
    ("zh", "Chinese"),
    ("ar", "Arabic"),
    ("hi", "Hindi"),
    ("ru", "Russian"),
    ("nl", "Dutch"),
    ("sv", "Swedish"),
    ("pl", "Polish"),
    ("tr", "Turkish"),
    ("uk", "Ukrainian"),
    ("el", "Greek"),
    ("vi", "Vietnamese"),
    ("id", "Indonesian"),
];

/// The display name for a language code (e.g. "en" -> "English"); falls back to
/// the uppercased code for an unknown one.
pub(crate) fn language_name(code: &str) -> String {
    LANGUAGES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, name)| (*name).to_string())
        .unwrap_or_else(|| code.to_uppercase())
}
