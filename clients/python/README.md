# guessit-next — Python client

Thin wrapper so Python code can use the guessit-next classifier. It spawns
the Node stdio daemon (`node bin/index.js --serve --json`) once per client
(one process per scan) and speaks JSON-lines over the pipe. Stdlib only.

```python
from guessit_next import GuessitNext, make_candidate

with GuessitNext() as g:  # bin path defaults to ../../bin/index.js
    g.categorize("Show Name S01E01.mkv")
    # {"kind": "episode", "season": 1, "episode": 1, ...}

    g.classify_file(make_candidate(
        "10-Conclusion.mkv",
        container_path="/data/torrents/Neutral Show",
        relative_path="10-Conclusion.mkv",
        file_size=1024,
    ))
    # {"type": "series", "title": "Neutral Show", "episode": 10, ...}

    g.classify_files([...])  # {"results": [...], "groups": [...]}
```

`GuessitNext(bin_path=..., node="node", series_aliases={...})` overrides the
daemon entry, the node binary, and the default alias map (per-call
`series_aliases=` wins). Daemon trouble raises `GuessitNextError`.

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

Daemon tests drive the real `bin/index.js` and are red until it exists
(tests-first); `MakeCandidateTest` needs no daemon and stays green.
