//! Theme system for the TUI, mirroring the web "SottoDesign aula" tokens
//! (`packages/shared/src/theme.ts` + `AppearanceControls.tsx`). A [`Theme`] is a
//! `(mode, light_palette, accent)` choice that resolves to a flat [`Palette`] of
//! ratatui colors. Rendering threads a `&Palette` rather than reading a global,
//! so a live theme switch is just a different value and tests construct a palette
//! directly.

use ratatui::style::Color;

use crate::config::ThemeChoice;

/// Compile-time hex → [`Color::Rgb`]. `rgb(0x3F, 0x4F, 0xB0)`.
const fn rgb(r: u8, g: u8, b: u8) -> Color {
    Color::Rgb(r, g, b)
}

/// The resolved colors a screen paints with. One flat struct so draw code reads
/// `p.primary` / `p.ink` with no branching on mode/accent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Palette {
    /// Window background.
    pub bg: Color,
    /// Raised surface (panels, selected rows).
    pub surface: Color,
    /// Primary text.
    pub ink: Color,
    /// Secondary / muted text.
    pub ink_soft: Color,
    /// Borders and separators.
    pub line: Color,
    /// Primary brand color (titles, selection, key chips).
    pub primary: Color,
    /// Chosen accent (a second emphasis color).
    pub accent: Color,
    /// Success / positive.
    pub success: Color,
    /// Warning / caution.
    pub warn: Color,
    /// Error / failure.
    pub error: Color,
    /// Wordmark pink (the brand gradient's warm end), for error/empty headers.
    pub pink: Color,
    /// Foreground to lay on top of `primary` fills (key chips, badges).
    pub on_primary: Color,
}

/// Light vs dark mode. `System` is resolved to one of these at load time (the
/// TUI cannot observe an OS appearance signal portably, so `System` maps to
/// dark, matching a terminal's usual default).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    Light,
    Dark,
}

impl Mode {
    pub fn label(self) -> &'static str {
        match self {
            Mode::Light => "light",
            Mode::Dark => "dark",
        }
    }

    pub fn from_label(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "light" => Mode::Light,
            // "dark" and anything else (incl. legacy "system") resolve to dark.
            _ => Mode::Dark,
        }
    }
}

/// The two light backgrounds offered by the web theme picker.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LightPalette {
    /// Aula cool — `#F5F4F0` paper / `#DEDDD6` border.
    AulaCool,
    /// Paper warm — `#F1EADC` / `#D3C9B6`.
    PaperWarm,
}

impl LightPalette {
    pub fn label(self) -> &'static str {
        match self {
            LightPalette::AulaCool => "aula",
            LightPalette::PaperWarm => "paper",
        }
    }

    pub fn from_label(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "paper" => LightPalette::PaperWarm,
            _ => LightPalette::AulaCool,
        }
    }
}

/// The accent swatches from the web `AppearanceControls`. The hex is stored so a
/// chosen accent persists across modes; the swatch color shown in the picker is
/// this hex.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Accent {
    pub label: &'static str,
    pub hex: &'static str,
    rgb: (u8, u8, u8),
}

impl Accent {
    pub fn color(self) -> Color {
        rgb(self.rgb.0, self.rgb.1, self.rgb.2)
    }
}

/// Aula blue — the default accent and primary.
pub(crate) const AULA_BLUE: Accent = Accent {
    label: "Aula blue",
    hex: "#3F4FB0",
    rgb: (0x3F, 0x4F, 0xB0),
};
const TEAL: Accent = Accent {
    label: "Teal",
    hex: "#1C7A6B",
    rgb: (0x1C, 0x7A, 0x6B),
};
const RUST: Accent = Accent {
    label: "Rust",
    hex: "#BC4B26",
    rgb: (0xBC, 0x4B, 0x26),
};
const PLUM: Accent = Accent {
    label: "Plum",
    hex: "#80487F",
    rgb: (0x80, 0x48, 0x7F),
};
const INK_SLATE: Accent = Accent {
    label: "Ink slate",
    hex: "#2A3550",
    rgb: (0x2A, 0x35, 0x50),
};

