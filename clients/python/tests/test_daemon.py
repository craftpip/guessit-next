"""Python-side tests: drive the real daemon through the wrapper.

Runs the same contract the JS suites pin, from the Python consumer's point
of view: spawn ``node bin/index.js --serve --json`` once (one process per
scan), speak JSON-lines, assert shapes and values.

Stdlib only (``unittest``) — no pytest dependency. Run from
``clients/python``::

    python3 -m unittest discover -s tests -t .

Daemon tests are red until ``bin/index.js`` exists (tests-first); the
``make_candidate`` unit test needs no daemon and stays green. If no ``node``
binary exists at all, daemon tests skip (environmental, not our code).
"""

from __future__ import annotations

import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guessit_next import GuessitNext, GuessitNextError, make_candidate

NEEDS_NODE = shutil.which("node") is None


def _candidate(name, **kw):
    return make_candidate(name, **kw)


@unittest.skipIf(NEEDS_NODE, "no node binary in PATH")
class DaemonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.g = GuessitNext()
        cls.g.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.g.close()

    # -- categorize ----------------------------------------------------
    def test_categorize_single_episode(self) -> None:
        r = self.g.categorize("Show Name S01E01.mkv")
        self.assertEqual(r["kind"], "episode")
        self.assertEqual((r["season"], r["episode"]), (1, 1))

    def test_categorize_collection(self) -> None:
        r = self.g.categorize("Show Name S01-S03 1080p")
        self.assertEqual(r["kind"], "collection")
        self.assertEqual(r["seasonRange"], [1, 3])
        self.assertEqual(r["seasonList"], [1, 2, 3])

    def test_categorize_resolution_trap_stays_season_batch(self) -> None:
        r = self.g.categorize("Show Name (2018) Season 1 - 720p - HDRip - x264")
        self.assertEqual(r["kind"], "season_batch")
        self.assertEqual(r["season"], 1)

    def test_categorize_movie_and_others(self) -> None:
        self.assertEqual(self.g.categorize("Some Movie 2023 1080p WEB-DL")["kind"], "movie")
        self.assertEqual(self.g.categorize("Random Garbage Name")["kind"], "others")

    def test_categorize_keys_locked(self) -> None:
        r = self.g.categorize("Show Name S01E01.mkv")
        self.assertEqual(sorted(r), [
            "episode", "episodeEnd", "isCompletePack", "kind",
            "season", "seasonEnd", "seasonList", "seasonRange",
        ])

    # -- extract_se ------------------------------------------------------
    def test_extract_se_range_preserved(self) -> None:
        r = self.g.extract_se("Show S01E01-E13 1080p")
        self.assertEqual((r["season"], r["episode"], r["episodeEnd"]), (1, 1, 13))

    def test_extract_se_codec_tail_is_nothing(self) -> None:
        r = self.g.extract_se("Show 1 x264 1080p")
        self.assertEqual((r["season"], r["episode"]), (None, None))

    # -- classify_file ---------------------------------------------------
    def test_classify_file_series(self) -> None:
        r = self.g.classify_file(_candidate("[RlsGrp] Show - S01E02.mkv"))
        self.assertEqual((r["type"], r["season"], r["episode"]), ("series", 1, 2))
        self.assertEqual(r["confidence"], 0.9)

    def test_classify_file_bare_episode_uses_folder_title(self) -> None:
        r = self.g.classify_file(_candidate(
            "10-Conclusion.mkv",
            container_path="/data/torrents/Neutral Show",
            relative_path="10-Conclusion.mkv",
            file_size=1024,
        ))
        self.assertEqual(r["type"], "series")
        self.assertEqual(r["title"], "Neutral Show")
        self.assertEqual((r["episode"], r["episode_title"]), (10, "Conclusion"))

    def test_classify_file_movie_and_extra(self) -> None:
        movie = self.g.classify_file(_candidate("Show Name (2023).mkv"))
        self.assertEqual((movie["type"], movie["title"], movie["year"]), ("movie", "Show Name", 2023))
        extra = self.g.classify_file(_candidate("[RlsGrp] Show - sample.mkv"))
        self.assertEqual((extra["type"], extra["extra_type"]), ("extra", "sample"))

    def test_classify_file_range_keeps_episode_end(self) -> None:
        r = self.g.classify_file(_candidate("Show.S01E01-E13.1080p.mkv"))
        self.assertEqual((r["type"], r["season"], r["episode"], r["episodeEnd"]), ("series", 1, 1, 13))

    def test_classify_file_keys_locked(self) -> None:
        r = self.g.classify_file(_candidate("Show Name - S01E01.mkv"))
        self.assertEqual(sorted(r), [
            "confidence", "episode", "episodeEnd", "episode_title", "extra_type",
            "reason", "season", "series_alias", "title", "type", "year",
        ])

    def test_classify_file_never_emits_skip(self) -> None:
        for name in ("[RlsGrp] Show - S01E01.mkv", "Show Name.mkv", "[RlsGrp] Show - sample.mkv"):
            r = self.g.classify_file(_candidate(name, file_size=1024))
            self.assertIn(r["type"], ("series", "movie", "extra"))

    def test_classify_file_series_aliases(self) -> None:
        r = self.g.classify_file(
            _candidate("[RlsGrp] Pale Cat - 05.mkv"),
            series_aliases={"Pale Cat": "Midnight Cat Pale Cat"},
        )
        self.assertEqual(r["title"], "Midnight Cat Pale Cat")

    # -- classify_files ----------------------------------------------------
    def test_classify_files_folder_agreement(self) -> None:
        container = "/data/torrents/[RlsGrp] Show Name S01 1080p WEB-DL"
        out = self.g.classify_files([
            _candidate("[RlsGrp] Show Name - S01E01.mkv", container_path=container,
                       relative_path="[RlsGrp] Show Name - S01E01.mkv"),
            _candidate("[RlsGrp] Show Name - S01E02.mkv", container_path=container,
                       relative_path="[RlsGrp] Show Name - S01E02.mkv"),
            _candidate("[RlsGrp] Show Name - OP.mkv", container_path=container,
                       relative_path="[RlsGrp] Show Name - OP.mkv"),
        ])
        self.assertEqual(len(out["results"]), 3)
        (group,) = out["groups"]
        self.assertEqual((group["title"], group["type"]), ("Show Name", "series"))
        self.assertEqual(group["seasons"], [1])
        self.assertEqual(group["episodesBySeason"], {"1": [1, 2]})
        self.assertTrue(group["consistent"])

    def test_classify_files_empty(self) -> None:
        self.assertEqual(self.g.classify_files([]), {"results": [], "groups": []})


class MakeCandidateTest(unittest.TestCase):
    """No daemon needed — always green."""

    def test_candidate_field_names(self) -> None:
        c = make_candidate(
            "10-Conclusion.mkv",
            container_path="/data/torrents/Neutral Show",
            relative_path="10-Conclusion.mkv",
            file_size=1024,
        )
        self.assertEqual(c, {
            "source_root_key": "downloads_0",
            "source_root": "/data/downloads",
            "source_path": "/data/torrents/Neutral Show/10-Conclusion.mkv",
            "name": "10-Conclusion.mkv",
            "extension": ".mkv",
            "container_path": "/data/torrents/Neutral Show",
            "relative_path": "10-Conclusion.mkv",
            "file_size": 1024,
            "in_progress": False,
        })

    def test_missing_daemon_raises_guessit_next_error(self) -> None:
        g = GuessitNext(bin_path="/nonexistent/bin/index.js")
        with self.assertRaises(GuessitNextError):
            g.categorize("Show Name S01E01.mkv")


if __name__ == "__main__":
    unittest.main()
