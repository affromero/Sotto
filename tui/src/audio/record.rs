//! Microphone capture over cpal, encoding to a mono 16-bit WAV on stop.
//!
//! [`Recorder::start`] opens the default input device, builds an input stream,
//! and accumulates samples (converted to `f32`) into a shared buffer. On
//! [`Recorder::stop`] the captured samples are downmixed to mono and encoded as
//! a 16-bit PCM WAV via hound, returned as in-memory bytes for upload.
//!
//! Device init is fully guarded: with no input device (headless/CI) `start`
//! returns an `Err` the caller surfaces to the status bar; the TUI keeps
//! working. No `.unwrap()`/`.expect()` on any device or stream path.
//!
//! The pure [`encode_wav_mono16`] encoder is independent of any device, so the
//! WAV-format behavior is unit-tested without audio hardware.

use std::sync::{Arc, Mutex};

use color_eyre::{Result, eyre::eyre};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample};
use hound::{SampleFormat, WavSpec, WavWriter};

/// Shared, interior-mutable capture buffer the stream callback appends to.
type SharedSamples = Arc<Mutex<Vec<f32>>>;

/// An in-progress capture: the live cpal stream plus the buffer it fills and
/// the source format needed to encode on stop. Dropping the stream stops
/// capture; the buffer is retained until `stop` consumes it.
struct Capture {
    stream: cpal::Stream,
    samples: SharedSamples,
    channels: u16,
    sample_rate: u32,
}

/// Records microphone input to a mono 16-bit WAV. A fresh `Recorder` is idle;
/// `start` begins capture and `stop` finalizes it. Re-`start` after `stop`
/// captures a new clip.
#[derive(Default)]
pub(crate) struct Recorder {
    capture: Option<Capture>,
}

impl Recorder {
    pub fn new() -> Self {
        Self::default()
    }

    /// True while a capture is in progress.
    pub fn is_recording(&self) -> bool {
        self.capture.is_some()
    }

    /// Begin capturing from the default input device. Returns `Err` when no
    /// input device/config is available, or when a capture is already running.
    pub fn start(&mut self) -> Result<()> {
        if self.capture.is_some() {
            return Err(eyre!("a recording is already in progress"));
        }

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| eyre!("no audio input device available"))?;
        let supported = device
            .default_input_config()
            .map_err(|e| eyre!("no default input config: {e}"))?;

        let channels = supported.channels();
        let sample_rate = supported.sample_rate();
        let sample_format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();

        let samples: SharedSamples = Arc::new(Mutex::new(Vec::new()));
        let err_fn = |err: cpal::Error| {
            // Stream errors are non-fatal to the TUI; capture simply stops
            // producing samples. Avoid stdout noise inside the alt-screen.
            let _ = err;
        };

        // cpal hands the callback the device's native sample type; convert each
        // to f32 so encoding has a single code path regardless of format.
        let stream = build_input_stream(&device, config, sample_format, &samples, err_fn)?;
        stream
            .play()
            .map_err(|e| eyre!("could not start input stream: {e}"))?;

        self.capture = Some(Capture {
            stream,
            samples,
            channels,
            sample_rate,
        });
        Ok(())
    }

    /// Stop capture and return the recording as mono 16-bit WAV bytes. Returns
    /// `Err` when no capture is in progress.
    pub fn stop(&mut self) -> Result<Vec<u8>> {
        let capture = self
            .capture
            .take()
            .ok_or_else(|| eyre!("no recording in progress"))?;

        // Drop the stream first so the callback can no longer touch the buffer.
        drop(capture.stream);

        let samples = capture
            .samples
            .lock()
            .map_err(|_| eyre!("recording buffer was poisoned"))?
            .clone();

        encode_wav_mono16(&samples, capture.channels, capture.sample_rate)
    }
}

/// Build an input stream that appends f32-converted samples to `samples`,
/// dispatching on the device's native sample format.
fn build_input_stream(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    format: cpal::SampleFormat,
    samples: &SharedSamples,
    err_fn: impl FnMut(cpal::Error) + Send + 'static,
) -> Result<cpal::Stream> {
    use cpal::SampleFormat as F;
    let stream = match format {
        F::I8 => build_typed::<i8>(device, config, samples, err_fn),
        F::I16 => build_typed::<i16>(device, config, samples, err_fn),
        F::I32 => build_typed::<i32>(device, config, samples, err_fn),
        F::F32 => build_typed::<f32>(device, config, samples, err_fn),
        other => return Err(eyre!("unsupported input sample format: {other}")),
    }?;
    Ok(stream)
}

/// Build a typed input stream for native sample type `T`, converting to f32.
fn build_typed<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    samples: &SharedSamples,
    err_fn: impl FnMut(cpal::Error) + Send + 'static,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample + Send + 'static,
    f32: FromSample<T>,
{
    let sink = Arc::clone(samples);
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                if let Ok(mut buf) = sink.lock() {
                    buf.extend(data.iter().map(|&s| f32::from_sample(s)));
                }
            },
            err_fn,
            None,
        )
        .map_err(|e| eyre!("could not build input stream: {e}"))
}