/// All accents, in the order the web picker shows them.
pub(crate) const ACCENTS: [Accent; 5] = [AULA_BLUE, TEAL, RUST, PLUM, INK_SLATE];

/// A theme choice: mode + (light) palette + accent. Resolves to a [`Palette`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Theme {
    pub mode: Mode,
    pub light_palette: LightPalette,
    pub accent: Accent,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            mode: Mode::Light,
            light_palette: LightPalette::AulaCool,
            accent: AULA_BLUE,
        }
    }
}

impl Theme {
    pub fn is_dark(self) -> bool {
        matches!(self.mode, Mode::Dark)
    }

    /// Resolve the flat color set this theme paints with.
    pub fn palette(self) -> Palette {
        match self.mode {
            Mode::Light => self.light(),
            Mode::Dark => self.dark(),
        }
    }

    /// Light palette: the aula tokens (`globals.css` base + `[data-palette]`
    /// override). `primary` follows the chosen accent (`--color-primary:
    /// var(--user-accent, #3F4FB0)`); `accent` is the separate ink-slate token
    /// (`--color-accent: #2A3550`). The "paper" palette overrides background,
    /// surface, border AND the text tokens — not just bg/border.
    fn light(self) -> Palette {
        // (bg, surface, ink, ink_soft, line) per `[data-palette]`.
        let (bg, surface, ink, ink_soft, line) = match self.light_palette {
            LightPalette::AulaCool => (
                rgb(0xF5, 0xF4, 0xF0), // --color-background
                rgb(0xFF, 0xFF, 0xFF), // --color-surface
                rgb(0x1E, 0x21, 0x28), // --color-text-primary
                rgb(0x56, 0x5B, 0x68), // --color-text-secondary
                rgb(0xDE, 0xDD, 0xD6), // --color-border
            ),
            LightPalette::PaperWarm => (
                rgb(0xF1, 0xEA, 0xDC), // --color-background
                rgb(0xED, 0xE4, 0xD3), // --color-surface
                rgb(0x22, 0x1C, 0x15), // --color-text-primary
                rgb(0x6A, 0x60, 0x4F), // --color-text-secondary
                rgb(0xD3, 0xC9, 0xB6), // --color-border
            ),
        };
        Palette {
            bg,
            surface,
            ink,
            ink_soft,
            line,
            // Primary follows the user accent; the accent token is the slate.
            primary: self.accent.color(),
            accent: rgb(0x2A, 0x35, 0x50),
            success: rgb(0x05, 0x96, 0x69),
            warn: rgb(0xF5, 0x9E, 0x0B),
            error: rgb(0xDC, 0x26, 0x26),
            pink: rgb(0xFF, 0x8F, 0xB1),
            on_primary: rgb(0xFF, 0xFF, 0xFF),
        }
    }

    /// Dark "terminal" palette (`globals.css [data-theme='dark']`). Dark mode
    /// HARD-RESETS `--color-primary` to `#6A9BFF` regardless of the chosen accent
    /// (the accent choice only affects light mode), and uses the light-slate
    /// `--color-accent: #8A93B5`.
    fn dark(self) -> Palette {
        Palette {
            bg: rgb(0x12, 0x13, 0x10),
            surface: rgb(0x1B, 0x1D, 0x17),
            ink: rgb(0xE9, 0xE3, 0xD3),
            ink_soft: rgb(0x9D, 0x96, 0x84),
            line: rgb(0x33, 0x35, 0x2C),
            // Dark mode always uses the brightened aula blue as primary.
            primary: rgb(0x6A, 0x9B, 0xFF),
            accent: rgb(0x8A, 0x93, 0xB5),
            success: rgb(0x34, 0xD3, 0x99),
            warn: rgb(0xFB, 0xBF, 0x24),
            error: rgb(0xF8, 0x71, 0x71),
            pink: rgb(0xF4, 0x72, 0xB6),
            on_primary: rgb(0x12, 0x13, 0x10),
        }
    }

