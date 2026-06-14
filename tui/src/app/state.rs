//! Pure view-state machine for the vocabulary spaced-repetition loop.
//!
//! This module owns the screen state and all the *pure* transitions between
//! screens: nothing here touches the network or the terminal. The async
//! [`crate::app::App`] event loop dispatches API calls and feeds their results
//! back in as [`crate::action::Action`]s, but the resulting state changes are
//! computed here so they can be unit-tested without a live server.
//!
//! View flow:
//!
//! ```text
//! Loading -> Courses(list) -> CourseHome { course, due, skill menu }
//!   -> (start vocab/grammar/reading) -> ItemReview { ... } -> Result { ... }
//!   -> (start listening) -> ListeningReview { ... } -> Result { ... }
//!   -> (start speaking)  -> SpeakingReview { ... }
//! ```

use crate::api::types;

/// A single multiple-choice vocabulary item the learner answers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VocabItem {
    pub id: String,
    pub prompt: String,
    pub options: Vec<String>,
}

impl From<&types::PracticeItem> for VocabItem {
    fn from(item: &types::PracticeItem) -> Self {
        Self {
            id: item.id.clone(),
            prompt: item.prompt.clone(),
            options: item.options.clone(),
        }
    }
}

/// Counts of items due for review on a course, plus the total tracked vocab.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DueCounts {
    pub vocab: u32,
    pub grammar: u32,
    pub total_vocab: u32,
}

impl From<&types::PracticeOverviewResponse> for DueCounts {
    fn from(overview: &types::PracticeOverviewResponse) -> Self {
        // The contract sends these as JSON numbers (f64 after progenitor); they
        // are non-negative counts, so clamp + truncate into a display-friendly
        // unsigned integer.
        Self {
            vocab: count(overview.due.vocab),
            grammar: count(overview.due.grammar),
            total_vocab: count(overview.total_vocab),
        }
    }
}

fn count(value: f64) -> u32 {
    if value.is_finite() && value > 0.0 {
        value as u32
    } else {
        0
    }
}

/// The course the learner has selected, reduced to what the screens render.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Course {
    pub id: String,
    pub title: String,
    pub native_lang: String,
    pub target_lang: String,
    pub current_level: String,
}

impl From<&types::CourseSummary> for Course {
    fn from(summary: &types::CourseSummary) -> Self {
        Self {
            id: summary.id.clone(),
            title: summary.curriculum.title.clone(),
            native_lang: summary.native_lang.clone(),
            target_lang: summary.target_lang.clone(),
            current_level: summary.current_level.to_string(),
        }
    }
}

/// Why a practice session could not be started right now (server-reported or
/// detected locally on ingestion).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Unavailable {
    NotEnoughVocab,
    NothingDue,
    NoContent,
    /// The server sent a `ready` shape we cannot present (empty items, or an
    /// item with no answer options). Detected locally; never trusted into a
    /// review, since a missing option would fabricate an answer.
    Malformed,
    /// A `ready` response for a skill the terminal does not handle yet (P6 adds
    /// grammar/reading/listening/speaking/writing). Carries the friendly skill
    /// name for the notice.
    NotInTerminal(&'static str),
}

impl Unavailable {
    pub fn message(&self) -> String {
        match self {
            Self::NotEnoughVocab => {
                "Not enough vocabulary yet — keep learning to unlock review.".to_string()
            }
            Self::NothingDue => {
                "Nothing is due for review right now. Check back later.".to_string()
            }
            Self::NoContent => "No review content is available for this course yet.".to_string(),
            Self::Malformed => {
                "This review came back malformed and was skipped to protect your answers."
                    .to_string()
            }
            Self::NotInTerminal(skill) => {
                format!("{skill} practice is not available in the terminal yet.")
            }
        }
    }
}

impl From<types::StartPracticeUnavailableReason> for Unavailable {
    fn from(reason: types::StartPracticeUnavailableReason) -> Self {
        match reason {
            types::StartPracticeUnavailableReason::NotEnoughVocab => Self::NotEnoughVocab,
            types::StartPracticeUnavailableReason::NothingDue => Self::NothingDue,
            types::StartPracticeUnavailableReason::NoContent => Self::NoContent,
        }
    }
}

/// Friendly skill name for a practice kind, used in notices.
fn skill_name(kind: types::PracticeKind) -> &'static str {
    match kind {
        types::PracticeKind::Vocab => "Vocabulary",
        types::PracticeKind::Grammar => "Grammar",
        types::PracticeKind::Reading => "Reading",
        types::PracticeKind::Listening => "Listening",
        types::PracticeKind::Speaking => "Speaking",
        types::PracticeKind::Writing => "Writing",
    }
}

/// What a persistent [`View::Error`] should retry when the learner presses `r`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum RetryKind {
    /// Re-run the initial course list fetch.
    Courses,
}

/// The skills the terminal can start from the CourseHome menu. Vocab/listening/
/// speaking landed in P4/P5; grammar/reading are wired in P6a. Writing still
/// routes to a "not in the terminal yet" notice via [`reduce_start`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SkillChoice {
    Vocab,
    Grammar,
    Reading,
    Listening,
    Speaking,
}

impl SkillChoice {
    /// Menu order, top to bottom.
    pub const MENU: [SkillChoice; 5] = [
        SkillChoice::Vocab,
        SkillChoice::Grammar,
        SkillChoice::Reading,
        SkillChoice::Listening,
        SkillChoice::Speaking,
    ];

    /// The practice kind to request when this skill is started.
    pub fn kind(self) -> types::PracticeKind {
        match self {
            SkillChoice::Vocab => types::PracticeKind::Vocab,
            SkillChoice::Grammar => types::PracticeKind::Grammar,
            SkillChoice::Reading => types::PracticeKind::Reading,
            SkillChoice::Listening => types::PracticeKind::Listening,
            SkillChoice::Speaking => types::PracticeKind::Speaking,
        }
    }

    /// Menu label.
    pub fn label(self) -> &'static str {
        match self {
            SkillChoice::Vocab => "Vocabulary review",
            SkillChoice::Grammar => "Grammar",
            SkillChoice::Reading => "Reading",
            SkillChoice::Listening => "Listening",
            SkillChoice::Speaking => "Speaking",
        }
    }
}

/// Which multiple-choice skill an [`View::ItemReview`] is running. VOCAB,
/// GRAMMAR, and READING share the same `{ sessionId, kind, items }` `ready`
/// shape and the same review screen; only the title differs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReviewKind {
    Vocab,
    Grammar,
    Reading,
}

impl ReviewKind {
    /// Title-bar label for the review screen.
    pub fn label(self) -> &'static str {
        match self {
            ReviewKind::Vocab => "vocab",
            ReviewKind::Grammar => "grammar",
            ReviewKind::Reading => "reading",
        }
    }

    /// Map a generated practice kind to a review kind, when it is one of the
    /// three multiple-choice review skills.
    pub fn from_kind(kind: types::PracticeKind) -> Option<Self> {
        match kind {
            types::PracticeKind::Vocab => Some(ReviewKind::Vocab),
            types::PracticeKind::Grammar => Some(ReviewKind::Grammar),
            types::PracticeKind::Reading => Some(ReviewKind::Reading),
            _ => None,
        }
    }
}

/// One ordered listening segment: speaker + text, with an optional playable URL.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ListeningSegment {
    pub speaker: String,
    pub text: String,
    pub audio_url: Option<String>,
}

impl From<&types::EpisodeSegment> for ListeningSegment {
    fn from(seg: &types::EpisodeSegment) -> Self {
        Self {
            speaker: seg.speaker.clone(),
            text: seg.text.clone(),
            audio_url: seg.audio_url.clone(),
        }
    }
}

/// The fetched episode for a listening session, reduced to what the screen
/// renders/plays. Segments are kept in the order the route returned them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct EpisodeDetail {
    pub id: String,
    pub title: String,
    pub status: String,
    /// Stitched full-episode audio, resolved to a playable URL when ready.
    pub audio_url: Option<String>,
    pub segments: Vec<ListeningSegment>,
}

impl From<&types::EpisodeDetailResponse> for EpisodeDetail {
    fn from(ep: &types::EpisodeDetailResponse) -> Self {
        Self {
            id: ep.id.clone(),
            title: ep.title.clone(),
            status: ep.status.to_string(),
            audio_url: ep.audio_url.clone(),
            segments: ep.segments.iter().map(ListeningSegment::from).collect(),
        }
    }
}

/// One speaking prompt the learner says aloud.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SpeakingPrompt {
    pub id: String,
    pub target_phrase: String,
    pub translation: String,
}

impl From<&types::PracticeSpeakingPrompt> for SpeakingPrompt {
    fn from(p: &types::PracticeSpeakingPrompt) -> Self {
        Self {
            id: p.id.clone(),
            target_phrase: p.target_phrase.clone(),
            translation: p.translation.clone(),
        }
    }
}

impl From<&types::ClassSpeakingPrompt> for SpeakingPrompt {
    fn from(p: &types::ClassSpeakingPrompt) -> Self {
        Self {
            id: p.id.clone(),
            target_phrase: p.target_phrase.clone(),
            translation: p.translation.clone(),
        }
    }
}

impl From<&types::ExamSpeakingPrompt> for SpeakingPrompt {
    fn from(p: &types::ExamSpeakingPrompt) -> Self {
        Self {
            id: p.id.clone(),
            target_phrase: p.target_phrase.clone(),
            translation: p.translation.clone(),
        }
    }
}

/// The grading lifecycle of the current speaking prompt's attempt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SpeakingPhase {
    /// No attempt yet (or moved to a fresh prompt); `r` starts recording.
    Idle,
    /// Microphone capture is live; `r`/enter stops and uploads.
    Recording,
    /// Upload in flight.
    Uploading,
    /// Grading poll loop in flight for `recording_id`.
    Polling { recording_id: String },
    /// Grading finished.
    Graded {
        score: Option<u32>,
        transcript: Option<String>,
        feedback: Option<String>,
    },
    /// Grading failed (server-reported FAILED or an error).
    Failed { message: String },
}

/// The score returned after submitting a completed review.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PracticeResult {
    pub score: u32,
    pub correct: u32,
    pub total: u32,
}

