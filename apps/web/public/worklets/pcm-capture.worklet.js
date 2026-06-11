// Mic capture worklet. Runs in the AudioWorkletGlobalScope (a separate realm, so
// NO app imports): it just accumulates ~100 ms Float32 frames at the capture
// context's sample rate and posts them to the main thread, which resamples to
// 16 kHz and encodes to Int16 PCM via the tested lib/audio/pcm.ts helpers.
const FRAME_MS = 100;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global in the worklet scope (the context's rate).
    this._target = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
    this._buf = new Float32Array(this._target);
    this._n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this._buf[this._n++] = channel[i];
        if (this._n >= this._target) {
          const frame = this._buf.slice(0, this._n);
          this.port.postMessage(frame, [frame.buffer]);
          this._buf = new Float32Array(this._target);
          this._n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