    // --- Picker cycling -----------------------------------------------------

    pub fn cycle_mode(&mut self) {
        self.mode = match self.mode {
            Mode::Light => Mode::Dark,
            Mode::Dark => Mode::Light,
        };
    }

    pub fn cycle_light_palette(&mut self) {
        self.light_palette = match self.light_palette {
            LightPalette::AulaCool => LightPalette::PaperWarm,
            LightPalette::PaperWarm => LightPalette::AulaCool,
        };
    }

    pub fn cycle_accent(&mut self) {
        let i = ACCENTS.iter().position(|a| a == &self.accent).unwrap_or(0);
        self.accent = ACCENTS[(i + 1) % ACCENTS.len()];
    }

    pub fn accent_from_hex(hex: &str) -> Accent {
        ACCENTS
            .iter()
            .copied()
            .find(|a| a.hex.eq_ignore_ascii_case(hex))
            .unwrap_or(AULA_BLUE)
    }

    // --- Persisted-config bridge -------------------------------------------

    /// Resolve a [`Theme`] from the persisted [`ThemeChoice`] strings. Unknown
    /// values fall back to the defaults (mode → light, palette → aula, accent →
    /// aula blue), so a hand-edited or future config never fails to load.
    pub fn from_choice(c: &ThemeChoice) -> Self {
        Self {
            mode: Mode::from_label(&c.mode),
            light_palette: LightPalette::from_label(&c.light_palette),
            accent: Theme::accent_from_hex(&c.accent),
        }
    }

