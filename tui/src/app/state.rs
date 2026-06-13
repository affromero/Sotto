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

/// Whether every section of the class has been worked through to a submittable
/// state: MC/listening have an answer for every question, speaking has graded
/// (or failed) every prompt, writing has graded (or failed) every prompt. Pure;
/// drives whether the class can be submitted.
pub(crate) fn class_ready_to_submit(sections: &[ClassSection]) -> bool {
    sections.iter().all(section_complete)
}

fn section_complete(section: &ClassSection) -> bool {
    match &section.progress {
        SectionProgress::Mc { selected, .. } | SectionProgress::Listening { selected, .. } => {
            selected.iter().all(Option::is_some)
        }
        // Speaking/writing are graded via their own endpoints during the
        // section; they never gate the MC class submit.
        SectionProgress::Speaking { .. } | SectionProgress::Writing { .. } => true,
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
pub(crate) fn answer_current_choice(
    questions: &[ClassQuestion],
    selected: &mut [Option<usize>],
    index: usize,
    choice: usize,
) -> bool {
    if index < selected.len() {
        selected[index] = Some(choice);
    }
    index + 1 >= questions.len()
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

    #[test]
    fn class_ready_to_submit_requires_all_mc_answered() {
        let mut sections = class_sections(&mixed_class()).expect("well-formed");
        // Unanswered MC -> not ready.
        assert!(!class_ready_to_submit(&sections));
        // Answer every MC/listening question; speaking/writing never gate.
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
        assert!(class_ready_to_submit(&sections));
    }

    #[test]
    fn answer_current_choice_records_and_flags_the_last_question() {
        let qs = vec![
            ClassQuestion {
                id: "q0".into(),
                prompt: "a".into(),
                options: vec!["x".into(), "y".into()],
            },
            ClassQuestion {
                id: "q1".into(),
                prompt: "b".into(),
                options: vec!["x".into(), "y".into()],
            },
        ];
        let mut selected = vec![None, None];
        assert!(!answer_current_choice(&qs, &mut selected, 0, 1));
        assert_eq!(selected, vec![Some(1), None]);
        assert!(answer_current_choice(&qs, &mut selected, 1, 0));
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
}
