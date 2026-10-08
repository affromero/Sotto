"""Behavioral checks for whole-utterance transcription qualification."""

import copy
import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "local_stt_smoke", Path(__file__).parents[1] / "smoke.py"
)
assert SPEC is not None and SPEC.loader is not None
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)

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