    /// Serialize this theme back to the persisted [`ThemeChoice`] strings.
    pub fn to_choice(self) -> ThemeChoice {
        ThemeChoice {
            mode: self.mode.label().to_string(),
            light_palette: self.light_palette.label().to_string(),
            accent: self.accent.hex.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn light_aula_matches_the_web_aula_tokens() {
        let p = Theme::default().palette();
        // Aula cool background + border, ink text, aula-blue primary, pink end.
        assert_eq!(p.bg, Color::Rgb(0xF5, 0xF4, 0xF0));
        assert_eq!(p.line, Color::Rgb(0xDE, 0xDD, 0xD6));
        assert_eq!(p.ink, Color::Rgb(0x1E, 0x21, 0x28));
        assert_eq!(p.ink_soft, Color::Rgb(0x56, 0x5B, 0x68));
        assert_eq!(p.primary, Color::Rgb(0x3F, 0x4F, 0xB0));
        assert_eq!(p.pink, Color::Rgb(0xFF, 0x8F, 0xB1));
    }

    #[test]
    fn paper_warm_overrides_bg_surface_text_and_border() {
        let aula = Theme::default().palette();
        let warm = Theme {
            light_palette: LightPalette::PaperWarm,
            ..Theme::default()
        }
        .palette();
        // Paper overrides background, surface, border AND text (matching
        // globals.css `[data-palette='paper']`), not just bg/border.
        assert_eq!(warm.bg, Color::Rgb(0xF1, 0xEA, 0xDC));
        assert_eq!(warm.surface, Color::Rgb(0xED, 0xE4, 0xD3));
        assert_eq!(warm.line, Color::Rgb(0xD3, 0xC9, 0xB6));
        assert_eq!(warm.ink, Color::Rgb(0x22, 0x1C, 0x15));
        assert_eq!(warm.ink_soft, Color::Rgb(0x6A, 0x60, 0x4F));
        // Surface + text genuinely differ from aula cool.
        assert_ne!(warm.surface, aula.surface);
        assert_ne!(warm.ink, aula.ink);
        // The light-palette choice does NOT change primary (the user accent).
        assert_eq!(warm.primary, aula.primary);
    }

    #[test]
    fn dark_matches_the_web_terminal_tokens() {
        let p = Theme {
            mode: Mode::Dark,
            ..Theme::default()
        }
        .palette();
        assert_eq!(p.bg, Color::Rgb(0x12, 0x13, 0x10));
        assert_eq!(p.surface, Color::Rgb(0x1B, 0x1D, 0x17));
        assert_eq!(p.ink, Color::Rgb(0xE9, 0xE3, 0xD3));
        assert_eq!(p.ink_soft, Color::Rgb(0x9D, 0x96, 0x84));
        assert_eq!(p.line, Color::Rgb(0x33, 0x35, 0x2C));
        // Dark hard-resets primary to the brightened blue and accent to slate.
        assert_eq!(p.primary, Color::Rgb(0x6A, 0x9B, 0xFF));
        assert_eq!(p.accent, Color::Rgb(0x8A, 0x93, 0xB5));
    }

    #[test]
    fn dark_primary_is_hard_reset_regardless_of_the_chosen_accent() {
        // The web dark mode ignores the accent choice for primary: it is always
        // #6A9BFF. The chosen accent must NOT leak into primary.
        for accent in ACCENTS {
            let p = Theme {
                mode: Mode::Dark,
                accent,
                ..Theme::default()
            }
            .palette();
            assert_eq!(
                p.primary,
                Color::Rgb(0x6A, 0x9B, 0xFF),
                "dark primary must be #6A9BFF for accent {}",
                accent.hex,
            );
            // accent token stays the dark slate, distinct from primary.
            assert_eq!(p.accent, Color::Rgb(0x8A, 0x93, 0xB5));
            assert_ne!(p.primary, p.accent, "primary and accent stay distinct");
        }
    }

    #[test]
    fn light_primary_follows_the_chosen_accent_and_stays_distinct_from_accent_token() {
        for accent in ACCENTS {
            let p = Theme {
                mode: Mode::Light,
                accent,
                ..Theme::default()
            }
            .palette();
            assert_eq!(p.primary, accent.color(), "light primary == user accent");
            // The accent TOKEN is the ink slate, separate from primary.
            assert_eq!(p.accent, Color::Rgb(0x2A, 0x35, 0x50));
        }
    }

    #[test]
    fn accents_mirror_the_web_swatches() {
        let hexes: Vec<&str> = ACCENTS.iter().map(|a| a.hex).collect();
        assert_eq!(
            hexes,
            vec!["#3F4FB0", "#1C7A6B", "#BC4B26", "#80487F", "#2A3550"],
        );
    }

    #[test]
    fn cycling_accent_wraps_through_all_five() {
        let mut t = Theme::default();
        let mut seen = vec![t.accent.hex];
        for _ in 0..ACCENTS.len() {
            t.cycle_accent();
            seen.push(t.accent.hex);
        }
        // 5 steps returns to the start; the first 5 are all distinct.
        assert_eq!(t.accent, AULA_BLUE);
        let distinct: std::collections::BTreeSet<&str> = seen.iter().take(5).copied().collect();
        assert_eq!(distinct.len(), 5);
    }

    #[test]
    fn mode_and_palette_labels_round_trip() {
        assert_eq!(Mode::from_label(Mode::Light.label()), Mode::Light);
        assert_eq!(Mode::from_label(Mode::Dark.label()), Mode::Dark);
        // Legacy "system" resolves to dark.
        assert_eq!(Mode::from_label("system"), Mode::Dark);
        assert_eq!(
            LightPalette::from_label(LightPalette::PaperWarm.label()),
            LightPalette::PaperWarm,
        );
        assert_eq!(Theme::accent_from_hex("#1C7A6B"), TEAL);
        assert_eq!(Theme::accent_from_hex("nonsense"), AULA_BLUE);
    }
}
