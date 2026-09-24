import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { categorize, classifyFile, classifyFiles, extractSE } from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════════════
//  JSON FIELD CONTRACT — the public interface both consumers program against
// ═══════════════════════════════════════════════════════════════════════════
//  Any change to these field sets is a BREAKING contract change: it needs a
//  contract update + consumer migration, never a silent edit. This file pins:
//
//  1. the EXACT key set of every result object (no more, no less — a renamed,
//     added or dropped field fails here first);
//  2. the bin/index.js CLI surface both consumers shell out to:
//       --json '<name>'        → categorize one torrent name
//       --json-file '<path>'   → classifyFile one library file
//       --batch                → stdin JSON-lines of { op, ... }, one JSON
//                                result per line on stdout
//       --serve [--json]       → stdio daemon (one process per scan), same
//                                ops as --batch, looped until EOF
//     ops: { op: "categorize", name } | { op: "classifyFile", candidate } |
//          { op: "classifyFiles", candidates }
// ───────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BIN = join(ROOT, 'bin', 'index.js');

function keysOf(obj) {
  return Object.keys(obj).sort();
}

describe('field contract — exact key sets', () => {
  it('categorize result keys are locked', () => {
    const r = categorize('Show Name S01E01.mkv');
    assert.deepEqual(keysOf(r), [
      'episode', 'episodeEnd', 'isCompletePack', 'kind',
      'season', 'seasonEnd', 'seasonList', 'seasonRange',
    ]);
  });

  it('extractSE result keys are locked', () => {
    const r = extractSE('Show Name S01E01.mkv');
    assert.deepEqual(keysOf(r), [
      'episode', 'episodeEnd', 'season', 'seasonEnd', 'seasonList', 'seasonRange',
    ]);
  });

  it('classifyFile result keys are locked (incl. additive episodeEnd)', () => {
    const r = classifyFile({
      source_root_key: 'downloads_0',
      source_root: '/data/downloads',
      source_path: '/data/downloads/Show Name - S01E01.mkv',
      name: 'Show Name - S01E01.mkv',
      extension: '.mkv',
      container_path: null,
      relative_path: null,
      file_size: null,
      in_progress: false,
    });
    assert.deepEqual(keysOf(r), [
      'confidence', 'episode', 'episode_title', 'episodeEnd', 'extra_type',
      'reason', 'season', 'series_alias', 'title', 'type', 'year',
    ]);
  });

  it('classifyFiles envelope and group keys are locked', () => {
    const out = classifyFiles([]);
    assert.deepEqual(keysOf(out), ['groups', 'results']);
    const out2 = classifyFiles([{
      source_root_key: 'downloads_0',
      source_root: '/data/downloads',
      source_path: '/data/downloads/Some Movie (2020).mkv',
      name: 'Some Movie (2020).mkv',
      extension: '.mkv',
      container_path: null,
      relative_path: null,
      file_size: null,
      in_progress: false,
    }]);
    assert.equal(out2.groups.length, 1);
    assert.deepEqual(keysOf(out2.groups[0]), [
      'conflicts', 'consistent', 'episodeFileCount', 'episodesBySeason',
      'extraFileCount', 'fileCount', 'key', 'seasons', 'title', 'type',
    ]);
  });
});

describe('bin/index.js — CLI surface', () => {
  it('--json categorizes one torrent name', () => {
    const p = spawnSync('node', [BIN, '--json', 'Show Name S01E01.mkv'], { encoding: 'utf8' });
    assert.equal(p.status, 0, `stderr: ${p.stderr}`);
    const r = JSON.parse(p.stdout);
    assert.equal(r.kind, 'episode');
    assert.equal(r.season, 1);
    assert.equal(r.episode, 1);
  });

  it('--json-file classifies one library file', () => {
    const p = spawnSync(
      'node',
      [BIN, '--json-file', '/data/torrents/Neutral Show/10-Conclusion.mkv', '--root', '/data/torrents'],
      { encoding: 'utf8' },
    );
    assert.equal(p.status, 0, `stderr: ${p.stderr}`);
    const r = JSON.parse(p.stdout);
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Neutral Show');
    assert.equal(r.episode, 10);
  });

  it('--batch answers one JSON result per input line', () => {
    const input = [
      JSON.stringify({ op: 'categorize', name: 'Show Name S01-S03 1080p' }),
      JSON.stringify({
        op: 'classifyFile',
        candidate: {
          source_root_key: 'downloads_0',
          source_root: '/data/downloads',
          source_path: '/data/downloads/Show Name (2023).mkv',
          name: 'Show Name (2023).mkv',
          extension: '.mkv',
          container_path: null,
          relative_path: null,
          file_size: null,
          in_progress: false,
        },
      }),
    ].join('\n') + '\n';
    const p = spawnSync('node', [BIN, '--batch'], { input, encoding: 'utf8' });
    assert.equal(p.status, 0, `stderr: ${p.stderr}`);
    const lines = p.stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].kind, 'collection');
    assert.equal(lines[1].type, 'movie');
  });

  it('--serve answers ops until EOF', async () => {
    const child = spawn('node', [BIN, '--serve', '--json']);
    try {
      const firstLine = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('serve timed out waiting for response')), 10000);
        let buf = '';
        child.stdout.on('data', (chunk) => {
          buf += chunk;
          const nl = buf.indexOf('\n');
          if (nl !== -1) {
            clearTimeout(timer);
            resolve(buf.slice(0, nl));
          }
        });
        child.on('error', reject);
      });
      child.stdin.write(JSON.stringify({ op: 'categorize', name: 'Show Name S01E01.mkv' }) + '\n');
      const r = JSON.parse(await firstLine);
      assert.equal(r.kind, 'episode');
      assert.equal(r.episode, 1);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
