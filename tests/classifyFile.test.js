import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyFile } from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════════════
//  PER-FILE CLASSIFICATION GENES — classifyFile(candidate, opts?)
// ═══════════════════════════════════════════════════════════════════════════
//  Ported 1:1 from jellysort tests/test_classifier.py (which itself absorbed
//  the JellyJake-ported episode genes). Every behavior below is a gene: a
//  real-world case that once broke and now must stay green.
//
//  candidate = { source_root_key, source_root, source_path, name, extension,
//    container_path, relative_path, file_size, in_progress }
//  opts = { seriesAliases?: Record<string,string> }
//
//  Result: { type, title, episode_title, series_alias, year, season, episode,
//    episodeEnd, confidence, reason, extra_type }
//    type: series | movie | extra   (NEVER skip — skip is orchestrator-side,
//          assigned by the consuming scanner for low-confidence/in-progress/
//          non-media files, never by the classifier)
//    episode: ranges collapse to the START episode (single-file semantics);
//          episodeEnd preserves the range end (null for single episodes).
//
//  Kind/confidence ladder (shared core, pinned here):
//    explicit episode      → series, 0.9,  "Matched episode/season pattern"
//    season only           → series, 0.8,  "Matched season pattern"
//    year, no S/E          → movie,  0.75, "Matched year without season/episode"
//    standalone default    → movie,  0.65, "Defaulted standalone file to movie"
//    small movie, no marker→ movie + " (small file; sample-size suspect)"
//    extra marker          → extra,  ≥0.85, "Detected <extra_type> extra/special marker"
//    sample marker         → extra/sample, ≥0.85
//
//  OBFUSCATION: all real titles/groups from the Python suite are replaced
//  with neutral placeholders (formatting tokens kept identical). The one
//  real-title regression case from the Python suite is INTENTIONALLY dropped
//  here — only its obfuscated twin is kept (same shape, same fix). Real
//  titles never appear in this repo.
// ───────────────────────────────────────────────────────────────────────────

function _candidate(name, { container_path = null, relative_path = null, file_size = null } = {}) {
  return {
    source_root_key: 'downloads_0',
    source_root: '/data/downloads',
    source_path: `/data/downloads/${name}`,
    name,
    extension: name.includes('.') ? name.slice(name.lastIndexOf('.')) : null,
    container_path,
    relative_path,
    file_size,
    in_progress: false,
  };
}

