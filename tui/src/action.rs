use std::sync::Arc;

use crate::api::{NextClassOutcome, SpeakingUploadResponse, WritingGradeResponse, types};

/// Actions are the reduced intents the [`crate::app::App`] event loop applies
/// to its state. Terminal input is mapped to actions; async API calls dispatch
/// a tokio task that sends a result action (e.g. [`Action::CoursesLoaded`])
/// back through the channel, so the render loop never blocks on the network.
///
/// Network results are wrapped in `Arc` because [`Action`] is `Clone` (the
/// gitpane loop clones actions) but the underlying error type is not, and the
/// payloads can be large.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub(crate) enum Action {
    /// Lightweight housekeeping tick.
    Tick,
    /// Redraw the UI.
    Render,
    /// Exit the application.
    Quit,
    /// The terminal was resized to `(width, height)`.
    Resize(u16, u16),
    /// Surface a transient error message in the status bar.
    Error(String),

    // --- Navigation / input intents (mapped from key events) ---
    /// Move the active selection cursor up.
    Up,
    /// Move the active selection cursor down.
    Down,
    /// Confirm the current selection (Enter / number key chooses an option).
    Select,
    /// Pick a specific 1-based option/list index (number keys).
    Choose(usize),
    /// Back out one screen level (Esc / q at a non-root screen).
    Back,
    /// Retry the failed action on the persistent error screen (`r`).
    Retry,
    /// Toggle audio play/pause (space, on the listening screen).
    PlayPause,
    /// Start/stop a speaking recording (`r`, on the speaking screen).
    ToggleRecord,
    /// Scroll the current item's prompt up (PageUp; long reading passages).
    ScrollUp,
    /// Scroll the current item's prompt down (PageDown).
    ScrollDown,
    /// A typed character for the writing editor.
    Input(char),
    /// Newline in the writing editor (Enter).
    InputNewline,
    /// Backspace in the writing editor.
    InputBackspace,
    /// Submit the writing editor's text (Ctrl-D).
    SubmitText,
    /// Continue the course / advance to the next class.
    NextClass,

    // --- Async API results, delivered by spawned tasks ---
    //
    // Each result carries the `request generation` it was dispatched under (see
    // `App::request_gen`). The handler drops the result when the generation no
    // longer matches the current one, so a fetch that was in flight when the
    // learner navigated away never applies to the wrong target.
    /// `GET /courses` returned (or failed).
    CoursesLoaded(u64, ApiResult<types::CoursesListResponse>),
    /// `GET /courses/{id}/practice` returned (or failed).
    DueLoaded(u64, ApiResult<types::PracticeOverviewResponse>),
    /// `POST /courses/{id}/practice` returned (or failed).
    PracticeStarted(u64, ApiResult<types::StartPracticeResponse>),
    /// `POST /practice/{sessionId}/submit` returned (or failed).
    Submitted(u64, ApiResult<types::SubmitPracticeResponse>),
    /// `GET /episodes/{id}` returned (or failed) for a listening session.
    EpisodeLoaded(u64, ApiResult<types::EpisodeDetailResponse>),
    /// Segment/episode audio bytes were downloaded (or failed) for playback.
    AudioDownloaded(u64, ApiResult<Vec<u8>>),
    /// Multipart speaking upload returned (or failed).
    SpeakingUploaded(u64, ApiResult<SpeakingUploadResponse>),
    /// A speaking grading poll returned (or failed).
    SpeakingPolled(u64, ApiResult<types::SpeakingPollResponse>),

    // --- Classes (the gated CEFR curriculum flow) ---
    /// `POST /courses/{id}/next-class` returned (or failed).
    NextClassResolved(u64, ApiResult<NextClassOutcome>),
    /// `GET /classes/{id}` returned (or failed).
    ClassLoaded(u64, ApiResult<types::ClassDetailResponse>),
    /// `POST /classes/{id}/submit` returned (or failed).
    ClassSubmitted(u64, ApiResult<types::SubmitClassResponse>),
    /// A class listening section's episode loaded (or failed).
    ClassEpisodeLoaded(u64, ApiResult<types::EpisodeDetailResponse>),
    /// Class listening audio bytes were downloaded (or failed).
    ClassAudioDownloaded(u64, ApiResult<Vec<u8>>),
    /// A class speaking attempt upload returned (or failed).
    ClassSpeakingUploaded(u64, ApiResult<SpeakingUploadResponse>),
    /// A class speaking grading poll returned (or failed).
    ClassSpeakingPolled(u64, ApiResult<types::SpeakingPollResponse>),
    /// A class writing submission was graded (or failed).
    ClassWritingGraded(u64, ApiResult<WritingGradeResponse>),

    // --- Exams (ungated mock exams; reuse the class section-walk actions
    //     ClassEpisodeLoaded/ClassAudioDownloaded/ClassSpeaking*/ClassWriting* ) ---
    /// Start the mock-exam flow (from the course screen).
    StartExam,
    /// `POST /exams` returned (or failed) — mints the exam id.
    ExamStarted(u64, ApiResult<types::StartExamResponse>),
    /// `GET /exams/{id}` returned (or failed).
    ExamLoaded(u64, ApiResult<types::ExamDetailResponse>),
    /// `POST /exams/{id}/submit` returned (or failed) — band/score result.
    ExamSubmitted(u64, ApiResult<types::SubmitExamResponse>),

    // --- Placement / memory / settings (P6d) ---
    /// Start placement (from the empty courses state or `n` on courses).
    StartPlacement,
    /// Open the memory graph for the current course (`m` on CourseHome).
    OpenMemory,
    /// Open the read-only settings/config view (`s`).
    OpenSettings,
    /// Toggle the placement language picker column (Tab).
    ToggleLangColumn,
    /// `GET /placement` returned (or failed) — the question batch.
    PlacementLoaded(u64, ApiResult<types::GeneratePlacementResponse>),
    /// `POST /placement` returned (or failed) — the assessed level + course id.
    PlacementSubmitted(u64, ApiResult<types::SubmitPlacementResponse>),
    /// `GET /courses/{id}/graph` returned (or failed) — the memory graph.
    GraphLoaded(u64, ApiResult<types::MemoryGraphResponse>),
    /// `GET /onboarding/config` returned (or failed).
    ConfigLoaded(u64, ApiResult<types::OnboardingConfigResponse>),

    // --- Adaptive-listening Q&A (P6e) ---
    /// Toggle the "ask a question" overlay on a listening screen (`a`).
    ToggleAsk,
    /// `POST /episodes/{id}/interact` returned (or failed) — the PENDING ask.
    InteractionAsked(u64, ApiResult<types::InteractionResponse>),
    /// `GET /episodes/{id}/interact/{interactionId}` poll returned (or failed).
    InteractionPolled(u64, ApiResult<types::InteractionResponse>),
    /// Answer-audio bytes downloaded (or failed) for spoken-clarification playback.
    AnswerAudioDownloaded(u64, ApiResult<Vec<u8>>),

    // --- Theme & polish (P7) ---
    /// Toggle the theme picker overlay (`t`).
    ToggleThemePicker,
    /// Toggle the key-help overlay (`?`).
    ToggleHelp,
    /// Cycle the value of the theme picker's focused row (Enter / → / space).
    CycleThemeValue,

    // --- Account management (P9) ---
    /// Toggle the account switcher overlay (`A`).
    ToggleAccounts,
    /// Switch to the profile under the switcher cursor (Enter): rebuild the Api
    /// client for that profile, persist active, and reload.
    SwitchAccount,
}

/// Result of an async API call, shareable across cloned actions. `Ok` carries
/// the typed response; `Err` carries a display string (the underlying error is
/// not `Clone`).
pub(crate) type ApiResult<T> = Arc<Result<T, String>>;
