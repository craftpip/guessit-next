"""guessit-next Python client: talk to the Node stdio daemon.

One client = one daemon process (``node bin/index.js --serve --json``),
which is the "one process per scan" shape the Python consumer uses.
Stdlib only — no third-party dependencies.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any


class GuessitNextError(RuntimeError):
    """The daemon died, or spoke something that is not our protocol."""


def _default_bin() -> Path:
    # .../clients/python/guessit_next/client.py -> parents[3] is the
    # project root -> bin/index.js
    return Path(__file__).resolve().parents[3] / "bin" / "index.js"


class GuessitNext:
    """Thin wrapper over the guessit-next stdio daemon.

    Usage::

        with GuessitNext() as g:
            g.categorize("Show Name S01E01.mkv")
            # -> {"kind": "episode", "season": 1, "episode": 1, ...}
    """

    def __init__(
        self,
        bin_path: str | Path | None = None,
        node: str = "node",
        series_aliases: dict[str, str] | None = None,
    ) -> None:
        self.bin_path = Path(bin_path) if bin_path is not None else _default_bin()
        self.node = node
        self.series_aliases = series_aliases or {}
        self._lock = threading.Lock()
        self._proc: subprocess.Popen[str] | None = None

    # -- lifecycle ------------------------------------------------------
    def start(self) -> "GuessitNext":
        if self._proc is not None:
            return self
        if shutil.which(self.node) is None:
            raise GuessitNextError(f"node executable not found: {self.node!r}")
        if not self.bin_path.is_file():
            raise GuessitNextError(f"daemon entry not found: {self.bin_path}")
        try:
            self._proc = subprocess.Popen(
                [self.node, str(self.bin_path), "--serve", "--json"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except OSError as exc:
            raise GuessitNextError(f"could not spawn daemon: {exc}") from exc
        return self

    def close(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None:
            return
        try:
            if proc.stdin:
                proc.stdin.close()
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        finally:
            if proc.stderr:
                proc.stderr.close()
            if proc.stdout:
                proc.stdout.close()

    def __enter__(self) -> "GuessitNext":
        return self.start()

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # -- protocol --------------------------------------------------------
    def _call(self, payload: dict[str, Any]) -> Any:
        self.start()
        assert self._proc is not None and self._proc.stdin is not None and self._proc.stdout is not None
        line = json.dumps(payload) + "\n"
        with self._lock:
            try:
                self._proc.stdin.write(line)
                self._proc.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                raise GuessitNextError(f"daemon stdin broken: {exc}") from exc
            response = self._proc.stdout.readline()
        if response == "":
            raise GuessitNextError(f"daemon exited (rc={self._proc.poll()}) while handling {payload.get('op')}")
        try:
            return json.loads(response)
        except json.JSONDecodeError as exc:
            raise GuessitNextError(f"daemon spoke non-JSON: {response!r}") from exc

    # -- API (mirrors src/index.js 1:1) -----------------------------------
    def categorize(self, name: str) -> dict[str, Any]:
        """One torrent/release name -> kind + markers."""
        return self._call({"op": "categorize", "name": name})

    def extract_se(self, name: str) -> dict[str, Any]:
        """Season/episode structure, ranges preserved."""
        return self._call({"op": "extractSE", "name": name})

    def classify_file(
        self,
        candidate: dict[str, Any],
        series_aliases: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """One library file -> series | movie | extra."""
        return self._call({
            "op": "classifyFile",
            "candidate": candidate,
            "seriesAliases": series_aliases if series_aliases is not None else self.series_aliases,
        })

    def classify_files(
        self,
        candidates: list[dict[str, Any]],
        series_aliases: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Many related files -> {"results": [...], "groups": [...]}."""
        return self._call({
            "op": "classifyFiles",
            "candidates": candidates,
            "seriesAliases": series_aliases if series_aliases is not None else self.series_aliases,
        })


def make_candidate(
    name: str,
    *,
    source_root: str = "/data/downloads",
    container_path: str | None = None,
    relative_path: str | None = None,
    file_size: int | None = None,
) -> dict[str, Any]:
    """Build a classifyFile candidate dict with the contract's field names."""
    base = container_path if container_path is not None else source_root
    leaf = relative_path if relative_path is not None else name
    return {
        "source_root_key": "downloads_0",
        "source_root": source_root,
        "source_path": f"{base}/{leaf}",
        "name": name,
        "extension": name[name.rfind("."):] if "." in name else None,
        "container_path": container_path,
        "relative_path": relative_path,
        "file_size": file_size,
        "in_progress": False,
    }
