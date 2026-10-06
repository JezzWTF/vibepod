import threading
import unittest

import numpy as np

from line_split import MAX_PIECE_CHARS, join_audio, sentences, split_line, synthesize_line
from model_adapter import Audio, Cancelled

SENTENCE = "The more you listen, the more your brain predicts what comes next."


class SplitTest(unittest.TestCase):
    def test_short_lines_are_left_alone(self):
        self.assertEqual(split_line(SENTENCE), [SENTENCE])
        self.assertEqual(split_line("  Hi there.  "), ["Hi there."])

    def test_long_lines_split_at_sentence_ends_within_the_limit(self):
        text = " ".join([SENTENCE] * 30)
        pieces = split_line(text)
        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(len(p) <= MAX_PIECE_CHARS for p in pieces))
        self.assertTrue(all(p.endswith(".") for p in pieces))
        self.assertEqual(" ".join(pieces), text)

    def test_abbreviations_initials_and_decimals_do_not_end_a_sentence(self):
        text = "Dr. Smith met J. K. Rowling at 3.5 p.m. in St. Louis. They talked."
        self.assertEqual(
            sentences(text),
            ["Dr. Smith met J. K. Rowling at 3.5 p.m. in St. Louis.", "They talked."],
        )

    def test_a_very_long_sentence_breaks_at_clauses_then_spaces(self):
        clauses = ", ".join(["a phrase that keeps going on and on"] * 40) + "."
        pieces = split_line(clauses)
        self.assertTrue(all(len(p) <= MAX_PIECE_CHARS for p in pieces))
        self.assertEqual(
            " ".join(pieces).replace(", ", ",").replace(" ", ""), clauses.replace(" ", "")
        )
        words = "word " * 400
        self.assertTrue(all(len(p) <= MAX_PIECE_CHARS for p in split_line(words)))

    def test_cjk_pieces_keep_the_original_text_with_no_added_spaces(self):
        text = "这是第一句话。" * 120
        pieces = split_line(text, over=100, limit=100)
        self.assertEqual("".join(pieces), text)
        mixed = "Hello there. " + "你好吗。" * 60
        self.assertEqual(" ".join(split_line(mixed, over=50, limit=60)).count("  "), 0)

    def test_cjk_sentences_split_without_spaces(self):
        text = "这是第一句话。" * 120
        pieces = split_line(text, over=100, limit=100)
        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(len(p) <= 100 and p.endswith("。") for p in pieces))


class JoinTest(unittest.TestCase):
    def test_pieces_are_trimmed_faded_and_separated_by_a_pause(self):
        rate = 1000
        tone = np.full(500, 0.5, dtype=np.float32)
        padded = np.concatenate([np.zeros(300), tone, np.zeros(300)]).astype(np.float32)
        joined = join_audio([padded, padded], rate, gap_ms=100, fade_ms=20)
        # Each piece keeps its 500 samples plus 30 ms of margin each side; one 100 ms gap.
        self.assertEqual(len(joined), 2 * (500 + 60) + 100)
        self.assertAlmostEqual(float(joined[0]), 0.0, places=3)
        self.assertEqual(float(np.abs(joined).max()), 0.5)
        self.assertTrue(np.isfinite(joined).all())

    def test_one_piece_is_returned_unchanged(self):
        piece = np.ones(10, dtype=np.float32)
        self.assertIs(join_audio([piece], 24000), piece)


class FakeAdapter:
    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice, settings, cancel=None, progress=None):
        self.calls.append((text, settings["seed"]))
        if progress:
            progress("synthesizing", 10)
            progress("synthesizing", 25)
        return Audio(np.full(2400, 0.3, dtype=np.float32), 24000)


class SynthesizeLineTest(unittest.TestCase):
    def test_a_short_line_is_one_call_with_the_given_seed(self):
        adapter = FakeAdapter()
        audio = synthesize_line(adapter, SENTENCE, {}, 42, None, None)
        self.assertEqual(adapter.calls, [(SENTENCE, 42)])
        self.assertEqual(len(audio.samples), 2400)

    def test_a_long_line_is_rendered_in_pieces_with_steps_continuing(self):
        adapter, seen = FakeAdapter(), []
        text = " ".join([SENTENCE] * 30)
        audio = synthesize_line(
            adapter, text, {}, 42, None, lambda stage, steps=None: seen.append(steps)
        )
        self.assertGreater(len(adapter.calls), 1)
        self.assertEqual(
            [seed for _, seed in adapter.calls], [42 + i for i in range(len(adapter.calls))]
        )
        self.assertEqual(seen, sorted(seen))
        self.assertEqual(seen[-1], 25 * len(adapter.calls))
        self.assertGreater(len(audio.samples), 2400 * len(adapter.calls))

    def test_cancelling_between_pieces_stops_before_the_next_one(self):
        adapter, cancel = FakeAdapter(), threading.Event()
        original = adapter.synthesize

        def synthesize(*args, **kwargs):
            result = original(*args, **kwargs)
            cancel.set()
            return result

        adapter.synthesize = synthesize
        with self.assertRaises(Cancelled):
            synthesize_line(adapter, " ".join([SENTENCE] * 30), {}, 42, cancel, None)
        self.assertEqual(len(adapter.calls), 1)


if __name__ == "__main__":
    unittest.main()