impl From<&types::SubmitPracticeResponse> for PracticeResult {
    fn from(resp: &types::SubmitPracticeResponse) -> Self {
        Self {
            score: count(resp.score),
            correct: count(resp.correct),
            total: count(resp.total),
        }
    }
}

// ===========================================================================
// Classes — the gated CEFR curriculum flow.
// ===========================================================================

/// A multiple-choice question inside a class section (grammar/reading/listening
/// comprehension). Same render/answer shape as a [`VocabItem`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClassQuestion {
    pub id: String,
    pub prompt: String,
    pub options: Vec<String>,
}

impl From<&types::ClassQuestion> for ClassQuestion {
    fn from(q: &types::ClassQuestion) -> Self {
        // READING passages arrive in `passage_text`; prepend so the learner
        // reads the passage above the question in one scrollable prompt.
        let prompt = match &q.passage_text {
            Some(p) if !p.is_empty() => format!("{p}\n\n{}", q.question),
            _ => q.question.clone(),
        };
        Self {
            id: q.id.clone(),
            prompt,
            options: q.options.clone(),
        }
    }
}

/// One class writing prompt the learner answers with free text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ClassWritingPrompt {
    pub id: String,
    pub task: String,
    pub guidance: Option<String>,
}

impl From<&types::ClassWritingPrompt> for ClassWritingPrompt {
    fn from(p: &types::ClassWritingPrompt) -> Self {
        Self {
            id: p.id.clone(),
            task: p.task.clone(),
            guidance: p.guidance.clone(),
        }
    }
}

/// A minimal multi-line text buffer for the writing section. In-house (no extra
/// dep): tracks lines + a cursor; the App feeds it characters/edits. Submission
/// joins the lines with `\n`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct WritingInput {
    /// Wrapped as lines; always at least one (possibly empty) line.
    lines: Vec<String>,
}

impl WritingInput {
    pub fn new() -> Self {
        Self {
            lines: vec![String::new()],
        }
    }

    /// Append a typed character to the last line.
    pub fn push_char(&mut self, c: char) {
        if self.lines.is_empty() {
            self.lines.push(String::new());
        }
        if let Some(last) = self.lines.last_mut() {
            last.push(c);
        }
    }

    /// Start a new line (Enter).
    pub fn newline(&mut self) {
        self.lines.push(String::new());
    }

    /// Delete the last character, joining lines when a line empties (Backspace).
    pub fn backspace(&mut self) {
        if let Some(last) = self.lines.last_mut()
            && last.pop().is_none()
            && self.lines.len() > 1
        {
            self.lines.pop();
        }
    }

    /// The composed text (lines joined by newlines).
    pub fn text(&self) -> String {
        self.lines.join("\n")
    }

    /// True when there is no non-whitespace content (cannot submit).
    pub fn is_empty(&self) -> bool {
        self.text().trim().is_empty()
    }

    /// The lines, for rendering.
    pub fn lines(&self) -> &[String] {
        &self.lines
    }
}

/// Lifecycle of a writing prompt's submission within a class section.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum WritingPhase {
    /// Composing the response; `enter` adds a newline, Ctrl-D submits.
    Editing,
    /// Submit in flight.
    Submitting,
    /// Graded; carries the 0..100 score and feedback.
    Graded { score: u32, feedback: String },
    /// Submission failed.
    Failed { message: String },
}

// ===========================================================================
// Adaptive-listening Q&A (P6e) — ask a contextual question during a listening
// lesson. The same `AskState` is carried by BOTH the standalone listening
// review and the in-class listening section, so the overlay + poll work in
// either context.
// ===========================================================================

/// The lifecycle of an "ask a question" interaction.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AskPhase {
    /// Composing the question; Enter adds a newline, Ctrl-D submits.
    Editing,
    /// The POST (which creates the interaction) is in flight.
    Asking,
    /// Polling the interaction until it is ANSWERED. Carries the id being polled
    /// so a late answer for a previous question is dropped on a fresh ask.
    Polling { interaction_id: String },
    /// The answer arrived (text; `answer_audio` is reserved for a future route
    /// field — the current Interaction model is text-only, so it is `None`).
    Answered {
        answer: String,
        answer_audio: Option<String>,
    },
    /// The ask failed or timed out (the interaction never reached ANSWERED).
    Failed { message: String },
}

/// The Q&A overlay state for a listening screen. `None` (via `AskState::closed`)
/// means the overlay is not open. Multiple questions per session work because
/// each ask resets the input + phase.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AskState {
    /// True while the overlay is open (editing/asking/polling/answered/failed).
    pub open: bool,
    /// The multi-line question buffer (reuses [`WritingInput`]).
    pub input: WritingInput,
    pub phase: AskPhase,
    /// How many poll attempts remain before timing out (no FAILED status exists
    /// server-side, so the client bounds the wait).
    pub polls_left: u32,
}

/// The maximum number of poll attempts (~1.5s each) before an ask times out.
pub(crate) const ASK_MAX_POLLS: u32 = 40;

impl AskState {
    /// The closed (overlay not shown) default.
    pub fn closed() -> Self {
        Self {
            open: false,
            input: WritingInput::new(),
            phase: AskPhase::Editing,
            polls_left: ASK_MAX_POLLS,
        }
    }

    /// Open the overlay with a fresh, empty question (used for each new ask).
    pub fn opened() -> Self {
        Self {
            open: true,
            input: WritingInput::new(),
            phase: AskPhase::Editing,
            polls_left: ASK_MAX_POLLS,
        }
    }
}

impl Default for AskState {
    fn default() -> Self {
        Self::closed()
    }
}

/// Map a polled interaction to the next ask phase: ANSWERED with a non-null
/// answer → `Answered`; any other status → keep `Polling` for the same id (the
/// caller schedules another poll). Pure — no network, no timers.
pub(crate) fn reduce_interaction_poll(
    interaction_id: &str,
    resp: &types::InteractionResponse,
) -> AskPhase {
    match resp.status {
        types::InteractionStatus::Answered
        | types::InteractionStatus::Resolved
        | types::InteractionStatus::Incorporating
        | types::InteractionStatus::Incorporated => match &resp.answer {
            Some(answer) if !answer.is_empty() => AskPhase::Answered {
                answer: answer.clone(),
                // The episode-interact route has no answer-audio field; reserved.
                answer_audio: None,
            },
            // Reached a terminal-ish status without an answer — surface it.
            _ => AskPhase::Failed {
                message: "No answer was produced for this question.".to_string(),
            },
        },
        // Still working (PENDING / ANSWERING): keep polling.
        types::InteractionStatus::Pending | types::InteractionStatus::Answering => {
            AskPhase::Polling {
                interaction_id: interaction_id.to_string(),
            }
        }
    }
}

/// Whether an ask phase is terminal (the poll loop should stop).
pub(crate) fn ask_is_terminal(phase: &AskPhase) -> bool {
    matches!(phase, AskPhase::Answered { .. } | AskPhase::Failed { .. })
}

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

/// The active screen and its state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum View {
    /// Initial course fetch in flight.
    Loading,
    /// A persistent failure screen that strands no other view: shows `message`
    /// and offers `r` to retry the `retry` action (and `q`/Esc to quit).
    Error { message: String, retry: RetryKind },
    /// The learner's courses, with a cursor for selection.
    Courses { courses: Vec<Course>, cursor: usize },
    /// A selected course: due counts plus a skill menu (vocab/listening/speaking).
    CourseHome {
        course: Course,
        due: DueCounts,
        /// Highlighted skill in the menu.
        menu_cursor: usize,
        /// Set when a start attempt came back `unavailable`/malformed.
        notice: Option<Unavailable>,
        /// True while a start request for this course is in flight; blocks a
        /// second start dispatch and shows a "starting…" hint.
        starting: bool,
    },
    /// An in-progress multiple-choice review (VOCAB / GRAMMAR / READING). All
    /// three share the same `{ sessionId, kind, items }` shape, this screen, and
    /// the submit flow; `kind` only changes the title. For READING the question
    /// text (with any passage baked in by the generator) lives in each item's
    /// `prompt`, which the screen wraps/scrolls for long content.
    ItemReview {
        course: Course,
        kind: ReviewKind,
        session_id: String,
        items: Vec<VocabItem>,
        /// Index of the item currently shown.
        index: usize,
        /// Highlighted option for the current item (keyboard cursor).
        cursor: usize,
        /// Recorded selection per item; `None` until the learner picks one.
        selected: Vec<Option<usize>>,
        /// Scroll offset (lines) into the current item's prompt, for long
        /// reading passages.
        prompt_scroll: u16,
        /// True while the final submit is in flight; blocks a second submit
        /// dispatch and shows a "submitting…" hint.
        submitting: bool,
    },
    /// An in-progress listening session: play the episode audio, read the
    /// transcript, and (when the session has comprehension items) answer them.
    ListeningReview {
        course: Course,
        session_id: String,
        episode_id: String,
        /// The fetched episode; `None` while the episode load is in flight.
        episode: Option<EpisodeDetail>,
        /// Comprehension items, if the session has any (else transcript-only).
        items: Vec<VocabItem>,
        index: usize,
        cursor: usize,
        selected: Vec<Option<usize>>,
        submitting: bool,
        /// Last play/pause status line shown to the learner.
        audio_note: Option<String>,
        /// "Ask a question" overlay state (P6e). Boxed to keep the enum
        /// variant size small.
        ask: Box<AskState>,
    },
    /// An in-progress speaking session: one prompt at a time, record → upload →
    /// poll grading → show score/feedback → next prompt.
    SpeakingReview {
        course: Course,
        session_id: String,
        prompts: Vec<SpeakingPrompt>,
        index: usize,
        phase: SpeakingPhase,
    },
    /// The graded outcome of a completed (vocab/listening) review.
    Result {
        course: Course,
        result: PracticeResult,
    },
    /// An in-progress gated class: walk `sections` in order, then submit.
    Class {
        course: Course,
        class_id: String,
        /// The fetched class sections; `None` while the class load is in flight.
        sections: Option<Vec<ClassSection>>,
        /// Index of the section currently shown.
        cursor: usize,
        /// True while the class MC submit is in flight.
        submitting: bool,
    },
    /// The graded outcome of a submitted class, with a "next class" option.
    ClassOutcome { course: Course, result: ClassResult },
    /// The course has no further classes (next-class returned `{ done: true }`).
    ClassDone { course: Course },
    /// An in-progress mock exam: walk `sections` in order, then submit + score.
    /// `exam_id` is `None` while the start request (which mints the id) is in
    /// flight; `sections` is `None` while the exam load is in flight.
    Exam {
        course: Course,
        exam_id: Option<String>,
        sections: Option<Vec<ClassSection>>,
        cursor: usize,
        /// True while the exam submit is in flight.
        submitting: bool,
    },
    /// The graded band/score outcome of a submitted exam.
    ExamOutcome { course: Course, result: ExamResult },

    // --- Placement / memory / settings (P6d) ---
    /// Pick the native + target languages before placement. Two columns; the
    /// focused one is `column`, with per-column cursors.
    PlacementLang {
        native_cursor: usize,
        target_cursor: usize,
        column: LangColumn,
        /// True while the placement-questions request is in flight.
        loading: bool,
    },
    /// Answer the generated placement MC questions (reuses the MC machinery).
    PlacementReview {
        native: String,
        target: String,
        questions: Vec<PlacementQuestion>,
        index: usize,
        cursor: usize,
        selected: Vec<Option<usize>>,
        prompt_scroll: u16,
        /// True while the placement submit is in flight.
        submitting: bool,
    },
    /// The assessed CEFR level + created course, before landing in the course.
    PlacementResult { outcome: PlacementOutcome },
    /// Read-only memory graph (vocab + grammar) for a course.
    Memory {
        course: Course,
        /// `None` while the graph load is in flight.
        items: Option<Vec<MemoryItem>>,
        /// Scroll offset into the list.
        scroll: usize,
    },
    /// Read-only instance/owner settings (onboarding config).
    Settings {
        /// `None` while the config load is in flight.
        config: Option<ConfigView>,
    },
}