/// Encode interleaved `f32` samples (with `channels` interleaving at
/// `sample_rate`) into a mono 16-bit PCM WAV, returned as bytes. Multi-channel
/// input is downmixed by averaging the channels of each frame.
///
/// Pure: takes a sample slice, touches no audio device — the unit tests exercise
/// it directly.
pub(crate) fn encode_wav_mono16(
    samples: &[f32],
    channels: u16,
    sample_rate: u32,
) -> Result<Vec<u8>> {
    let channels = channels.max(1);
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };

    let mut cursor = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)
            .map_err(|e| eyre!("could not start WAV writer: {e}"))?;
        for frame in samples.chunks(channels as usize) {
            let mono = frame.iter().copied().sum::<f32>() / frame.len() as f32;
            let clamped = mono.clamp(-1.0, 1.0);
            // i16 full-scale; round toward nearest to minimize quantization bias.
            let value = (clamped * i16::MAX as f32).round() as i16;
            writer
                .write_sample(value)
                .map_err(|e| eyre!("could not write WAV sample: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| eyre!("could not finalize WAV: {e}"))?;
    }
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parse the canonical RIFF/WAVE header fields a player relies on.
    struct WavHeader {
        riff: [u8; 4],
        wave: [u8; 4],
        audio_format: u16,
        channels: u16,
        sample_rate: u32,
        bits_per_sample: u16,
    }

    fn parse_header(bytes: &[u8]) -> WavHeader {
        assert!(
            bytes.len() >= 44,
            "WAV must have a 44-byte canonical header"
        );
        let u16le = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        let u32le =
            |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
        WavHeader {
            riff: [bytes[0], bytes[1], bytes[2], bytes[3]],
            wave: [bytes[8], bytes[9], bytes[10], bytes[11]],
            audio_format: u16le(20),
            channels: u16le(22),
            sample_rate: u32le(24),
            bits_per_sample: u16le(34),
        }
    }

    #[test]
    fn encodes_a_valid_mono_16bit_riff_wave_header() {
        let samples = vec![0.0_f32, 0.5, -0.5, 1.0, -1.0, 0.25];
        let bytes = encode_wav_mono16(&samples, 1, 16_000).expect("encodes");

        let h = parse_header(&bytes);
        assert_eq!(&h.riff, b"RIFF");
        assert_eq!(&h.wave, b"WAVE");
        assert_eq!(h.audio_format, 1, "PCM");
        assert_eq!(h.channels, 1, "mono");
        assert_eq!(h.sample_rate, 16_000);
        assert_eq!(h.bits_per_sample, 16);
    }

    #[test]
    fn downmixes_stereo_to_mono_by_averaging_frames() {
        // Two stereo frames: (1.0, -1.0) -> 0.0 and (0.5, 0.5) -> 0.5.
        let samples = vec![1.0_f32, -1.0, 0.5, 0.5];
        let bytes = encode_wav_mono16(&samples, 2, 48_000).expect("encodes");

        let h = parse_header(&bytes);
        assert_eq!(h.channels, 1, "downmixed to mono");
        assert_eq!(h.sample_rate, 48_000);

        // Two mono frames -> 4 bytes of PCM after the 44-byte header.
        let pcm = &bytes[44..];
        assert_eq!(pcm.len(), 4, "two 16-bit mono samples");
        let s0 = i16::from_le_bytes([pcm[0], pcm[1]]);
        let s1 = i16::from_le_bytes([pcm[2], pcm[3]]);
        assert_eq!(s0, 0, "averaged (1.0, -1.0) = 0.0");
        assert_eq!(s1, (0.5 * i16::MAX as f32).round() as i16);
    }

    #[test]
    fn empty_input_still_produces_a_valid_header_with_no_pcm() {
        let bytes = encode_wav_mono16(&[], 1, 16_000).expect("encodes empty");
        let h = parse_header(&bytes);
        assert_eq!(&h.riff, b"RIFF");
        assert_eq!(&h.wave, b"WAVE");
        assert_eq!(bytes.len(), 44, "header only, no PCM frames");
    }

    #[test]
    fn clamps_out_of_range_samples_to_full_scale() {
        let samples = vec![2.0_f32, -2.0];
        let bytes = encode_wav_mono16(&samples, 1, 8_000).expect("encodes");
        let pcm = &bytes[44..];
        let s0 = i16::from_le_bytes([pcm[0], pcm[1]]);
        let s1 = i16::from_le_bytes([pcm[2], pcm[3]]);
        assert_eq!(s0, i16::MAX, "clamped to +full scale");
        assert_eq!(s1, -i16::MAX, "clamped to -full scale");
    }
}
