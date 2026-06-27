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
    /// How the level was set (null/None on legacy courses placed before the
    /// field existed). Lets screens hint that a self-selected level is unverified.
    pub placement_source: Option<String>,
}

impl From<&types::CourseSummary> for Course {
    fn from(summary: &types::CourseSummary) -> Self {
        Self {
            id: summary.id.clone(),
            title: summary.curriculum.title.clone(),
            native_lang: summary.native_lang.clone(),
            target_lang: summary.target_lang.clone(),
            current_level: summary.current_level.to_string(),
            placement_source: summary.placement_source.as_ref().map(|s| s.to_string()),
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
        types::PracticeKind::Full => "Full catch-up",
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
/// speaking landed in P4/P5; grammar/reading are wired in P6a. Full/writing still
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