impl View {
    /// Build a `Courses` view from generated course summaries.
    pub fn courses(summaries: &[types::CourseSummary]) -> Self {
        View::Courses {
            courses: summaries.iter().map(Course::from).collect(),
            cursor: 0,
        }
    }

    /// A fresh `CourseHome` for `course` with empty due counts.
    pub fn course_home(course: Course) -> Self {
        View::CourseHome {
            course,
            due: DueCounts::default(),
            menu_cursor: 0,
            notice: None,
            starting: false,
        }
    }

    /// Start a multiple-choice review (VOCAB / GRAMMAR / READING) from a
    /// validated `ready` response.
    pub fn start_items(
        course: Course,
        kind: ReviewKind,
        session_id: String,
        items: Vec<VocabItem>,
    ) -> Self {
        let selected = vec![None; items.len()];
        View::ItemReview {
            course,
            kind,
            session_id,
            items,
            index: 0,
            cursor: 0,
            selected,
            prompt_scroll: 0,
            submitting: false,
        }
    }

    /// Start a listening session from a `ready` (LISTENING) response. The
    /// episode is fetched separately; `episode` is `None` until it loads.
    pub fn start_listening(
        course: Course,
        session_id: String,
        episode_id: String,
        items: Vec<VocabItem>,
    ) -> Self {
        let selected = vec![None; items.len()];
        View::ListeningReview {
            course,
            session_id,
            episode_id,
            episode: None,
            items,
            index: 0,
            cursor: 0,
            selected,
            submitting: false,
            audio_note: None,
            ask: Box::new(AskState::closed()),
        }
    }

    /// Start a speaking session from a `ready_speaking` response.
    pub fn start_speaking(
        course: Course,
        session_id: String,
        prompts: Vec<SpeakingPrompt>,
    ) -> Self {
        View::SpeakingReview {
            course,
            session_id,
            prompts,
            index: 0,
            phase: SpeakingPhase::Idle,
        }
    }

    /// Enter a class: sections load separately, so `sections` is `None` here.
    pub fn class_view(course: Course, class_id: String) -> Self {
        View::Class {
            course,
            class_id,
            sections: None,
            cursor: 0,
            submitting: false,
        }
    }

    /// Enter the exam flow: the exam is being started (id minted server-side),
    /// so `exam_id` and `sections` are `None` until the start + load resolve.
    pub fn exam_view(course: Course) -> Self {
        View::Exam {
            course,
            exam_id: None,
            sections: None,
            cursor: 0,
            submitting: false,
        }
    }

    /// Enter the placement language picker (defaults: native English, target
    /// Spanish — the learner adjusts both).
    pub fn placement_lang() -> Self {
        View::PlacementLang {
            native_cursor: 0,
            target_cursor: 1,
            column: LangColumn::Native,
            loading: false,
        }
    }

    /// Begin a placement review from a validated question batch.
    pub fn placement_review(
        native: String,
        target: String,
        questions: Vec<PlacementQuestion>,
    ) -> Self {
        let selected = vec![None; questions.len()];
        View::PlacementReview {
            native,
            target,
            questions,
            index: 0,
            cursor: 0,
            selected,
            prompt_scroll: 0,
            submitting: false,
        }
    }
}

/// Collect the MC answers recorded across all class sections so far, ready for
/// the class submit. Only answered MC/listening-comprehension questions are
/// included (speaking/writing are graded via their own endpoints; the class
/// submit grades MC and aggregates the rest server-side). Pure.
pub(crate) fn collect_class_answers(
    sections: &[ClassSection],
) -> Vec<types::SubmitClassRequestAnswersItem> {
    let mut answers = Vec::new();
    for section in sections {
        let (questions, selected) = match &section.progress {
            SectionProgress::Mc {
                questions,
                selected,
                ..
            }
            | SectionProgress::Listening {
                questions,
                selected,
                ..
            } => (questions, selected),
            _ => continue,
        };
        for (q, choice) in questions.iter().zip(selected.iter()) {
            if let Some(idx) = choice {
                answers.push(types::SubmitClassRequestAnswersItem {
                    question_id: q.id.clone(),
                    selected_index: *idx as i64,
                });
            }
        }
    }
    answers
}

/// Collect the MC answers recorded across all EXAM sections, for the exam
/// submit. Like [`collect_class_answers`], but the exam item carries a validated
/// `question_id` newtype, so an answered question whose id the contract rejects
/// returns `Err` rather than being silently dropped (a partial payload would
/// misgrade the exam). Skipped (unanswered) questions are legitimately omitted.
pub(crate) fn collect_exam_answers(
    sections: &[ClassSection],
) -> Result<Vec<types::SubmitExamRequestAnswersItem>, String> {
    let mut answers = Vec::new();
    for section in sections {
        let (questions, selected) = match &section.progress {
            SectionProgress::Mc {
                questions,
                selected,
                ..
            }
            | SectionProgress::Listening {
                questions,
                selected,
                ..
            } => (questions, selected),
            _ => continue,
        };
        for (q, choice) in questions.iter().zip(selected.iter()) {
            if let Some(idx) = choice {
                let question_id =
                    types::SubmitExamRequestAnswersItemQuestionId::try_from(q.id.clone())
                        .map_err(|e| format!("invalid question id {:?}: {e}", q.id))?;
                answers.push(types::SubmitExamRequestAnswersItem {
                    question_id,
                    selected_index: *idx as i64,
                });
            }
        }
    }
    Ok(answers)
}

/// Whether every section of the class has been worked through to a submittable
/// state: MC/listening have an answer for every question, speaking has graded
/// (or failed) every prompt, writing has graded (or failed) every prompt. Pure;
/// drives whether the class can be submitted. Reused for exams.
pub(crate) fn class_ready_to_submit(sections: &[ClassSection]) -> bool {
    sections.iter().all(section_complete)
}

fn section_complete(section: &ClassSection) -> bool {
    match &section.progress {
        SectionProgress::Mc { selected, .. } | SectionProgress::Listening { selected, .. } => {
            selected.iter().all(Option::is_some)
        }
        // Speaking/writing are submittable only once their phase is terminal
        // (Graded or Failed). In-flight phases (Idle/Recording/Uploading/
        // Polling/Submitting/Editing) are NOT ready, so the class/exam can't be
        // submitted while a prompt is still being worked on.
        SectionProgress::Speaking { phase, .. } => {
            matches!(
                phase,
                SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. }
            )
        }
        SectionProgress::Writing { phase, .. } => {
            matches!(
                phase,
                WritingPhase::Graded { .. } | WritingPhase::Failed { .. }
            )
        }
    }
}

/// Reduce a start-practice response against the current `CourseHome` view.
///
/// Routing is kind-aware so each skill enters its own screen:
/// - `ready` `VOCAB`/`GRAMMAR`/`READING` with well-formed items → `ItemReview`
///   (one shared multiple-choice screen; the kind only changes the title).
/// - `ready` `LISTENING` with an `episodeId` → `ListeningReview` (items, if any,
///   must each have options; a zero-option item is `Malformed`).
/// - `ready_speaking` → `SpeakingReview` (must carry at least one prompt).
/// - `ready` `WRITING` → a "not available in the terminal yet" notice (P6b).
/// - `ready` that is empty/malformed for its skill → a `Malformed` notice; we
///   never enter a review we cannot present honestly.
/// - `unavailable` → the server's reason as a notice.
/// - `ready_writing` → a not-in-terminal notice.
///
/// In every non-review case the learner stays on `CourseHome` (the start
/// in-flight flag is cleared). If `view` is not a `CourseHome`, it is returned
/// unchanged (the learner navigated away before the response arrived).
pub(crate) fn reduce_start(view: View, resp: &types::StartPracticeResponse) -> View {
    let View::CourseHome { course, due, .. } = view else {
        return view;
    };

    match resp {
        types::StartPracticeResponse::Ready(ready) => match ReviewKind::from_kind(ready.kind) {
            // VOCAB / GRAMMAR / READING share the multiple-choice review screen.
            Some(review_kind) => match validate_choice_items(&ready.items) {
                Some(items) => {
                    View::start_items(course, review_kind, ready.session_id.clone(), items)
                }
                None => course_home_notice(course, due, Unavailable::Malformed),
            },
            None => match ready.kind {
                types::PracticeKind::Listening => reduce_listening(course, due, ready),
                other => {
                    course_home_notice(course, due, Unavailable::NotInTerminal(skill_name(other)))
                }
            },
        },
        types::StartPracticeResponse::ReadySpeaking(ready) => {
            if ready.prompts.is_empty() {
                course_home_notice(course, due, Unavailable::Malformed)
            } else {
                let prompts = ready.prompts.iter().map(SpeakingPrompt::from).collect();
                View::start_speaking(course, ready.session_id.clone(), prompts)
            }
        }
        types::StartPracticeResponse::Unavailable(unavailable) => {
            course_home_notice(course, due, Unavailable::from(unavailable.reason))
        }
        types::StartPracticeResponse::ReadyWriting(_) => course_home_notice(
            course,
            due,
            Unavailable::NotInTerminal(skill_name(types::PracticeKind::Writing)),
        ),
    }
}

