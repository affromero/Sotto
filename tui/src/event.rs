use crossterm::event::{KeyEvent, MouseEvent};
use serde::{Deserialize, Serialize};

/// Events produced by the [`crate::tui::Tui`] event loop and consumed by
/// [`crate::app::App`]. Mirrors the gitpane event model: terminal input plus
/// lifecycle and housekeeping signals.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) enum Event {
    /// Emitted once when the event loop starts.
    Init,
    /// Lightweight housekeeping tick.
    Tick,
    /// Request a redraw.
    Render,
    /// A key was pressed.
    Key(KeyEvent),
    /// A mouse event occurred.
    Mouse(MouseEvent),
    /// The terminal was resized to `(width, height)`.
    Resize(u16, u16),
    /// The terminal regained focus.
    FocusGained,
    /// The terminal lost focus.
    FocusLost,
}
