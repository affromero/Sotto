pub(crate) mod status_bar;

use color_eyre::Result;
use ratatui::Frame;
use ratatui::layout::Rect;
/// Draw a component in its assigned terminal region.
pub(crate) trait Component {
    fn draw(&mut self, frame: &mut Frame, area: Rect) -> Result<()>;
}