/// Reduce a `ready` LISTENING response: requires an `episodeId` (else malformed)
/// and well-formed comprehension items if any are present (transcript-only
/// listening with zero items is valid).
fn reduce_listening(course: Course, due: DueCounts, ready: &types::StartPracticeReady) -> View {
    let Some(episode_id) = ready.episode_id.clone() else {
        return course_home_notice(course, due, Unavailable::Malformed);
    };
    // Items are optional for listening, but any present must be answerable.
    if ready.items.iter().any(|item| item.options.is_empty()) {
        return course_home_notice(course, due, Unavailable::Malformed);
    }
    let items = ready.items.iter().map(VocabItem::from).collect();
    View::start_listening(course, ready.session_id.clone(), episode_id, items)
}

/// Validate a multiple-choice payload before it becomes a review. Returns the
/// converted items only when the set is non-empty and every item has at least
/// one answer option; otherwise `None` (malformed). A zero-option item would
/// let Enter record a fabricated answer, so it is rejected here at ingestion.
fn validate_choice_items(items: &[types::PracticeItem]) -> Option<Vec<VocabItem>> {
    if items.is_empty() {
        return None;
    }
    if items.iter().any(|item| item.options.is_empty()) {
        return None;
    }
    Some(items.iter().map(VocabItem::from).collect())
}

fn course_home_notice(course: Course, due: DueCounts, reason: Unavailable) -> View {
    View::CourseHome {
        course,
        due,
        menu_cursor: 0,
        notice: Some(reason),
        starting: false,
    }
}

/// Map a speaking grading poll result to the next [`SpeakingPhase`]:
/// - `SCORED` → `Graded` with the (rounded percent) score, transcript, feedback.
/// - `FAILED` → `Failed`.
/// - `PENDING`/`GRADING` → still `Polling` for the same `recording_id` (the App
///   schedules another poll). Pure: no network, no timers.
pub(crate) fn reduce_speaking_poll(
    recording_id: &str,
    resp: &types::SpeakingPollResponse,
) -> SpeakingPhase {
    match resp.status {
        types::SpeakingGradeStatus::Scored => SpeakingPhase::Graded {
            // overallScore is 0..1; present it as a whole percentage.
            score: resp
                .overall_score
                .map(|s| (s.clamp(0.0, 1.0) * 100.0).round() as u32),
            transcript: resp.transcript.clone(),
            feedback: resp.feedback.clone(),
        },
        types::SpeakingGradeStatus::Failed => SpeakingPhase::Failed {
            message: "Grading failed for this attempt. Try recording again.".to_string(),
        },
        types::SpeakingGradeStatus::Pending | types::SpeakingGradeStatus::Grading => {
            SpeakingPhase::Polling {
                recording_id: recording_id.to_string(),
            }
        }
    }
}

/// Whether a poll result is terminal (grading reached a final state), so the App
/// can stop the poll loop.
pub(crate) fn poll_is_terminal(phase: &SpeakingPhase) -> bool {
    matches!(
        phase,
        SpeakingPhase::Graded { .. } | SpeakingPhase::Failed { .. }
    )
}

/// Whether a course's due counts allow starting a vocab review at all. We let
/// the learner attempt a review when there is due vocab *or* any tracked vocab
/// (the server decides for sure and may still answer `unavailable`).
pub(crate) fn can_review_vocab(due: &DueCounts) -> bool {
    due.vocab > 0 || due.total_vocab > 0
}

/// Outcome of recording an answer for the current vocab item.
///
/// Not `PartialEq`: the generated [`types::SubmitPracticeRequestAnswersItem`]
/// payload does not implement it. Tests match on the variant instead.
#[derive(Clone, Debug)]
pub(crate) enum AnswerStep {
    /// Advanced to the next item.
    Advanced,
    /// That was the last item; the caller should submit the built payload. The
    /// `Result` carries an error instead of a partial payload when any answer
    /// fails id validation, so a malformed id is surfaced rather than silently
    /// dropped.
    Submit(Result<Vec<types::SubmitPracticeRequestAnswersItem>, String>),
}

/// Move the option cursor up within the current item, saturating at 0.
pub(crate) fn cursor_up(cursor: usize) -> usize {
    cursor.saturating_sub(1)
}

/// Move the option cursor down within the current item, clamped to the last
/// option.
pub(crate) fn cursor_down(cursor: usize, option_count: usize) -> usize {
    let last = option_count.saturating_sub(1);
    (cursor + 1).min(last)
}

/// Move the list cursor up within `len` items, saturating at 0.
pub(crate) fn list_up(cursor: usize) -> usize {
    cursor.saturating_sub(1)
}

/// Move the list cursor down within `len` items, clamped to the last index.
pub(crate) fn list_down(cursor: usize, len: usize) -> usize {
    let last = len.saturating_sub(1);
    (cursor + 1).min(last)
}

/// Record `choice` for the item at `index`, advance to the next item, and
/// return whether more items remain or the answers are ready to submit.
///
/// `selected` is mutated in place; `index`/`cursor` are returned to the caller
/// so the view can update its own copies. The returned [`AnswerStep::Submit`]
/// payload is built from `items` + the just-updated `selected`, so callers do
/// not reconstruct it.
pub(crate) fn answer_current(
    items: &[VocabItem],
    selected: &mut [Option<usize>],
    index: usize,
    choice: usize,
) -> AnswerStep {
    if index < selected.len() {
        selected[index] = Some(choice);
    }

    if index + 1 < items.len() {
        AnswerStep::Advanced
    } else {
        AnswerStep::Submit(build_answers(items, selected))
    }
}

/// Record `choice` for the question at `index` and report whether it was the
/// last question (so the section is complete). Used by the class MC/listening
/// sections, whose answers are collected later by [`collect_class_answers`]
/// rather than built into a payload here. Pure.
/// `total` is the question count (the question type itself is irrelevant — only
/// the count matters), so class and placement MC reviews share this helper.
pub(crate) fn answer_current_choice(
    total: usize,
    selected: &mut [Option<usize>],
    index: usize,
    choice: usize,
) -> bool {
    if index < selected.len() {
        selected[index] = Some(choice);
    }
    index + 1 >= total
}

