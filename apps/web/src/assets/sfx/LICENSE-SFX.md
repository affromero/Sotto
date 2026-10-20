# Stock audio sources

Sotto's stock cues use MP3 audio at 44.1 kHz, mono, 128 kbps.

The existing production cues are `intro-warm.mp3`, `transition-whoosh.mp3`,
`outro-gentle.mp3` and `ambient-soft.mp3`. `silence-500ms.mp3` is generated silence.

Five additional cues are synthesized from oscillators and seeded noise, without
input recordings:

| File              | Sound                                      | Duration |
| ----------------- | ------------------------------------------ | -------- |
| `laugh-track.mp3` | Rhythmic synthetic vocal pulses            | 2.5 s    |
| `music-sting.mp3` | Decaying major chord                       | 1.5 s    |
| `applause.mp3`    | Overlapping synthetic clap transients      | 2.5 s    |
| `comedic-hit.mp3` | Falling pitch with a short noise transient | 0.5 s    |
| `rim-shot.mp3`    | Two drum pulses and a noise cymbal         | 1 s      |

Render them with `python3 scripts/assets/generate_stock_cues.py <output-directory>`
from the repository root. FFmpeg and FFprobe must be installed. The generator
checks each encoded file's format and duration. `procedural-cues.json` records
the generator, encoder version, MP3 hashes and uncompressed PCM hashes. Encoder
versions can change MP3 bytes while the synthesized PCM stays identical.