describe('classifyFile — series episodes', () => {
  it('SxxEyy pattern', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show - S01E02.mkv'));
    assert.equal(r.type, 'series');
    assert.equal(r.season, 1);
    assert.equal(r.episode, 2);
    assert.equal(r.episodeEnd, null);
    assert.equal(r.confidence, 0.9);
  });

  it('anime bare number without season defaults to series', () => {
    const r = classifyFile(_candidate('[RlsGrp] Weird Show - 01.mkv'));
    assert.equal(r.type, 'series');
    assert.equal(r.episode, 1);
  });

  it('SxxEyy with revision suffix', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show - S03E02v2.mkv'));
    assert.deepEqual([r.type, r.season, r.episode], ['series', 3, 2]);
  });

  it('multi-digit episode with revision suffix', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show - S03E10v3.mkv'));
    assert.deepEqual([r.type, r.season, r.episode], ['series', 3, 10]);
  });

  it('Sxx dash episode pattern', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show S2 - 02.mkv'));
    assert.deepEqual([r.type, r.season, r.episode], ['series', 2, 2]);
  });

  it('season word dash episode', () => {
    const r = classifyFile(_candidate('Show Name Season 02 - 12.mkv'));
    assert.deepEqual([r.type, r.season, r.episode], ['series', 2, 12]);
  });

  it('alternative title becomes series_alias', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show Name - Future Arc - S04E01v2.mkv'));
    assert.equal(r.type, 'series');
    assert.equal(r.season, 4);
    assert.equal(r.series_alias, 'Future Arc');
  });

  it('episode title becomes series_alias when no season exists', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show Name - Future Arc - 25.mkv'));
    assert.equal(r.type, 'series');
    assert.equal(r.season, null);
    assert.equal(r.episode, 25);
    assert.equal(r.series_alias, 'Future Arc');
  });

  it('season comes from folder when missing in filename', () => {
    const r = classifyFile(_candidate('Show Name - 03.mkv', {
      container_path: '/data/torrents/Any Name',
      relative_path: 'Season 04/Show Name - 03.mkv',
    }));
    assert.deepEqual([r.type, r.season, r.episode], ['series', 4, 3]);
  });

  it('bare numbered episode in show folder uses folder as series title', () => {
    const r = classifyFile(_candidate('10-Conclusion.mkv', {
      container_path: '/data/torrents/Neutral Show',
      relative_path: '10-Conclusion.mkv',
      file_size: 1024,
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Neutral Show');
    assert.equal(r.episode_title, 'Conclusion');
    assert.equal(r.episode, 10);
  });

  it('single-digit bare episode is not sampled as movie', () => {
    const r = classifyFile(_candidate('1-Stranger.mkv', {
      container_path: '/data/torrents/Neutral Show',
      relative_path: '1-Stranger.mkv',
      file_size: 1024,
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Neutral Show');
    assert.equal(r.episode_title, 'Stranger');
    assert.equal(r.episode, 1);
  });

  it('dot-separated bare episode still works', () => {
    const r = classifyFile(_candidate('4.The.Conclusion.mkv', {
      container_path: '/data/torrents/Neutral Show',
      relative_path: '4.The.Conclusion.mkv',
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Neutral Show');
    assert.equal(r.episode, 4);
  });

  it('episode range collapses to start episode, preserves episodeEnd', () => {
    const r = classifyFile(_candidate('Show.S01E01-E13.1080p.mkv'));
    assert.deepEqual([r.type, r.season, r.episode, r.episodeEnd], ['series', 1, 1, 13]);
  });

  it('episode with year in title is not confused as movie', () => {
    const r = classifyFile(_candidate('Show 2025 - S01E01.mkv'));
    assert.deepEqual([r.type, r.season, r.episode], ['series', 1, 1]);
  });

  it('year-dash season keeps season, drops episode', () => {
    const r = classifyFile(_candidate('Gloom - Season 2 S02 - 2019 - 1080p - NF WEB-DL.mkv'));
    assert.equal(r.type, 'series');
    assert.equal(r.season, 2);
    assert.equal(r.episode, null);
  });

  it('resolution-dash season keeps season, drops episode', () => {
    const r = classifyFile(_candidate('Show Season 1 - 720p.mkv'));
    assert.equal(r.season, 1);
    assert.equal(r.episode, null);
  });

  it('season-only file is series with season confidence', () => {
    const r = classifyFile(_candidate('Show S02 1080p.mkv'));
    assert.equal(r.type, 'series');
    assert.equal(r.season, 2);
    assert.equal(r.episode, null);
    assert.equal(r.confidence, 0.8);
    assert.match(r.reason, /season/i);
  });
});

describe('classifyFile — movies', () => {
  it('movie with year', () => {
    const r = classifyFile(_candidate('Show Name (2023).mkv'));
    assert.equal(r.type, 'movie');
    assert.equal(r.title, 'Show Name');
    assert.equal(r.year, 2023);
    assert.equal(r.season, null);
    assert.equal(r.episode, null);
  });

  it('movie without year defaults to movie', () => {
    const r = classifyFile(_candidate('Show The Movie.mkv'));
    assert.equal(r.type, 'movie');
  });

  it('standalone tagged file without episode marker defaults to movie', () => {
    const r = classifyFile(_candidate('[RlsGrp] Lonely Ballad [838F149B].mkv'));
    assert.equal(r.type, 'movie');
    assert.equal(r.season, null);
    assert.equal(r.episode, null);
  });

  it('movie with leading number in title folder stays movie', () => {
    const r = classifyFile(_candidate('3 Fools (2009).mkv', {
      container_path: '/data/downloads/3 Fools (2009)',
      relative_path: '3 Fools (2009).mkv',
    }));
    assert.equal(r.type, 'movie');
    assert.equal(r.title, '3 Fools');
    assert.equal(r.year, 2009);
    assert.equal(r.season, null);
    assert.equal(r.episode, null);
  });

  it('movie with leading number and tech tags stays movie', () => {
    const r = classifyFile(_candidate('3.Fools.2009.1080p.BluRay.mkv', {
      container_path: '/data/downloads/3 Fools (2009)',
      relative_path: '3.Fools.2009.1080p.BluRay.mkv',
    }));
    assert.equal(r.type, 'movie');
    assert.equal(r.title, '3 Fools');
    assert.equal(r.year, 2009);
    assert.equal(r.episode, null);
  });

  it('decimal number prefix is not a bare episode', () => {
    const r = classifyFile(_candidate(
      '2.5.Crumpled.Staircase.2021.S01E01.REPACK2.BDRip-1080p.x265.FLAC.EAC3.Dual.Audio-RlsGrp.mkv',
      {
        container_path: '/data/downloads/2.5 Crumpled Staircase (2021) S01 [BDRip 1080p x265 FLAC EAC3 Dual-Audio]-RlsGrp',
        relative_path: '2.5.Crumpled.Staircase.2021.S01E01.REPACK2.BDRip-1080p.x265.FLAC.EAC3.Dual.Audio-RlsGrp.mkv',
      },
    ));
    assert.equal(r.type, 'series');
    assert.equal(r.title, '2.5 Crumpled Staircase (2021)');
    assert.equal(r.season, 1);
    assert.equal(r.episode, 1);
    assert.equal(r.episode_title, null);
  });

  it('movie with special characters', () => {
    const r = classifyFile(_candidate('Show Name: Subtitle (2021).mkv'));
    assert.equal(r.type, 'movie');
    assert.equal(r.year, 2021);
  });

  it('small movie-size file with no sample marker stays movie (suspect flagged)', () => {
    // The orchestrator flags it sample-suspect; only a real `sample` marker
    // routes to samples/. The file itself stays an editable movie.
    const r = classifyFile(_candidate('Show Name.mkv', { file_size: 1024 }));
    assert.equal(r.type, 'movie');
    assert.match(r.reason, /sample-size suspect/);
  });
});

describe('classifyFile — extras', () => {
  it('OVA is extra', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show - OVA.mkv'));
    assert.equal(r.type, 'extra');
    assert.match(r.reason.toLowerCase(), /extras|special/);
  });

  it('NCED / NCOP are extra', () => {
    assert.equal(classifyFile(_candidate('NCED.mkv')).type, 'extra');
    assert.equal(classifyFile(_candidate('NCOP.mkv')).type, 'extra');
  });

  it('OVA in subfolder is extra', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show - OVA.mkv', {
      container_path: '/data/torrents/[RlsGrp] Show (Season 2)',
      relative_path: '[RlsGrp] Show - OVA.mkv',
    }));
    assert.equal(r.type, 'extra');
  });

  it('extra marker in episode title is extra', () => {
    assert.equal(classifyFile(_candidate('[RlsGrp] Show - S01E01 - NCED.mkv')).type, 'extra');
  });

  it('bonus recap is extra', () => {
    const r = classifyFile(_candidate('Neutral Show - Bonus - Recap 18.5.mkv', {
      container_path: '/data/torrents/Neutral Show [1080p;H265] (2002)',
      relative_path: 'Neutral Show - Bonus - Recap 18.5.mkv',
    }));
    assert.equal(r.type, 'extra');
  });

  it('featurette is extra, incl. in folder', () => {
    const a = classifyFile(_candidate('Neutral Show - Featurettes - Behind the Scenes.mkv', {
      container_path: '/data/torrents/Neutral Show [1080p;H265] (2002)',
      relative_path: 'Neutral Show - Featurettes - Behind the Scenes.mkv',
    }));
    assert.equal(a.type, 'extra');
    const b = classifyFile(_candidate('Behind the Scenes [Featurettes].mkv', {
      container_path: '/data/torrents/Neutral Show - Featurettes (2002)',
      relative_path: 'Neutral Show - Featurettes/Behind the Scenes [Featurettes].mkv',
    }));
    assert.equal(b.type, 'extra');
  });

  it('decimal SP episode is extra', () => {
    const r = classifyFile(_candidate('S01E13.5 [SP]-To Cheer Everyone Up with My Song [8D781429].mkv', {
      container_path: '/data/torrents/Neutral Show S01+SP 1080p Dual Audio BDRip 10 bits DD x265-RlsGrp',
      relative_path: 'S01E13.5 [SP]-To Cheer Everyone Up with My Song [8D781429].mkv',
    }));
    assert.equal(r.type, 'extra');
  });

  it('underscore-joined extra markers are extra', () => {
    for (const name of ['Show - NCED_DVD_Version.mkv', 'Show - NCOP_1080p.mkv', 'Show_Extras_Bonus.mkv']) {
      const r = classifyFile(_candidate(name, { file_size: 75 * 1024 * 1024 }));
      assert.equal(r.type, 'extra', name);
    }
  });

  it('underscore-joined sample is sample extra', () => {
    const r = classifyFile(_candidate('Show - file_sample.mkv', { file_size: 75 * 1024 * 1024 }));
    assert.equal(r.type, 'extra');
    assert.equal(r.extra_type, 'sample');
  });

  it('short marker inside a word is not extra', () => {
    for (const name of ['spider.mkv', 'space.mkv']) {
      assert.notEqual(classifyFile(_candidate(name, { file_size: 75 * 1024 * 1024 })).type, 'extra', name);
    }
  });

  it('sample by keyword is extra sample', () => {
    const r = classifyFile(_candidate('[RlsGrp] Show - sample.mkv'));
    assert.equal(r.type, 'extra');
    assert.equal(r.extra_type, 'sample');
  });

  it('bundle nested OST is extra of the bundle show', () => {
    const r = classifyFile(_candidate('01 - Theme.mkv', {
      container_path: '/data/torrents/[RlsGrp]_Velvet_Prince!_Ep1-12_+_Extras_&_OST_[1080p_Blu-ray_FLAC]',
      relative_path: 'OST/01 - Theme.mkv',
    }));
    assert.equal(r.type, 'extra');
    assert.equal(r.title, 'Velvet Prince!');
    assert.equal(r.extra_type, 'special');
  });

  it('bundle root episode keeps series with bundle title', () => {
    const r = classifyFile(_candidate('Velvet Prince! - 05.mkv', {
      container_path: '/data/torrents/[RlsGrp]_Velvet_Prince!_Ep1-12_+_Extras_&_OST_[1080p_Blu-ray_FLAC]',
      relative_path: 'Velvet Prince! - 05.mkv',
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Velvet Prince!');
    assert.equal(r.season, null);
    assert.equal(r.episode, 5);
  });

  it('bundle declares extras only when the signal is present', () => {
    // No extras/OST signal in the container name → no bundle override.
    const r = classifyFile(_candidate('01 - Theme.mkv', {
      container_path: '/data/torrents/[RlsGrp] Velvet Prince! Ep1-12 [1080p_Blu-ray_FLAC]',
      relative_path: '01 - Theme.mkv',
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.episode, 1);
  });
});

describe('classifyFile — titles and aliases', () => {
  it('episode prefers fuller container title', () => {
    const r = classifyFile(_candidate('[RlsGrp] Alley Cat - S01E01.mkv', {
      container_path: '/data/torrents/[RlsGrp] Alley Cat of the Dunes (Roaming Star) (Season 01)',
      relative_path: '[RlsGrp] Alley Cat - S01E01.mkv',
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Alley Cat of the Dunes (Roaming Star)');
  });

  it('folder underscore numeric junk does not override clean title', () => {
    const r = classifyFile(_candidate('[RlsGrp] Nimbus (2020) - S02E01.mkv', {
      container_path: '/data/downloads/[RlsGrp] Nimbus 7_9 (2020) (Season 02) [1080p][HEVC x265 10bit][Dual-Audio][Multi-Subs]',
      relative_path: '[RlsGrp] Nimbus (2020) - S02E01.mkv',
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Nimbus');
    assert.equal(r.season, 2);
    assert.equal(r.episode, 1);
  });

  it('foreign episode word splits out of series title', () => {
    const r = classifyFile(_candidate(
      'S01E04 The Hollow in the Mist Episodio 04 Iron Chorus (2026) WEBRip 1080p x264 EAC3 ITA ENG JPN SUB ITA ENG - RlsGrp.mkv',
    ));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'The Hollow in the Mist');
    assert.equal(r.episode_title, 'Iron Chorus');
    assert.equal(r.season, 1);
    assert.equal(r.episode, 4);
  });

  it('series title alias maps to canonical name', () => {
    const r = classifyFile(
      _candidate('[RlsGrp] Pale Cat - 05 [WebRip 1080p HEVC-10bit AAC SRTx2].mkv'),
      { seriesAliases: { 'Pale Cat': 'Midnight Cat Pale Cat' } },
    );
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Midnight Cat Pale Cat');
    assert.equal(r.episode_title, 'Midnight Cat Pale Cat');
    assert.equal(r.episode, 5);
  });

  it('series title alias not applied when nothing matches', () => {
    const r = classifyFile(
      _candidate('[RlsGrp] Pale Cat - 05 [WebRip 1080p HEVC-10bit AAC SRTx2].mkv'),
      { seriesAliases: { Nope: 'Other Show' } },
    );
    assert.equal(r.title, 'Pale Cat');
  });

  it('series number marker is episode, not sample', () => {
    // "Neutral Show Series 1" is episode 1 via the foreign-episode path, so
    // the size-based sample suspect (movies only) never fires.
    const r = classifyFile(_candidate('Neutral Show Series 1 Subbed [RlsGrp].mp4', {
      container_path: '/data/downloads/Neutral Show Series',
      relative_path: 'Neutral Show Series/Neutral Show Series 1 Subbed [RlsGrp].mp4',
      file_size: 145 * 1024 * 1024,
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.title, 'Neutral Show Series');
    assert.equal(r.episode, 1);
  });

  it('series marker ignores four-digit year', () => {
    const r = classifyFile(_candidate('Neutral Show Series 2020.mkv', {
      container_path: '/data/downloads/Neutral Show Series',
      relative_path: 'Neutral Show Series/Neutral Show Series 2020.mkv',
    }));
    assert.equal(r.episode, null);
  });

  it('complete collection folder with season range is stripped to show title', () => {
    const container = '/data/downloads/EIDOLON (2018-2019) - Complete LEGEND Prequel TV Series, Season 1-2 S01-S02 - 720p AMZN Web-DL x264';
    const cases = [
      ['EIDOLON - S01 E02 - House of EL (720p - AMZN Web-DL).mp4', 'Season 1 (2018)/EIDOLON - S01 E02 - House of EL (720p - AMZN Web-DL).mp4', 1, 2, 'House of EL'],
      ['EIDOLON - S02 E01 - Light Years From Home (720p - AMZN Web-DL).mp4', 'Season 2 (2019)/EIDOLON - S02 E01 - Light Years From Home (720p - AMZN Web-DL).mp4', 2, 1, 'Light Years From Home'],
      ['EIDOLON - S01 E00 - The Making of a Legend (720p - Proper HDTV).mp4', 'Season 1 (2018)/EIDOLON - S01 E00 - The Making of a Legend (720p - Proper HDTV).mp4', 1, 0, 'The Making of a Legend'],
    ];
    for (const [name, rel, season, episode, epTitle] of cases) {
      const r = classifyFile(_candidate(name, { container_path: container, relative_path: rel }));
      assert.equal(r.type, 'series', `${name} should be series, got ${r.type} (${r.reason})`);
      assert.equal(r.title, 'EIDOLON', `${name} title ${JSON.stringify(r.title)} should be EIDOLON`);
      assert.equal(r.season, season, `${name} season ${r.season} != ${season}`);
      assert.equal(r.episode, episode, `${name} episode ${r.episode} != ${episode}`);
      assert.equal(r.episode_title, epTitle);
      for (const junk of ['Complete', 'LEGEND', 'Season 1-2', 'S01-S02', '720p']) {
        assert.ok(!(r.title || '').includes(junk), `${name} title contains ${junk}`);
      }
    }
    // NOTE: the Python suite also pins this with the real reported title.
    // It is intentionally NOT ported: real titles never appear in this repo.
    // The obfuscated twin above locks the same fix.
  });

  it('year in parens is not a season', () => {
    // "(2021)" must never become Season 2021 / S2021E01.
    const container = '/data/downloads/Clear Sky. The Animation (2021) [1080p-HEVC-WEBRip]';
    for (const ep of [1, 2]) {
      const r = classifyFile(_candidate(
        `Clear Sky. The Animation - ${String(ep).padStart(2, '0')} (2021) [1080p-HEVC-WEBRip][1CD227C7].mkv`,
        {
          container_path: container,
          relative_path: `Clear Sky. The Animation (2021) [1080p-HEVC-WEBRip]/Clear Sky. The Animation - ${String(ep).padStart(2, '0')} (2021) [1080p-HEVC-WEBRip][1CD227C7].mkv`,
        },
      ));
      assert.equal(r.type, 'series', `ep ${ep} should be series, got ${r.type} (${r.reason})`);
      assert.equal(r.year, 2021);
      assert.equal(r.episode, ep, `ep ${ep} got episode ${r.episode}`);
      assert.ok(r.season === null || r.season === 1, `ep ${ep} season must not be 2021, got ${r.season}`);
      assert.ok(!(r.title || '').replace('(2021)', '').includes('2021'));
    }
  });

  it('underscore-digit code prefix does not steal the episode', () => {
    // RIFT_2045 must not parse as S20E45/E2045; the real S01E10 wins.
    const container = '/media3/torrents/Hollow Mist RIFT_2045 S01 Complete 720p NF WEB-DL Dual Audio [Hindi + English] ESub x264 - RlsGrp';
    const a = classifyFile(_candidate(
      'Hollow.in.the.Mist.RIFT_2045.S01E10.NET.PEOPLE.-.Reasons.Leading.to.Flameout.720p.NF.WEB-DL.DD+2.0.x264-RlsGrp.mkv',
      {
        container_path: container,
        relative_path: 'Hollow.in.the.Mist.RIFT_2045.S01E10.NET.PEOPLE.-.Reasons.Leading.to.Flameout.720p.NF.WEB-DL.DD+2.0.x264-RlsGrp.mkv',
      },
    ));
    assert.equal(a.type, 'series');
    assert.equal(a.season, 1, `expected S01, got S${a.season}`);
    assert.equal(a.episode, 10, `expected E10, got E${a.episode}`);
    assert.ok(a.episode !== 204 && a.episode !== 2045 && a.season !== 20);
    const b = classifyFile(_candidate(
      'Hollow.in.the.Mist.RIFT_2045.S01E09.HIDDEN.TRUTH.-.The.Quiet.Struggle.720p.NF.WEB-DL.DD+2.0.x264-RlsGrp.mkv',
      {
        container_path: container,
        relative_path: 'Hollow.in.the.Mist.RIFT_2045.S01E09.HIDDEN.TRUTH.-.The.Quiet.Struggle.720p.NF.WEB-DL.DD+2.0.x264-RlsGrp.mkv',
      },
    ));
    assert.equal(b.season, 1);
    assert.equal(b.episode, 9);
  });

  it('season-only folder with no relative path uses the parent', () => {
    const r = classifyFile({
      source_root_key: 'downloads_0',
      source_root: '/data/torrents',
      source_path: '/data/torrents/Show Name Season 02/Some File.mkv',
      name: 'Some File.mkv',
      extension: '.mkv',
      container_path: null,
      relative_path: null,
      file_size: null,
      in_progress: false,
    });
    assert.equal(r.type, 'series');
    assert.equal(r.season, 2);
  });

  it('season in relative-path subfolder', () => {
    const r = classifyFile(_candidate('Some File.mkv', {
      container_path: '/data/torrents/Container Name',
      relative_path: 'Season 02/Some File.mkv',
    }));
    assert.equal(r.type, 'series');
    assert.equal(r.season, 2);
  });
});

describe('classifyFile — classifier never emits skip', () => {
  it('every input shape stays within series/movie/extra', () => {
    const inputs = [
      _candidate('[RlsGrp] Show - S01E01.mkv', { file_size: 1024 }),
      _candidate('Show Name.mkv', { file_size: 1024 }),
      _candidate('Show Name (2023).mkv', { file_size: 1 }),
      _candidate('[RlsGrp] Show - sample.mkv'),
      _candidate('Some File.mkv'),
      _candidate('10-Conclusion.mkv', { container_path: '/data/torrents/Neutral Show', relative_path: '10-Conclusion.mkv' }),
    ];
    for (const c of inputs) {
      const r = classifyFile(c);
      assert.ok(['series', 'movie', 'extra'].includes(r.type), `${c.name} emitted ${r.type}`);
    }
  });
});

// ── shared corpus regression ─────────────────────────────────────────────
// Reads the user's personally-maintained corpus at scratch/corpus.json
// (seeded verbatim from jellysort tests/corpus/download_paths.json, already
// obfuscated there). scratch/ is gitignored and NEVER committed — the user
// adds to it; the suite simply refers to it. If absent (fresh checkout),
// this block skips instead of failing.

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(HERE, '..', 'scratch', 'corpus.json');
const CORPUS = existsSync(CORPUS_PATH) ? JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) : null;

const RELEASE_JUNK_TOKENS = [
  '1080p', '720p', '2160p', 'x265', 'hevc', 'x264', 'av1',
  'flac', 'eac3', 'aac', 'opus', 'ddp', 'dual-audio', 'dual audio',
  'bdrip', 'bluray', 'webrip', 'web-dl', 'multi-subs',
  'rlsgrp', 'fakesite',
  'repack', 'proper',
];

function releaseJunk(text) {
  const lowered = (text || '').toLowerCase();
  return RELEASE_JUNK_TOKENS.filter((t) => lowered.includes(t));
}

describe('classifyFile — corpus regression', { skip: CORPUS ? false : 'scratch/corpus.json not present (user-maintained, never committed)' }, () => {
  it('corpus fixture is non-empty', () => {
    assert.ok(CORPUS.candidates.length > 0, 'corpus fixture must not be empty');
  });

  it('corpus paths classify cleanly', () => {
    const failures = [];
    for (const entry of CORPUS.candidates) {
      const r = classifyFile(_candidate(entry.name, {
        container_path: entry.container_path ?? null,
        relative_path: entry.relative_path ?? null,
        file_size: entry.file_size ?? null,
      }));
      if (!['series', 'movie', 'extra'].includes(r.type)) {
        failures.push(`${entry.name}: type=${r.type} (${r.reason})`);
        continue;
      }
      const titleJunk = releaseJunk(r.title);
      const epJunk = releaseJunk(r.episode_title);
      if (titleJunk.length) failures.push(`${entry.name}: title ${JSON.stringify(r.title)} contains ${titleJunk}`);
      if (epJunk.length) failures.push(`${entry.name}: episode_title ${JSON.stringify(r.episode_title)} contains ${epJunk}`);
      if (r.title && (r.title.includes('[') || r.title.includes(']'))) {
        failures.push(`${entry.name}: title ${JSON.stringify(r.title)} contains brackets`);
      }
    }
    assert.deepEqual(failures, [], 'corpus classification regressions:\n' + failures.slice(0, 50).join('\n'));
  });

  it('underscore-junk season folders resolve to one title per container', () => {
    const titles = new Map();
    for (const entry of CORPUS.candidates) {
      const container = entry.container_path || '';
      if (!container.includes('Nimbus') && !entry.name.includes('Nimbus')) continue;
      const r = classifyFile(_candidate(entry.name, {
        container_path: entry.container_path ?? null,
        relative_path: entry.relative_path ?? null,
        file_size: entry.file_size ?? null,
      }));
      if (!titles.has(container)) titles.set(container, new Set());
      titles.get(container).add(r.title);
    }
    assert.ok(titles.size > 0, 'expected at least one Nimbus candidate in corpus');
    const distinct = new Set([...titles.values()].map((s) => [...s][0]));
    assert.equal(distinct.size, 1, `Nimbus titles not consistent across folders: ${[...distinct]}`);
  });
});
