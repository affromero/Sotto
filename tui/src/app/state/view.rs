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
    /// Notes-based placement: paste materials, deduce a level, then confirm
    /// ("start here") or hand off to the MC test to verify.
    NotesPlacement {
        native: String,
        target: String,
        input: String,
        phase: NotesPhase,
    },
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
