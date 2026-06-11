// Playback worklet. Runs in the AudioWorkletGlobalScope (separate realm, NO app
// imports). The main thread decodes incoming 24 kHz Int16 PCM to Float32 and posts
// frames here; this drains them through a small jitter buffer into the output.
// The playback AudioContext runs at 24 kHz so no resampling is needed here.
class PcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._head = null;
    this._headPos = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this._queue = [];
        this._head = null;
        this._headPos = 0;
        return;
      }
      this._queue.push(e.data);
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    for (let i = 0; i < out.length; i++) {
      if (!this._head || this._headPos >= this._head.length) {
        this._head = this._queue.shift() || null;
        this._headPos = 0;
      }
      out[i] = this._head ? this._head[this._headPos++] : 0;
    }
    return true;
  }
}

registerProcessor('pcm-playback', PcmPlaybackProcessor);
