#!/usr/bin/env node

// guessit-next CLI — the surface both consumers shell out to.
//
//   --json '<name>'        categorize one torrent name
//   --json-file '<path>'   classifyFile one library file
//                           [--root '<root>']  derive container/relative paths
//   --batch                stdin JSON-lines of { op, ... }; one JSON result per
//                          line on stdout, until EOF
//   --serve [--json]       same ops as --batch, looped until EOF
//
// ops: { op: "categorize", name } | { op: "extractSE", name } |
//      { op: "classifyFile", candidate, seriesAliases? } |
//      { op: "classifyFiles", candidates, seriesAliases? }

import process from 'node:process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve, relative } from 'node:path';
import { categorize, extractSE, classifyFile, classifyFiles } from '../src/index.js';

function buildCandidate(filePath, root) {
  const sourceRoot = root ? resolve(root) : dirname(filePath);
  const container = dirname(filePath);
  const inSubfolder = container !== sourceRoot;
  return {
    source_root_key: 'cli',
    source_root: sourceRoot,
    source_path: filePath,
    name: basename(filePath),
    extension: extname(filePath) || null,
    container_path: inSubfolder ? container : null,
    relative_path: inSubfolder ? relative(container, filePath) : null,
    file_size: null,
    in_progress: false,
  };
}

function opResult(obj) {
  switch (obj.op) {
    case 'categorize':
      return categorize(obj.name);
    case 'extractSE':
      return extractSE(obj.name);
    case 'classifyFile':
      return classifyFile(obj.candidate, { seriesAliases: obj.seriesAliases || null });
    case 'classifyFiles':
      return classifyFiles(obj.candidates || [], { seriesAliases: obj.seriesAliases || null });
    default:
      return { error: `unknown op: ${obj.op}` };
  }
}

function respond(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function serve() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const raw of lines) {
    if (!raw || !raw.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      respond({ error: 'invalid JSON' });
      continue;
    }
    respond(opResult(obj));
  }
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--serve')) {
    await serve();
    return;
  }

  if (args.includes('--batch')) {
    const input = readFileSync(0, 'utf8');
    for (const raw of input.split('\n')) {
      if (!raw || !raw.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        respond({ error: 'invalid JSON' });
        continue;
      }
      respond(opResult(obj));
    }
    process.exit(0);
  }

  const jsonAt = args.indexOf('--json');
  if (jsonAt !== -1) {
    const name = args[jsonAt + 1];
    respond(categorize(name));
    process.exit(0);
  }

  const jsonFileAt = args.indexOf('--json-file');
  if (jsonFileAt !== -1) {
    const filePath = args[jsonFileAt + 1];
    const rootAt = args.indexOf('--root');
    const root = rootAt !== -1 ? args[rootAt + 1] : null;
    respond(classifyFile(buildCandidate(filePath, root)));
    process.exit(0);
  }

  process.stderr.write('usage: node bin/index.js --json <name> | --json-file <path> [--root <root>] | --batch | --serve [--json]\n');
  process.exit(2);
}

main();