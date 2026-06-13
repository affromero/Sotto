//! Audio for the terminal client: playback (listening) and capture (speaking).
//!
//! Both submodules guard device init behind `Result`: on a headless host the
//! constructors return `Err` and the App surfaces a status-bar message rather
//! than crashing. The WAV encoder in [`record`] is a pure function, unit-tested
//! without any device.

pub(crate) mod playback;
pub(crate) mod record;

pub(crate) use playback::AudioPlayer;
pub(crate) use record::Recorder;
