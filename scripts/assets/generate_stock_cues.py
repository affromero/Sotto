"""Render original stock cues from oscillators and seeded noise."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import subprocess
import sys
import tempfile
import wave
from array import array
from pathlib import Path

RATE = 44_100


def pulse(time: float, frequency: float, decay: float) -> float:
    if time < 0:
        return 0.0
    return math.sin(2 * math.pi * frequency * time) * math.exp(-time / decay)


def sample(name: str, time: float, noise: float) -> float:
    if name == 'comedic-hit':
        phase = 180 * time + 42 * (1 - math.exp(-time / 0.07))
        return (
            0.7 * math.sin(2 * math.pi * phase) * math.exp(-time / 0.1)
            + 0.25 * noise * math.exp(-time / 0.015)
        )
    if name == 'rim-shot':
        drums = sum(
            pulse(time - onset, 185, 0.05)
            + (0.45 * noise * math.exp(-(time - onset) / 0.025)
               if time >= onset else 0.0)
            for onset in (0.02, 0.19)
        )
        cymbal = (
            (noise + 0.15 * math.sin(2 * math.pi * 6_130 * time))
            * math.exp(-(time - 0.43) / 0.21)
            if time >= 0.43 else 0.0
        )
        return 0.4 * drums + 0.3 * cymbal
    if name == 'music-sting':
        chord = sum(
            math.sin(2 * math.pi * frequency * time)
            + 0.22 * math.sin(4 * math.pi * frequency * time)
            for frequency in (261.6256, 329.6276, 391.9954)
        )
        return 0.2 * chord * math.exp(-time / 0.55)
    if name == 'applause':
        result = 0.0
        for index in range(38):
            onset = 0.04 + index * 0.061 + 0.012 * math.sin(index * 3.7)
            elapsed = time - onset
            if 0 <= elapsed < 0.08:
                result += (
                    0.38 * noise * math.exp(-elapsed / 0.017)
                    + 0.11 * pulse(elapsed, 730 + index * 13, 0.008)
                )
        return result
    if name == 'laugh-track':
        result = 0.0
        for voice, pitch in enumerate((173, 217, 251)):
            for beat in range(9):
                elapsed = time - (0.06 + voice * 0.04 + beat * 0.24)
                if not 0 <= elapsed < 0.18:
                    continue
                envelope = math.sin(math.pi * elapsed / 0.18) ** 2
                phase = pitch * elapsed + 0.7 * math.sin(23 * elapsed)
                result += envelope * (
                    0.16 * math.sin(2 * math.pi * phase)
                    + 0.09 * math.sin(4 * math.pi * phase)
                    + 0.06 * math.sin(2 * math.pi * 760 * elapsed)
                    + 0.025 * noise
                )
        return result
    raise ValueError('Unknown stock effect: ' + name)


def render(
    name: str, duration: float, destination: Path, scratch: Path
) -> dict[str, object]:
    generator = random.Random(name)
    frames = []
    for index in range(round(duration * RATE)):
        time = index / RATE
        envelope = min(1.0, time / 0.004, (duration - time) / 0.07)
        frames.append(
            sample(name, time, generator.uniform(-1.0, 1.0)) * envelope
        )
    peak = max(abs(value) for value in frames)
    gain = 0.9 / peak
    pcm = array('h', (round(value * gain * 32767) for value in frames))
    if sys.byteorder != 'little':
        pcm.byteswap()
    wav = scratch / (name + '.wav')
    with wave.open(str(wav), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    mp3 = destination / (name + '.mp3')
    subprocess.run([
        'ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
        '-i', str(wav), '-map_metadata', '-1', '-ac', '1', '-ar', str(RATE),
        '-c:a', 'libmp3lame', '-b:a', '128k', '-flags:a', '+bitexact', str(mp3),
    ], check=True)
    metadata = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries',
        'stream=codec_name,sample_rate,channels,bit_rate:format=duration',
        '-of', 'json', str(mp3),
    ]))
    stream = metadata['streams'][0]
    assert stream['codec_name'] == 'mp3'
    assert stream['sample_rate'] == str(RATE)
    assert stream['channels'] == 1
    assert stream['bit_rate'] == '128000'
    assert abs(float(metadata['format']['duration']) - duration) < 0.08
    return {
        'file': mp3.name, 'sha256': hashlib.sha256(mp3.read_bytes()).hexdigest(),
        'frames': len(frames), 'durationSeconds': duration,
        'pcmSha256': hashlib.sha256(pcm.tobytes()).hexdigest(),
        'meanSquare': sum(value * value for value in frames) / len(frames),
        'probe': metadata,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    destination = parser.parse_args().destination
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sotto-stock-cues-') as temporary:
        files = [
            render(name, duration, destination, Path(temporary))
            for name, duration in (
                ('laugh-track', 2.5), ('music-sting', 1.5),
                ('applause', 2.5), ('comedic-hit', 0.5), ('rim-shot', 1.0),
            )
        ]
    manifest = {
        'method': 'Original oscillators and seeded noise. No input recordings.',
        'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'ffmpeg': subprocess.check_output(
            ['ffmpeg', '-version'], text=True
        ).splitlines()[0],
        'files': files,
    }
    (destination / 'procedural-cues.json').write_text(
        json.dumps(manifest, indent=2) + '\n'
    )
    print(json.dumps({'files': len(files), 'directory': str(destination)}))


if __name__ == '__main__':
    main()
