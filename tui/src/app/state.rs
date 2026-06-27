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

include!("state/core.rs");
include!("state/sections.rs");
include!("state/placement.rs");
include!("state/view.rs");
include!("state/reducers.rs");
include!("state/answers.rs");

#[cfg(test)]
mod tests {
    include!("state/tests/practice.rs");
    include!("state/tests/class_exam.rs");
    include!("state/tests/placement_ask.rs");
}
