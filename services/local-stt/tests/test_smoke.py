"""Behavioral checks for whole-utterance transcription qualification."""

import copy
import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "local_stt_smoke", Path(__file__).parents[1] / "smoke.py"
)
assert SPEC is not None and SPEC.loader is not None
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)


@pytest.fixture
def recordings(tmp_path):
    source = Path(__file__).parents[1] / "fixtures"
    shutil.copytree(source, tmp_path / "recordings")
    return tmp_path / "recordings"


def edit_manifest(directory, edit):
    path = directory / "manifest.json"
    manifest = json.loads(path.read_bytes())
    edit(manifest)
    path.write_text(json.dumps(manifest))


def test_public_recordings_match_their_declared_audio_and_speakers(recordings):
    samples = SMOKE.load_samples(recordings)
    assert {sample["speaker"] for sample in samples} == {"kerstin", "thorsten"}
    assert len({sample["referenceText"] for sample in samples}) == len(samples)


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", "../outside"),
        ("id", ""),
        ("speaker", ""),
        ("referenceText", ""),
        ("referenceText", "___"),
        ("referenceText", "a" * 1001),
        ("sha256", "0" * 64),
        ("sourceSha256", "invalid"),
        ("sampleRate", True),
        ("sampleRate", 1),
        ("audioSeconds", True),
        ("audioSeconds", float("nan")),
        ("audioSeconds", float("inf")),
        ("audioSeconds", -1),
        ("license", "unknown"),
        ("source", "https://example.com/latest.wav"),
    ],
)
def test_invalid_manifest_entries_fail_before_transcription(recordings, field, value):
    edit_manifest(recordings, lambda data: data["samples"][0].update({field: value}))
    with pytest.raises(ValueError):
        SMOKE.load_samples(recordings)


def test_recordings_require_distinct_speakers(recordings):
    edit_manifest(recordings, lambda data: data["samples"][1].update(speaker="kerstin"))
    with pytest.raises(ValueError, match="two speakers"):
        SMOKE.load_samples(recordings)


def test_duplicate_identifiers_fail(recordings):
    edit_manifest(recordings, lambda data: data["samples"].append(data["samples"][0]))
    with pytest.raises(ValueError, match="unique"):
        SMOKE.load_samples(recordings)


def test_symlinked_recordings_fail(recordings):
    path = recordings / "kerstin-weather.wav"
    path.rename(recordings / "original.wav")
    path.symlink_to(recordings / "original.wav")
    with pytest.raises(ValueError, match="regular"):
        SMOKE.load_samples(recordings)


def test_truncated_pcm_fails_even_when_the_declared_file_hash_matches(recordings):
    path = recordings / "kerstin-weather.wav"
    path.write_bytes(path.read_bytes()[:-100])
    edit_manifest(
        recordings,
        lambda data: data["samples"][0].update(
            sha256=hashlib.sha256(path.read_bytes()).hexdigest()
        ),
    )
    with pytest.raises(ValueError, match="truncated"):
        SMOKE.load_samples(recordings)


def test_duplicate_pcm_with_different_container_bytes_fails(recordings):
    first = recordings / "kerstin-weather.wav"
    second = recordings / "thorsten-geography.wav"
    second.write_bytes(first.read_bytes() + b"JUNK\x00\x00\x00\x00")
    first_entry = SMOKE.load_samples(Path(__file__).parents[1] / "fixtures")[0]
    edit_manifest(
        recordings,
        lambda data: data["samples"][1].update(
            sha256=hashlib.sha256(second.read_bytes()).hexdigest(),
            sampleRate=first_entry["sampleRate"],
            audioSeconds=first_entry["audioSeconds"],
        ),
    )
    with pytest.raises(ValueError, match="decoded recording"):
        SMOKE.load_samples(recordings)


def test_transcript_of_another_recording_cannot_satisfy_its_reference():
    samples = SMOKE.load_samples(Path(__file__).parents[1] / "fixtures")
    response = transcript(samples[0]["referenceText"])
    assert SMOKE.response_errors(response, samples[1]["referenceText"], 60)


REFERENCE = "Gestern bin ich zu Fuß zum Markt gegangen."
DURATION = 2.4


def transcript(text=REFERENCE):
    tokens = text.split()
    return {
        "text": text,
        "words": [
            {"word": word, "start": index * 0.25, "end": (index + 1) * 0.25}
            for index, word in enumerate(tokens)
        ],
        "segments": [{"text": text, "start": 0.0, "end": 2.0}],
    }


def test_complete_utterance_with_full_word_and_segment_coverage_passes():
    assert SMOKE.response_errors(transcript(), REFERENCE, DURATION) == []


def test_case_punctuation_and_equivalent_german_spelling_preserve_meaning():
    response = transcript("GESTERN bin ich zu Fuss zum Markt gegangen!")
    assert SMOKE.response_errors(response, REFERENCE, DURATION) == []


@pytest.mark.parametrize(
    "text",
    [
        "Gestern bin ich zur Fuß zum Markt gegangen.",
        "Gäss an den ich zu Fuß zum Markt gegangen.",
        "Bin ich zu Fuß zum Markt gegangen.",
        "Gestern bin ich zu Fuß zum Markt gegangen und habe eingekauft.",
    ],
)
def test_wrong_missing_or_added_words_fail_even_with_matching_timestamps(text):
    errors = SMOKE.response_errors(transcript(text), REFERENCE, DURATION)
    assert any("Whole utterance" in error for error in errors)


@pytest.mark.parametrize("collection", ["words", "segments"])
@pytest.mark.parametrize(
    "start,end",
    [
        (float("nan"), 0.25),
        (0.0, float("inf")),
        (-0.1, 0.25),
        (0.5, 0.25),
        (0.0, DURATION + 0.6),
        (True, 0.25),
    ],
)
def test_invalid_timing_fails_for_words_and_segments(collection, start, end):
    response = transcript()
    response[collection][0].update(start=start, end=end)
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


def test_words_cannot_move_backwards_in_time():
    response = transcript()
    response["words"][3].update(start=0.0, end=0.1)
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


def test_segments_cannot_move_backwards_in_time():
    response = transcript()
    response["segments"] = [
        {"text": "Gestern bin ich zu", "start": 0.7, "end": 1.2},
        {"text": "Fuß zum Markt gegangen.", "start": 0.0, "end": 0.6},
    ]
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


@pytest.mark.parametrize("collection", ["words", "segments"])
@pytest.mark.parametrize("parts", [None, [], [None], ["unrelated"]])
def test_missing_or_malformed_timestamp_entries_fail(collection, parts):
    response = transcript()
    response[collection] = parts
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


@pytest.mark.parametrize("collection", ["words", "segments"])
@pytest.mark.parametrize("replacement", ["", "Heute", None])
def test_timestamp_text_must_cover_the_actual_transcript(collection, replacement):
    response = transcript()
    key = "word" if collection == "words" else "text"
    response[collection][0][key] = replacement
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


def test_complete_text_does_not_excuse_partial_word_coverage():
    response = transcript()
    response["words"] = response["words"][1:]
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


def test_complete_text_does_not_excuse_partial_segment_coverage():
    response = transcript()
    response["segments"][0]["text"] = "bin ich zu Fuß zum Markt gegangen."
    assert SMOKE.response_errors(response, REFERENCE, DURATION)


def test_validation_preserves_the_original_provider_response():
    response = transcript("Gestern bin ich zur Fuß zum Markt gegangen.")
    original = copy.deepcopy(response)
    assert SMOKE.response_errors(response, REFERENCE, DURATION)
    assert response == original
