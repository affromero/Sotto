/// Actions are the reduced intents the [`crate::app::App`] event loop applies
/// to its state. Real screens in later phases extend this enum; the Phase 3
/// skeleton keeps the universal control actions.
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
}
