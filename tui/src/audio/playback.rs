//! Audio playback over rodio.
//!
//! [`AudioPlayer`] owns a rodio output sink and a [`rodio::Player`] connected to
//! it. The App downloads a segment's presigned audio bytes (reqwest) and hands
//! them here; `play` decodes the in-memory bytes and streams them to the sink.
//!
//! Device init is fully guarded: on a headless host (no output device) the
//! builder returns an `Err` that callers turn into a status-bar message — the
//! rest of the TUI keeps working. There is no `.unwrap()`/`.expect()` on any
//! device or stream path.

use std::io::Cursor;

use color_eyre::{Result, eyre::eyre};
use rodio::{Decoder, Player, stream::MixerDeviceSink};

/// A guarded audio output: the rodio device sink plus a player connected to its
/// mixer. Construction can fail (no device); playback methods are no-ops-safe
/// once constructed.
pub(crate) struct AudioPlayer {
    // Field order matters for drop: the player is dropped before the sink.
    player: Player,
    // Held for the lifetime of playback; dropping it closes the output stream.
    _sink: MixerDeviceSink,
}

impl AudioPlayer {
    /// Open the default output device and connect a player. Returns `Err` when
    /// no output device is available (headless/CI), so the caller can surface a
    /// clear message and continue without audio.
    pub fn new() -> Result<Self> {
        let sink = rodio::stream::DeviceSinkBuilder::open_default_sink()
            .map_err(|e| eyre!("no audio output device available: {e}"))?;
        let player = Player::connect_new(sink.mixer());
        Ok(Self {
            player,
            _sink: sink,
        })
    }

    /// Decode `bytes` (format auto-detected: mp3/wav/flac/ogg) and start playing
    /// from the start, replacing anything currently queued. Returns `Err` on a
    /// decode failure (corrupt/empty/unsupported bytes).
    pub fn play(&self, bytes: Vec<u8>) -> Result<()> {
        let decoder =
            Decoder::new(Cursor::new(bytes)).map_err(|e| eyre!("could not decode audio: {e}"))?;
        // Replace any current queue, then append + play the new source. rodio's
        // Player::append converts the decoder's samples into the mixer format.
        self.player.clear();
        self.player.append(decoder);
        self.player.play();
        Ok(())
    }

    /// Toggle play/pause and report whether it is now playing.
    pub fn toggle(&self) -> bool {
        if self.player.is_paused() {
            self.player.play();
            true
        } else {
            self.player.pause();
            false
        }
    }

    /// Stop and clear the queue.
    pub fn stop(&self) {
        self.player.clear();
    }

    /// True once the queued audio has finished (nothing left to play).
    pub fn is_finished(&self) -> bool {
        self.player.empty()
    }
}