/// Build the `submit` request payload from items and their recorded selections.
///
/// Items the learner skipped (no recorded selection) are omitted — that is a
/// legitimate "no answer", not corruption. But if an *answered* item carries an
/// id the contract rejects, this returns `Err` rather than dropping it: a
/// partial payload would silently misgrade the session, so the caller surfaces
/// the error instead of submitting.
pub(crate) fn build_answers(
    items: &[VocabItem],
    selected: &[Option<usize>],
) -> Result<Vec<types::SubmitPracticeRequestAnswersItem>, String> {
    let mut answers = Vec::new();
    for (item, choice) in items.iter().zip(selected.iter()) {
        let Some(choice) = *choice else {
            continue;
        };
        let item_id = types::SubmitPracticeRequestAnswersItemItemId::try_from(item.id.clone())
            .map_err(|e| format!("invalid item id {:?}: {e}", item.id))?;
        answers.push(types::SubmitPracticeRequestAnswersItem {
            item_id,
            selected_index: choice as i64,
        });
    }
    Ok(answers)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, options: &[&str]) -> VocabItem {
        VocabItem {
            id: id.to_string(),
            prompt: format!("prompt for {id}"),
            options: options.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn course() -> Course {
        Course {
            id: "c1".into(),
            title: "Spanish".into(),
            native_lang: "en".into(),
            target_lang: "es".into(),
            current_level: "A2".into(),
        }
    }

    fn course_home() -> View {
        View::CourseHome {
            course: course(),
            due: DueCounts {
                vocab: 4,
                grammar: 0,
                total_vocab: 12,
            },
            menu_cursor: 0,
            notice: None,
            starting: false,
        }
    }

    /// Deserialize a `StartPracticeResponse` from JSON. The generated type is a
    /// `status`-discriminated union, so this exercises the real decoder rather
    /// than hand-constructing variants.
    fn start_response(json: serde_json::Value) -> types::StartPracticeResponse {
        serde_json::from_value(json).expect("valid StartPracticeResponse JSON")
    }

    #[test]
    fn answering_a_non_final_item_advances() {
        let items = vec![item("v1", &["a", "b"]), item("v2", &["c", "d"])];
        let mut selected = vec![None; items.len()];

        let step = answer_current(&items, &mut selected, 0, 1);

        assert!(matches!(step, AnswerStep::Advanced));
        assert_eq!(selected, vec![Some(1), None]);
    }

    #[test]
    fn answering_the_final_item_yields_a_submit_payload() {
        let items = vec![item("v1", &["a", "b"]), item("v2", &["c", "d"])];
        let mut selected = vec![Some(0), None];

        let step = answer_current(&items, &mut selected, 1, 1);

        match step {
            AnswerStep::Submit(Ok(answers)) => {
                assert_eq!(answers.len(), 2);
                assert_eq!(&*answers[0].item_id, "v1");
                assert_eq!(answers[0].selected_index, 0);
                assert_eq!(&*answers[1].item_id, "v2");
                assert_eq!(answers[1].selected_index, 1);
            }
            other => panic!("expected Submit(Ok), got {other:?}"),
        }
    }

    #[test]
    fn build_answers_skips_unanswered_items() {
        let items = vec![
            item("v1", &["a", "b"]),
            item("v2", &["c", "d"]),
            item("v3", &["e", "f"]),
        ];
        // Only the first and third items were answered.
        let selected = vec![Some(1), None, Some(0)];

        let answers = build_answers(&items, &selected).expect("valid ids");

        assert_eq!(answers.len(), 2);
        assert_eq!(&*answers[0].item_id, "v1");
        assert_eq!(answers[0].selected_index, 1);
        assert_eq!(&*answers[1].item_id, "v3");
        assert_eq!(answers[1].selected_index, 0);
    }

    #[test]
    fn build_answers_errors_on_an_answered_item_with_an_invalid_id() {
        // The id newtype rejects empty strings (minLength: 1). An *answered*
        // item with such an id must error, not be silently dropped.
        let items = vec![item("v1", &["a", "b"]), item("", &["c", "d"])];
        let selected = vec![Some(0), Some(1)];

        let result = build_answers(&items, &selected);

        assert!(result.is_err(), "expected an error, got {result:?}");
    }

    #[test]
    fn start_items_seeds_one_selection_slot_per_item() {
        let items = vec![item("v1", &["a", "b"]), item("v2", &["c", "d"])];

        let view = View::start_items(course(), ReviewKind::Vocab, "sess-1".into(), items.clone());

        match view {
            View::ItemReview {
                kind,
                index,
                cursor,
                prompt_scroll,
                selected,
                items: view_items,
                session_id,
                ..
            } => {
                assert_eq!(kind, ReviewKind::Vocab);
                assert_eq!(index, 0);
                assert_eq!(cursor, 0);
                assert_eq!(prompt_scroll, 0);
                assert_eq!(session_id, "sess-1");
                assert_eq!(view_items, items);
                assert_eq!(selected, vec![None, None]);
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn can_review_vocab_requires_due_or_tracked_vocab() {
        assert!(!can_review_vocab(&DueCounts::default()));
        assert!(can_review_vocab(&DueCounts {
            vocab: 3,
            grammar: 0,
            total_vocab: 0,
        }));
        assert!(can_review_vocab(&DueCounts {
            vocab: 0,
            grammar: 0,
            total_vocab: 10,
        }));
        // Grammar-only due does not enable the vocab review.
        assert!(!can_review_vocab(&DueCounts {
            vocab: 0,
            grammar: 5,
            total_vocab: 0,
        }));
    }

    #[test]
    fn unavailable_maps_reason_to_a_clear_message() {
        let cases = [
            (
                types::StartPracticeUnavailableReason::NotEnoughVocab,
                Unavailable::NotEnoughVocab,
            ),
            (
                types::StartPracticeUnavailableReason::NothingDue,
                Unavailable::NothingDue,
            ),
            (
                types::StartPracticeUnavailableReason::NoContent,
                Unavailable::NoContent,
            ),
        ];
        for (reason, expected) in cases {
            let mapped = Unavailable::from(reason);
            assert_eq!(mapped, expected);
            assert!(!mapped.message().is_empty());
        }
    }

    #[test]
    fn option_cursor_clamps_at_bounds() {
        assert_eq!(cursor_up(0), 0);
        assert_eq!(cursor_up(2), 1);
        assert_eq!(cursor_down(0, 3), 1);
        assert_eq!(cursor_down(2, 3), 2); // already at last option
        assert_eq!(cursor_down(0, 0), 0); // no options
    }

    #[test]
    fn list_cursor_clamps_at_bounds() {
        assert_eq!(list_up(0), 0);
        assert_eq!(list_up(2), 1);
        assert_eq!(list_down(0, 3), 1);
        assert_eq!(list_down(2, 3), 2);
        assert_eq!(list_down(0, 0), 0);
    }

    #[test]
    fn ready_start_response_enters_vocab_review() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-42",
            "kind": "VOCAB",
            "items": [
                { "id": "v1", "prompt": "casa", "options": ["house", "dog"] },
                { "id": "v2", "prompt": "perro", "options": ["cat", "dog"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ItemReview {
                kind,
                session_id,
                items,
                index,
                cursor,
                selected,
                ..
            } => {
                assert_eq!(kind, ReviewKind::Vocab);
                assert_eq!(session_id, "sess-42");
                assert_eq!(items.len(), 2);
                assert_eq!(items[0].prompt, "casa");
                assert_eq!(index, 0);
                assert_eq!(cursor, 0);
                assert_eq!(selected, vec![None, None]);
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn unavailable_start_response_stays_on_course_home_with_reason() {
        let resp = start_response(serde_json::json!({
            "status": "unavailable",
            "reason": "nothing_due"
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, due, .. } => {
                assert_eq!(notice, Some(Unavailable::NothingDue));
                // Due counts are preserved across the failed start.
                assert_eq!(due.vocab, 4);
                assert_eq!(due.total_vocab, 12);
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn empty_ready_start_response_is_treated_as_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-empty",
            "kind": "VOCAB",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn ready_with_a_zero_option_item_is_rejected_as_malformed() {
        // A zero-option item would let Enter fabricate an answer; reject it at
        // ingestion instead of entering the review.
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-bad",
            "kind": "VOCAB",
            "items": [
                { "id": "v1", "prompt": "casa", "options": ["house", "dog"] },
                { "id": "v2", "prompt": "perro", "options": [] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn unhandled_ready_kind_routes_to_not_in_terminal_notice_not_review() {
        // VOCAB/GRAMMAR/READING -> ItemReview and LISTENING -> ListeningReview;
        // any other kind arriving as a plain `ready` (defensive — WRITING comes
        // via ready_writing) stays on CourseHome with a clear notice rather than
        // entering a review.
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-writing",
            "kind": "WRITING",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => match notice {
                Some(Unavailable::NotInTerminal(skill)) => assert_eq!(skill, "Writing"),
                other => panic!("expected NotInTerminal notice, got {other:?}"),
            },
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn start_response_is_ignored_when_not_on_course_home() {
        // The learner navigated to the course list before the response landed.
        let view = View::courses(&[]);
        let resp = start_response(serde_json::json!({
            "status": "unavailable",
            "reason": "no_content"
        }));

        let next = reduce_start(view.clone(), &resp);

        assert_eq!(next, view);
    }

    fn poll_response(json: serde_json::Value) -> types::SpeakingPollResponse {
        serde_json::from_value(json).expect("valid SpeakingPollResponse JSON")
    }

    #[test]
    fn listening_ready_enters_listening_review_with_episode_id() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-listen",
            "kind": "LISTENING",
            "episodeId": "ep-1",
            "items": [
                { "id": "q1", "prompt": "What did they order?", "options": ["café", "té"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ListeningReview {
                session_id,
                episode_id,
                episode,
                items,
                selected,
                ..
            } => {
                assert_eq!(session_id, "sess-listen");
                assert_eq!(episode_id, "ep-1");
                assert!(episode.is_none(), "episode loads separately");
                assert_eq!(items.len(), 1);
                assert_eq!(selected, vec![None]);
            }
            other => panic!("expected ListeningReview, got {other:?}"),
        }
    }

    #[test]
    fn listening_ready_with_no_episode_id_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-listen",
            "kind": "LISTENING",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn listening_transcript_only_with_no_items_is_allowed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-listen",
            "kind": "LISTENING",
            "episodeId": "ep-2",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ListeningReview { items, .. } => assert!(items.is_empty()),
            other => panic!("expected ListeningReview, got {other:?}"),
        }
    }

    #[test]
    fn speaking_ready_enters_speaking_review_idle() {
        let resp = start_response(serde_json::json!({
            "status": "ready_speaking",
            "sessionId": "sess-speak",
            "prompts": [
                {
                    "id": "p1",
                    "targetPhrase": "Buenos días",
                    "translation": "Good morning",
                    "referenceTtsUrl": null
                }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::SpeakingReview {
                session_id,
                prompts,
                index,
                phase,
                ..
            } => {
                assert_eq!(session_id, "sess-speak");
                assert_eq!(prompts.len(), 1);
                assert_eq!(prompts[0].target_phrase, "Buenos días");
                assert_eq!(index, 0);
                assert_eq!(phase, SpeakingPhase::Idle);
            }
            other => panic!("expected SpeakingReview, got {other:?}"),
        }
    }

    #[test]
    fn empty_speaking_ready_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready_speaking",
            "sessionId": "sess-speak",
            "prompts": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => {
                assert_eq!(notice, Some(Unavailable::Malformed));
            }
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn writing_ready_routes_to_not_in_terminal() {
        let resp = start_response(serde_json::json!({
            "status": "ready_writing",
            "sessionId": "sess-write",
            "prompts": [{ "id": "w1", "task": "Describe your day", "guidance": null }]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => match notice {
                Some(Unavailable::NotInTerminal(skill)) => assert_eq!(skill, "Writing"),
                other => panic!("expected NotInTerminal, got {other:?}"),
            },
            other => panic!("expected CourseHome, got {other:?}"),
        }
    }

    #[test]
    fn speaking_poll_pending_stays_polling() {
        let resp = poll_response(serde_json::json!({
            "status": "PENDING",
            "overallScore": null,
            "transcript": null,
            "feedback": null
        }));

        let phase = reduce_speaking_poll("rec-1", &resp);

        assert_eq!(
            phase,
            SpeakingPhase::Polling {
                recording_id: "rec-1".into()
            }
        );
        assert!(!poll_is_terminal(&phase));
    }

    #[test]
    fn speaking_poll_scored_becomes_graded_percent() {
        let resp = poll_response(serde_json::json!({
            "status": "SCORED",
            "overallScore": 0.834,
            "transcript": "Buenos días",
            "feedback": "Nice rhythm."
        }));

        let phase = reduce_speaking_poll("rec-1", &resp);

        match &phase {
            SpeakingPhase::Graded {
                score,
                transcript,
                feedback,
            } => {
                assert_eq!(*score, Some(83), "0.834 -> 83%");
                assert_eq!(transcript.as_deref(), Some("Buenos días"));
                assert_eq!(feedback.as_deref(), Some("Nice rhythm."));
            }
            other => panic!("expected Graded, got {other:?}"),
        }
        assert!(poll_is_terminal(&phase));
    }

    #[test]
    fn speaking_poll_failed_becomes_failed() {
        let resp = poll_response(serde_json::json!({
            "status": "FAILED",
            "overallScore": null,
            "transcript": null,
            "feedback": null
        }));

        let phase = reduce_speaking_poll("rec-1", &resp);

        assert!(matches!(phase, SpeakingPhase::Failed { .. }));
        assert!(poll_is_terminal(&phase));
    }

    // --- P6a: grammar + reading multiple-choice review --------------------

    #[test]
    fn grammar_ready_enters_item_review_with_grammar_kind() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-gram",
            "kind": "GRAMMAR",
            "items": [
                { "id": "q0", "prompt": "Choose the correct article", "options": ["el", "la"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ItemReview {
                kind,
                session_id,
                items,
                prompt_scroll,
                ..
            } => {
                assert_eq!(kind, ReviewKind::Grammar);
                assert_eq!(session_id, "sess-gram");
                assert_eq!(items.len(), 1);
                assert_eq!(prompt_scroll, 0);
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn reading_ready_enters_item_review_and_keeps_the_passage_prompt() {
        // READING folds the passage into each question's prompt (the route does
        // not surface a separate passage field); the long prompt must survive.
        let passage = "El gato se sentó en la alfombra. ".repeat(20);
        let prompt = format!("{passage}\n\nWhat sat on the rug?");
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-read",
            "kind": "READING",
            "items": [
                { "id": "q0", "prompt": prompt, "options": ["el gato", "el perro"] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::ItemReview { kind, items, .. } => {
                assert_eq!(kind, ReviewKind::Reading);
                // The full passage text is preserved in the item prompt.
                assert!(items[0].prompt.contains("alfombra"));
                assert!(items[0].prompt.contains("What sat on the rug?"));
            }
            other => panic!("expected ItemReview, got {other:?}"),
        }
    }

    #[test]
    fn grammar_ready_with_a_zero_option_item_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-gram",
            "kind": "GRAMMAR",
            "items": [
                { "id": "q0", "prompt": "ok", "options": ["a", "b"] },
                { "id": "q1", "prompt": "broken", "options": [] }
            ]
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => assert_eq!(notice, Some(Unavailable::Malformed)),
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn empty_grammar_ready_is_malformed() {
        let resp = start_response(serde_json::json!({
            "status": "ready",
            "sessionId": "sess-gram",
            "kind": "GRAMMAR",
            "items": []
        }));

        let next = reduce_start(course_home(), &resp);

        match next {
            View::CourseHome { notice, .. } => assert_eq!(notice, Some(Unavailable::Malformed)),
            other => panic!("expected CourseHome (malformed), got {other:?}"),
        }
    }

    #[test]
    fn submitting_a_reading_session_builds_the_answer_payload() {
        // A grammar/reading session submits via the same answer flow as vocab:
        // answering the last item yields the submit payload from selections.
        let items = vec![item("q0", &["a", "b"]), item("q1", &["c", "d"])];
        let mut selected = vec![Some(0), None];

        let step = answer_current(&items, &mut selected, 1, 1);

        match step {
            AnswerStep::Submit(Ok(answers)) => {
                assert_eq!(answers.len(), 2);
                assert_eq!(&*answers[0].item_id, "q0");
                assert_eq!(answers[0].selected_index, 0);
                assert_eq!(&*answers[1].item_id, "q1");
                assert_eq!(answers[1].selected_index, 1);
            }
            other => panic!("expected Submit(Ok), got {other:?}"),
        }
    }

    #[test]
    fn skill_choice_kinds_map_to_practice_kinds() {
        assert_eq!(SkillChoice::Grammar.kind(), types::PracticeKind::Grammar);
        assert_eq!(SkillChoice::Reading.kind(), types::PracticeKind::Reading);
        // Grammar + Reading are now wired into the menu (5 entries).
        assert_eq!(SkillChoice::MENU.len(), 5);
        assert!(SkillChoice::MENU.contains(&SkillChoice::Grammar));
        assert!(SkillChoice::MENU.contains(&SkillChoice::Reading));
    }

    // --- P6b: classes ------------------------------------------------------

    fn class_response(json: serde_json::Value) -> types::ClassDetailResponse {
        serde_json::from_value(json).expect("valid ClassDetailResponse JSON")
    }

    /// A class with one section of each kind, in a fixed order, for walk tests.
    fn mixed_class() -> types::ClassDetailResponse {
        class_response(serde_json::json!({
            "id": "cls1",
            "status": "IN_PROGRESS",
            "order": 1,
            "passThreshold": 0.7,
            "submitted": false,
            "sections": [
                {
                    "id": "sec-g", "skill": "GRAMMAR", "status": "READY",
                    "episode": null, "prompts": [], "writingPrompts": [],
                    "questions": [
                        { "id": "g0", "order": 0, "question": "Article?", "options": ["el", "la"], "passageRef": null, "passageText": null }
                    ]
                },
                {
                    "id": "sec-r", "skill": "READING", "status": "READY",
                    "episode": null, "prompts": [], "writingPrompts": [],
                    "questions": [
                        { "id": "r0", "order": 0, "question": "What?", "options": ["a", "b"], "passageRef": null, "passageText": "Long passage here." }
                    ]
                },
                {
                    "id": "sec-l", "skill": "LISTENING", "status": "READY",
                    "episode": { "id": "ep1", "audioUrl": "https://cdn/ep1.mp3", "title": "Cafe", "references": [] },
                    "prompts": [], "writingPrompts": [],
                    "questions": [
                        { "id": "l0", "order": 0, "question": "Heard?", "options": ["x", "y"], "passageRef": null, "passageText": null }
                    ]
                },
                {
                    "id": "sec-s", "skill": "SPEAKING", "status": "READY",
                    "episode": null, "questions": [], "writingPrompts": [],
                    "prompts": [
                        { "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "ipa": null, "referenceTtsUrl": null }
                    ]
                },
                {
                    "id": "sec-w", "skill": "WRITING", "status": "READY",
                    "episode": null, "questions": [], "prompts": [],
                    "writingPrompts": [
                        { "id": "w0", "order": 0, "task": "Describe", "guidance": null, "response": null }
                    ]
                }
            ]
        }))
    }

    #[test]
    fn class_sections_walk_in_route_order_with_kind_routing() {
        let sections = class_sections(&mixed_class()).expect("well-formed class");
        assert_eq!(sections.len(), 5);
        // Order preserved.
        let ids: Vec<&str> = sections.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["sec-g", "sec-r", "sec-l", "sec-s", "sec-w"]);
        // Each section routed to the right progress variant by skill.
        assert!(matches!(sections[0].progress, SectionProgress::Mc { .. }));
        assert!(matches!(sections[1].progress, SectionProgress::Mc { .. }));
        assert!(matches!(
            sections[2].progress,
            SectionProgress::Listening { .. }
        ));
        assert!(matches!(
            sections[3].progress,
            SectionProgress::Speaking { .. }
        ));
        assert!(matches!(
            sections[4].progress,
            SectionProgress::Writing { .. }
        ));
    }

    #[test]
    fn reading_section_prepends_the_passage_to_the_prompt() {
        let sections = class_sections(&mixed_class()).expect("well-formed");
        if let SectionProgress::Mc { questions, .. } = &sections[1].progress {
            assert!(questions[0].prompt.contains("Long passage here."));
            assert!(questions[0].prompt.contains("What?"));
        } else {
            panic!("reading section should be Mc");
        }
    }

    #[test]
    fn empty_class_is_malformed() {
        let cls = class_response(serde_json::json!({
            "id": "c", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn class_with_a_zero_option_question_is_malformed() {
        let cls = class_response(serde_json::json!({
            "id": "c", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false,
            "sections": [{
                "id": "sec-g", "skill": "GRAMMAR", "status": "READY",
                "episode": null, "prompts": [], "writingPrompts": [],
                "questions": [
                    { "id": "g0", "order": 0, "question": "ok", "options": ["a", "b"], "passageRef": null, "passageText": null },
                    { "id": "g1", "order": 1, "question": "broken", "options": [], "passageRef": null, "passageText": null }
                ]
            }]
        }));
        assert!(class_sections(&cls).is_none());
    }

    /// A one-section class with the given skill and content overrides, for
    /// per-skill emptiness checks.
    fn single_section_class(section: serde_json::Value) -> types::ClassDetailResponse {
        class_response(serde_json::json!({
            "id": "c", "status": "IN_PROGRESS", "order": 1, "passThreshold": 0.7,
            "submitted": false, "sections": [section]
        }))
    }

    #[test]
    fn empty_grammar_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-g", "skill": "GRAMMAR", "status": "READY",
            "episode": null, "prompts": [], "writingPrompts": [], "questions": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn empty_reading_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-r", "skill": "READING", "status": "READY",
            "episode": null, "prompts": [], "writingPrompts": [], "questions": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn listening_section_without_an_episode_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-l", "skill": "LISTENING", "status": "READY",
            "episode": null, "prompts": [], "writingPrompts": [], "questions": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn listening_section_with_episode_and_no_questions_is_valid_transcript_only() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-l", "skill": "LISTENING", "status": "READY",
            "episode": { "id": "ep1", "audioUrl": "https://cdn/ep1.mp3", "title": "Cafe", "references": [] },
            "prompts": [], "writingPrompts": [], "questions": []
        }));
        let sections = class_sections(&cls).expect("transcript-only listening is valid");
        assert!(matches!(
            sections[0].progress,
            SectionProgress::Listening { .. }
        ));
    }

    #[test]
    fn empty_speaking_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-s", "skill": "SPEAKING", "status": "READY",
            "episode": null, "questions": [], "writingPrompts": [], "prompts": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn empty_writing_section_is_malformed() {
        let cls = single_section_class(serde_json::json!({
            "id": "sec-w", "skill": "WRITING", "status": "READY",
            "episode": null, "questions": [], "prompts": [], "writingPrompts": []
        }));
        assert!(class_sections(&cls).is_none());
    }

    #[test]
    fn collect_class_answers_aggregates_answered_mc_across_sections() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        // Answer the grammar (g0 -> 1), reading (r0 -> 0), and listening (l0 -> 1)
        // MC questions; speaking/writing contribute nothing to the MC payload.
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Mc { selected, .. }
                | SectionProgress::Listening { selected, .. } => {
                    selected[0] = Some(if s.id == "sec-r" { 0 } else { 1 });
                }
                _ => {}
            }
        }
        let answers = collect_class_answers(&sections);
        assert_eq!(answers.len(), 3);
        let by_id: std::collections::HashMap<_, _> = answers
            .iter()
            .map(|a| (a.question_id.clone(), a.selected_index))
            .collect();
        assert_eq!(by_id.get("g0"), Some(&1));
        assert_eq!(by_id.get("r0"), Some(&0));
        assert_eq!(by_id.get("l0"), Some(&1));
    }

    /// Answer every MC/listening question in `sections` (drive them to complete).
    fn answer_all_mc(sections: &mut [ClassSection]) {
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Mc { selected, .. }
                | SectionProgress::Listening { selected, .. } => {
                    for slot in selected.iter_mut() {
                        *slot = Some(0);
                    }
                }
                _ => {}
            }
        }
    }

    #[test]
    fn class_ready_to_submit_requires_every_section_terminal() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        // Unanswered MC -> not ready.
        assert!(!class_ready_to_submit(&sections));

        // Answer every MC/listening question. Speaking/writing are still in
        // their initial (Idle/Editing) phases, so the class is NOT yet ready —
        // the learner must work each prompt to a graded/failed state first.
        answer_all_mc(&mut sections);
        assert!(
            !class_ready_to_submit(&sections),
            "MC answered but speaking/writing still in flight -> not ready"
        );

        // Drive speaking + writing to a terminal phase.
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Speaking { phase, .. } => {
                    *phase = SpeakingPhase::Graded {
                        score: Some(80),
                        transcript: Some("ok".into()),
                        feedback: Some("good".into()),
                    };
                }
                SectionProgress::Writing { phase, .. } => {
                    *phase = WritingPhase::Graded {
                        score: 75,
                        feedback: "nice".into(),
                    };
                }
                _ => {}
            }
        }
        assert!(
            class_ready_to_submit(&sections),
            "every section terminal -> ready"
        );
    }

    #[test]
    fn speaking_section_is_not_ready_until_terminal() {
        // A class with a speaking section: in-flight phases are not submittable;
        // only Graded/Failed are.
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        answer_all_mc(&mut sections);
        // Drive writing terminal so only the speaking phase is under test.
        for s in sections.iter_mut() {
            if let SectionProgress::Writing { phase, .. } = &mut s.progress {
                *phase = WritingPhase::Failed {
                    message: "x".into(),
                };
            }
        }

        let set_speaking = |sections: &mut [ClassSection], p: SpeakingPhase| {
            for s in sections.iter_mut() {
                if let SectionProgress::Speaking { phase, .. } = &mut s.progress {
                    *phase = p.clone();
                }
            }
        };

        for not_ready in [
            SpeakingPhase::Idle,
            SpeakingPhase::Recording,
            SpeakingPhase::Uploading,
            SpeakingPhase::Polling {
                recording_id: "r".into(),
            },
        ] {
            set_speaking(&mut sections, not_ready.clone());
            assert!(
                !class_ready_to_submit(&sections),
                "speaking phase {not_ready:?} must not be submittable",
            );
        }
        for ready in [
            SpeakingPhase::Graded {
                score: Some(90),
                transcript: Some("t".into()),
                feedback: Some("f".into()),
            },
            SpeakingPhase::Failed {
                message: "m".into(),
            },
        ] {
            set_speaking(&mut sections, ready.clone());
            assert!(
                class_ready_to_submit(&sections),
                "speaking phase {ready:?} is terminal -> submittable",
            );
        }
    }

    #[test]
    fn writing_section_is_not_ready_until_terminal() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        answer_all_mc(&mut sections);
        // Drive speaking terminal so only the writing phase is under test.
        for s in sections.iter_mut() {
            if let SectionProgress::Speaking { phase, .. } = &mut s.progress {
                *phase = SpeakingPhase::Failed {
                    message: "x".into(),
                };
            }
        }

        let set_writing = |sections: &mut [ClassSection], p: WritingPhase| {
            for s in sections.iter_mut() {
                if let SectionProgress::Writing { phase, .. } = &mut s.progress {
                    *phase = p.clone();
                }
            }
        };

        for not_ready in [WritingPhase::Editing, WritingPhase::Submitting] {
            set_writing(&mut sections, not_ready.clone());
            assert!(
                !class_ready_to_submit(&sections),
                "writing phase {not_ready:?} must not be submittable",
            );
        }
        for ready in [
            WritingPhase::Graded {
                score: 70,
                feedback: "f".into(),
            },
            WritingPhase::Failed {
                message: "m".into(),
            },
        ] {
            set_writing(&mut sections, ready.clone());
            assert!(
                class_ready_to_submit(&sections),
                "writing phase {ready:?} is terminal -> submittable",
            );
        }
    }

    #[test]
    fn answer_current_choice_records_and_flags_the_last_question() {
        // Two questions: answering index 0 is not the last; index 1 is.
        let mut selected = vec![None, None];
        assert!(!answer_current_choice(2, &mut selected, 0, 1));
        assert_eq!(selected, vec![Some(1), None]);
        assert!(answer_current_choice(2, &mut selected, 1, 0));
        assert_eq!(selected, vec![Some(1), Some(0)]);
    }

    #[test]
    fn class_result_converts_score_to_percent() {
        let resp: types::SubmitClassResponse = serde_json::from_value(serde_json::json!({
            "passed": true, "overallScore": 0.8, "passedSections": 4, "totalSections": 5,
            "sections": []
        }))
        .expect("valid");
        let result = ClassResult::from(&resp);
        assert!(result.passed);
        assert_eq!(result.overall_score, 80);
        assert_eq!(result.passed_sections, 4);
        assert_eq!(result.total_sections, 5);
    }

    #[test]
    fn writing_input_captures_lines_and_backspace() {
        let mut input = WritingInput::new();
        for c in "hola".chars() {
            input.push_char(c);
        }
        input.newline();
        for c in "mundo".chars() {
            input.push_char(c);
        }
        assert_eq!(input.text(), "hola\nmundo");
        assert!(!input.is_empty());
        // Backspace within a line, then across the line boundary.
        input.backspace(); // mund
        assert_eq!(input.text(), "hola\nmund");
        for _ in 0..4 {
            input.backspace();
        }
        // The now-empty second line is removed on the next backspace.
        input.backspace();
        assert_eq!(input.text(), "hola");
    }

    #[test]
    fn empty_writing_input_is_empty() {
        let input = WritingInput::new();
        assert!(input.is_empty());
        assert_eq!(input.text(), "");
    }

    // --- P6c: exams --------------------------------------------------------

    fn exam_response(json: serde_json::Value) -> types::ExamDetailResponse {
        serde_json::from_value(json).expect("valid ExamDetailResponse JSON")
    }

    /// An exam with one section of each kind, in a fixed order.
    fn mixed_exam() -> types::ExamDetailResponse {
        exam_response(serde_json::json!({
            "id": "exam1", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "Mock B1", "result": null,
            "sections": [
                { "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 0.25, "status": "READY", "score": null,
                  "episode": null, "speakingPrompts": [], "writingPrompts": [],
                  "questions": [{ "id": "g0", "order": 0, "question": "Article?", "options": ["el","la"], "passageRef": null, "passageText": null }] },
                { "id": "ex-r", "skill": "READING", "part": "P2", "order": 1, "format": "mc", "weight": 0.25, "status": "READY", "score": null,
                  "episode": null, "speakingPrompts": [], "writingPrompts": [],
                  "questions": [{ "id": "r0", "order": 0, "question": "What?", "options": ["a","b"], "passageRef": null, "passageText": "Passage." }] },
                { "id": "ex-l", "skill": "LISTENING", "part": "P3", "order": 2, "format": "mc", "weight": 0.2, "status": "READY", "score": null,
                  "episode": { "id": "ep1", "audioUrl": "https://cdn/ep1.mp3", "status": "READY" },
                  "speakingPrompts": [], "writingPrompts": [],
                  "questions": [{ "id": "l0", "order": 0, "question": "Heard?", "options": ["x","y"], "passageRef": null, "passageText": null }] },
                { "id": "ex-s", "skill": "SPEAKING", "part": "P4", "order": 3, "format": "oral", "weight": 0.15, "status": "READY", "score": null,
                  "episode": null, "questions": [], "writingPrompts": [],
                  "speakingPrompts": [{ "id": "s0", "order": 0, "targetPhrase": "Hola", "translation": "Hi", "referenceTtsUrl": null }] },
                { "id": "ex-w", "skill": "WRITING", "part": "P5", "order": 4, "format": "essay", "weight": 0.15, "status": "READY", "score": null,
                  "episode": null, "questions": [], "speakingPrompts": [],
                  "writingPrompts": [{ "id": "w0", "order": 0, "task": "Describe", "guidance": null }] }
            ]
        }))
    }

    #[test]
    fn exam_sections_walk_in_order_with_kind_routing() {
        let sections = exam_sections(&mixed_exam()).expect("well-formed exam");
        assert_eq!(sections.len(), 5);
        let ids: Vec<&str> = sections.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["ex-g", "ex-r", "ex-l", "ex-s", "ex-w"]);
        assert!(matches!(sections[0].progress, SectionProgress::Mc { .. }));
        assert!(matches!(sections[1].progress, SectionProgress::Mc { .. }));
        assert!(matches!(
            sections[2].progress,
            SectionProgress::Listening { .. }
        ));
        assert!(matches!(
            sections[3].progress,
            SectionProgress::Speaking { .. }
        ));
        assert!(matches!(
            sections[4].progress,
            SectionProgress::Writing { .. }
        ));
    }

    #[test]
    fn empty_exam_is_malformed() {
        let exam = exam_response(serde_json::json!({
            "id": "e", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "M", "result": null, "sections": []
        }));
        assert!(exam_sections(&exam).is_none());
    }

    #[test]
    fn exam_section_with_a_zero_option_question_is_malformed() {
        let exam = exam_response(serde_json::json!({
            "id": "e", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "M", "result": null,
            "sections": [{
                "id": "ex-g", "skill": "GRAMMAR", "part": "P1", "order": 0, "format": "mc", "weight": 1.0, "status": "READY", "score": null,
                "episode": null, "speakingPrompts": [], "writingPrompts": [],
                "questions": [{ "id": "g0", "order": 0, "question": "broken", "options": [], "passageRef": null, "passageText": null }]
            }]
        }));
        assert!(exam_sections(&exam).is_none());
    }

    #[test]
    fn empty_speaking_exam_section_is_malformed() {
        let exam = exam_response(serde_json::json!({
            "id": "e", "institution": "CEFR_GENERIC", "institutionLabel": "CEFR",
            "level": "B1", "status": "IN_PROGRESS", "examName": "M", "result": null,
            "sections": [{
                "id": "ex-s", "skill": "SPEAKING", "part": "P4", "order": 0, "format": "oral", "weight": 1.0, "status": "READY", "score": null,
                "episode": null, "questions": [], "writingPrompts": [], "speakingPrompts": []
            }]
        }));
        assert!(exam_sections(&exam).is_none());
    }

    #[test]
    fn collect_exam_answers_aggregates_answered_mc_across_sections() {
        let mut sections = exam_sections(&mixed_exam()).expect("well-formed");
        for s in sections.iter_mut() {
            match &mut s.progress {
                SectionProgress::Mc { selected, .. }
                | SectionProgress::Listening { selected, .. } => {
                    selected[0] = Some(if s.id == "ex-r" { 1 } else { 0 });
                }
                _ => {}
            }
        }
        let answers = collect_exam_answers(&sections).expect("valid ids");
        assert_eq!(answers.len(), 3);
        let by_id: std::collections::HashMap<_, _> = answers
            .iter()
            .map(|a| ((*a.question_id).clone(), a.selected_index))
            .collect();
        assert_eq!(by_id.get("g0"), Some(&0));
        assert_eq!(by_id.get("r0"), Some(&1));
        assert_eq!(by_id.get("l0"), Some(&0));
    }

    #[test]
    fn exam_result_converts_band_and_percent() {
        let resp: types::SubmitExamResponse = serde_json::from_value(serde_json::json!({
            "overallScore": 0.72, "band": "B2", "feedback": "Solid.",
            "sections": [
                { "sectionId": "ex-g", "skill": "GRAMMAR", "weight": 0.5, "score": 0.8 },
                { "sectionId": "ex-r", "skill": "READING", "weight": 0.5, "score": 0.6 }
            ]
        }))
        .expect("valid");
        let result = ExamResult::from(&resp);
        assert_eq!(result.overall_score, 72);
        assert_eq!(result.band, "B2");
        assert_eq!(result.feedback, "Solid.");
        assert_eq!(result.sections.len(), 2);
        assert_eq!(result.sections[0].skill, "GRAMMAR");
        assert_eq!(result.sections[0].score, 80);
        assert_eq!(result.sections[1].score, 60);
    }

    // --- P6d: placement / memory / settings --------------------------------

    fn placement_response(json: serde_json::Value) -> types::GeneratePlacementResponse {
        serde_json::from_value(json).expect("valid placement JSON")
    }

    #[test]
    fn placement_questions_convert_with_cefr_and_skill_in_the_prompt() {
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es",
            "questions": [
                { "id": "pq_0", "cefr": "A2", "skill": "grammar", "prompt": "Choose", "options": ["el","la"] }
            ]
        }));
        let qs = placement_questions(&resp).expect("well-formed");
        assert_eq!(qs.len(), 1);
        assert_eq!(qs[0].id, "pq_0");
        assert!(qs[0].prompt.contains("A2"));
        assert!(qs[0].prompt.contains("grammar"));
        assert!(qs[0].prompt.contains("Choose"));
    }

    #[test]
    fn empty_placement_batch_is_malformed() {
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es", "questions": []
        }));
        assert!(placement_questions(&resp).is_none());
    }

    #[test]
    fn placement_question_with_no_options_is_malformed() {
        let resp = placement_response(serde_json::json!({
            "native": "en", "target": "es",
            "questions": [{ "id": "pq_0", "cefr": "A1", "skill": "vocab", "prompt": "?", "options": [] }]
        }));
        assert!(placement_questions(&resp).is_none());
    }

    #[test]
    fn build_placement_answers_omits_unanswered_questions() {
        let qs = vec![
            PlacementQuestion {
                id: "pq_0".into(),
                prompt: "a".into(),
                options: vec!["x".into(), "y".into()],
            },
            PlacementQuestion {
                id: "pq_1".into(),
                prompt: "b".into(),
                options: vec!["x".into(), "y".into()],
            },
        ];
        let selected = vec![Some(1), None];
        let answers = build_placement_answers(&qs, &selected).expect("valid");
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0].id, "pq_0");
        assert_eq!(answers[0].selected_index, 1);
    }

    #[test]
    fn placement_outcome_converts_level_and_sorted_skill_percentages() {
        let resp: types::SubmitPlacementResponse = serde_json::from_value(serde_json::json!({
            "courseId": "c-new", "level": "B1",
            "scoreBySkill": { "vocab": 0.4, "grammar": 0.8, "reading": 0.6 }
        }))
        .expect("valid");
        let outcome = PlacementOutcome::from_response(&resp, "en".into(), "es".into());
        assert_eq!(outcome.course_id, "c-new");
        assert_eq!(outcome.level, "B1");
        // The submitted languages are carried onto the outcome.
        assert_eq!(outcome.native, "en");
        assert_eq!(outcome.target, "es");
        // Sorted by skill name: grammar, reading, vocab.
        assert_eq!(
            outcome.score_by_skill,
            vec![
                ("grammar".to_string(), 80),
                ("reading".to_string(), 60),
                ("vocab".to_string(), 40),
            ]
        );
    }

    #[test]
    fn course_title_from_codes_is_human_readable_with_fallbacks() {
        assert_eq!(course_title("en", "es"), "English → Spanish");
        // An unknown code falls back to its uppercase form.
        assert_eq!(course_title("en", "xx"), "English → XX");
        // Missing codes fall back to a generic title (never blank).
        assert_eq!(course_title("", "es"), "Your course");
    }

    #[test]
    fn memory_items_sort_vocab_first_then_due_then_mastery() {
        let graph: types::MemoryGraphResponse = serde_json::from_value(serde_json::json!({
            "nodes": [
                { "id": "g0", "kind": "grammar", "label": "Past tense", "strength": 0.5, "due": false },
                { "id": "v0", "kind": "vocab", "label": "casa", "translation": "house", "strength": 0.9, "due": false },
                { "id": "v1", "kind": "vocab", "label": "perro", "translation": "dog", "strength": 0.3, "due": true }
            ],
            "edges": []
        }))
        .expect("valid");
        let items = memory_items(&graph);
        assert_eq!(items.len(), 3);
        // Vocab before grammar; within vocab, due (perro) before not-due (casa).
        assert_eq!(items[0].kind, "vocab");
        assert_eq!(items[0].label, "perro");
        assert!(items[0].due);
        assert_eq!(items[0].mastery, 30);
        assert_eq!(items[1].label, "casa");
        assert_eq!(items[1].translation.as_deref(), Some("house"));
        assert_eq!(items[2].kind, "grammar");
    }

    #[test]
    fn config_view_maps_self_hosted_owner_and_infra() {
        let resp: types::OnboardingConfigResponse = serde_json::from_value(serde_json::json!({
            "selfHosted": true, "isOwner": true,
            "infra": {
                "aiProvider": "openai", "aiModel": "gpt-5", "aiBaseUrl": null,
                "sttProvider": "whisper", "sttBaseUrl": null, "sttModel": null,
                "ttsProvider": "elevenlabs", "ttsBaseUrl": null,
                "storageProvider": "r2", "s3Bucket": "sotto", "s3Region": "auto"
            }
        }))
        .expect("valid");
        let view = ConfigView::from(&resp);
        assert!(view.self_hosted);
        assert!(view.is_owner);
        let infra = view.infra.expect("infra present for owner");
        assert_eq!(infra.ai_provider.as_deref(), Some("openai"));
        assert_eq!(infra.tts_provider.as_deref(), Some("elevenlabs"));
        assert_eq!(infra.storage_provider.as_deref(), Some("r2"));
    }

    #[test]
    fn config_view_has_no_infra_when_not_owner() {
        let resp: types::OnboardingConfigResponse = serde_json::from_value(serde_json::json!({
            "selfHosted": true, "isOwner": false, "infra": null
        }))
        .expect("valid");
        let view = ConfigView::from(&resp);
        assert!(view.infra.is_none());
    }

    // --- P6e: adaptive-listening Q&A ---------------------------------------

    fn interaction(json: serde_json::Value) -> types::InteractionResponse {
        serde_json::from_value(json).expect("valid InteractionResponse JSON")
    }

    #[test]
    fn pending_interaction_keeps_polling() {
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "?", "timestamp": 0,
            "status": "PENDING", "answer": null, "helpful": null, "segmentOrder": null
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        assert_eq!(
            phase,
            AskPhase::Polling {
                interaction_id: "i0".into()
            }
        );
        assert!(!ask_is_terminal(&phase));
    }

    #[test]
    fn answering_interaction_keeps_polling() {
        // ANSWERING (mid-generation) is not terminal.
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "?", "timestamp": 0,
            "status": "ANSWERING", "answer": null, "helpful": null, "segmentOrder": null
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        assert!(matches!(phase, AskPhase::Polling { .. }));
    }

    #[test]
    fn answered_interaction_yields_the_answer_text() {
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "What is 'casa'?", "timestamp": 12.5,
            "status": "ANSWERED", "answer": "It means house.", "helpful": null, "segmentOrder": 2
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        match &phase {
            AskPhase::Answered {
                answer,
                answer_audio,
            } => {
                assert_eq!(answer, "It means house.");
                // The episode-interact route is text-only.
                assert!(answer_audio.is_none());
            }
            other => panic!("expected Answered, got {other:?}"),
        }
        assert!(ask_is_terminal(&phase));
    }

    #[test]
    fn answered_without_answer_text_is_treated_as_failed() {
        // A terminal status with no answer text -> Failed (defensive).
        let resp = interaction(serde_json::json!({
            "id": "i0", "question": "?", "timestamp": 0,
            "status": "ANSWERED", "answer": null, "helpful": null, "segmentOrder": null
        }));
        let phase = reduce_interaction_poll("i0", &resp);
        assert!(matches!(phase, AskPhase::Failed { .. }));
        assert!(ask_is_terminal(&phase));
    }

    #[test]
    fn ask_state_open_close_resets_the_question() {
        let mut ask = AskState::opened();
        assert!(ask.open);
        for c in "hola".chars() {
            ask.input.push_char(c);
        }
        assert_eq!(ask.input.text(), "hola");
        // Re-opening starts a fresh, empty question (each ask is independent).
        ask = AskState::opened();
        assert!(ask.input.is_empty());
        assert_eq!(ask.phase, AskPhase::Editing);
        ask = AskState::closed();
        assert!(!ask.open);
    }
}
