import { describe, it } from 'node:test';
import assert from 'node:assert';
import { categorize } from '../src/index.js';

// ═══════════════════════════════════════════════════════════════════════════
//  CANONICAL CATEGORIZATION TEST REGISTRY — categorize(name)
// ═══════════════════════════════════════════════════════════════════════════
//  One entry = one torrent-name pattern. `name` is the EXACT string; `expect`
//  is the categorization that string MUST produce.
//
//  A result is exactly ONE kind:
//    collection | season_batch | episode_collection | episode | movie | others
//  Plus markers (all default to null/false and may be omitted from `expect`):
//    season     — the single season the item belongs to
//    episode    — the (start) episode number
//    episodeEnd — the LAST episode number for a range/collection
//    seasonEnd  — the season of episodeEnd, when a range CROSSES seasons
//    seasonRange — [min,max] seasons spanned by a multi-season item
//    seasonList  — the explicit sorted list of every season CONTAINED
//                  ("Season 1,2,3" → [1,2,3]; "S01-S03" → [1,2,3])
//    isCompletePack — true for "Complete Series"/"All Seasons"/"… COMPLETE"
//
//  Unspecified markers are required to stay at their default — so a pattern
//  that accidentally gains a season (or loses one) FAILS loudly.
//
//  Names are obfuscated (neutral placeholders); formatting tokens (SxxEyy,
//  years, resolutions, codec strings) are kept identical so behavior is
//  unchanged. Real titles/groups never appear here.
//
//  HOW TO ADD A NEW PATTERN (whenever we spot one in the wild):
//    1. append to the group below:
//         { name: 'The.Exact.Torrent.Name.2026.1080p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 22 } },
//    2. run:  npm test
//    3. if it fails, decide whether the classifier or the expectation is wrong.
// ───────────────────────────────────────────────────────────────────────────

const CATEGORIZE_CASES = [
  // ── others — nothing recognized ────────────────────────────────────────
  { name: 'Random Garbage Name', expect: { kind: 'others' } },
  { name: 'Music Album FLAC 320kbps', expect: { kind: 'others' } },
  { name: 'Show 1920x1080', expect: { kind: 'others' } }, // dimensions, not S1920E1080

  // ── movie ──────────────────────────────────────────────────────────────
  { name: 'Some Movie 2023 1080p WEB-DL', expect: { kind: 'movie' } },
  { name: 'Some Movie 2023 Hindi', expect: { kind: 'movie' } },
  { name: 'Long Road Home Movie 2019 1080p', expect: { kind: 'movie' } },
  // "complete" in the title must NOT make it a collection:
  { name: 'A Complete Stranger 2025 1080p WEB-DL', expect: { kind: 'movie' } },

  // ── season_batch — ONE whole season ────────────────────────────────────
  { name: 'Starfall Season 3 (BD 1080p)', expect: { kind: 'season_batch', season: 3 } },
  { name: 'Show.Name.S01.720p', expect: { kind: 'season_batch', season: 1 } },
  { name: 'Show Name (2018) Season 1 720p WEB-DL', expect: { kind: 'season_batch', season: 1 } },
  { name: 'Show.Season.03.Complete', expect: { kind: 'season_batch', season: 3, isCompletePack: true } },
  { name: 'Show Season 2 Complete 1080p', expect: { kind: 'season_batch', season: 2, isCompletePack: true } },
  // Traps that must NOT become a multi-season list/collection:
  { name: 'Show Name (2018) Season 1 - 720p - HDRip - x264', expect: { kind: 'season_batch', season: 1 } }, // "Season 1 - 720p"
  { name: 'Show Name Season 1 720p WEB-DL', expect: { kind: 'season_batch', season: 1 } },                  // bare space ≠ list
  { name: 'Show Season 1 Part 2 1080p', expect: { kind: 'others' } },                // part packs are NOT season batches (user: categorize as others)

  // ── anime "Part N - EE" episode convention — NOT a batch ─────────────────
  { name: '[RlsGrp] Starfall Chronicle The Final Season Part 2 - 06 (CR) [1080p][HEVC 10bit x265][AAC][Multi Sub] [Weekly] Starfall Season 4', expect: { kind: 'episode', season: 4, episode: 6 } },
  { name: 'Show S04 Part 2 - 06 1080p', expect: { kind: 'episode', season: 4, episode: 6 } },
  { name: 'Show Season 4 Part 1 - 13 WEB-DL', expect: { kind: 'episode', season: 4, episode: 13 } },
  { name: 'Show 2x13 Part 2 - 06 1080p', expect: { kind: 'episode', season: 2, episode: 13 } },            // x-notation wins over Part conventions
  { name: 'Show Season 4 Part 2 - 1080p', expect: { kind: 'others' } },                   // resolution glued → not an ep, and parts are others
  { name: 'Show Season 4 Part 2 - Complete', expect: { kind: 'others' } }, // bare part pack, no dashed ep — others
  { name: 'Show Season 3 Part 1 - 26 BLURAY 1080p', expect: { kind: 'episode', season: 3, episode: 26 } },
  // Traps that must stay episode via S/E notation (real episode numbers):
  { name: '[RlsGrp] Starfall Chronicle (Starfall) (Season 4 Part 3) - S04E29-31', expect: { kind: 'episode_collection', season: 4, episode: 29, episodeEnd: 31 } },

  // ── part-split season packs — NEVER used, categorized as others (Aug 2026) ─
  { name: 'Starfall S04 P1 1080p Blu-Ray 10-Bit Dual-Audio TrueHD x265-RlsGrp', expect: { kind: 'others' } },
  { name: 'Starfall.Starfall Chronicle S04 Part 2 Sub 1080p 10b x265', expect: { kind: 'others' } },
  { name: 'Starfall.Starfall Chronicle S04 Part 2 Eng Sub 1080p x264', expect: { kind: 'others' } },
  { name: 'Show S04 P1 1080p', expect: { kind: 'others' } },
  { name: 'Show S04 Part 2 1080p', expect: { kind: 'others' } },
  { name: 'Show Season 4 Part 3 2160p', expect: { kind: 'others' } },

  // ── anime "Season … - N" episode (NO "Part", no episode word) ───────────
  // A number dashed after a "Season" phrase ("The Final Season - 08" / "- 23")
  // is an EPISODE mark in the anime "Final Season" convention — NOT a movie and
  // NOT a season batch. The season number is unnamed here, so season stays null.
  { name: '[RlsGrp] Starfall Chronicle (The Final Season) - 08 [1080p 10bit Dual Audio] (Starfall - 67).mkv', expect: { kind: 'episode', episode: 8 } },
  { name: '[RlsGrp] Starfall Chronicle - The Final Season - 23 | Starfall The Final Season [English Dub] [WEB-DL 1080p] [68F9EC73]', expect: { kind: 'episode', episode: 23 } },
  { name: '[RlsGrp] Starfall Chronicle - The Final Season - 24 | Starfall The Final Season [English Dub] [WEB-DL 1080p] [BF0509F4]', expect: { kind: 'episode', episode: 24 } },
  { name: '[RlsGrp] Starfall Chronicle - The Final Season - 18 | Starfall The Final Season [English Dub] [WEB-DL 1080p] [2B42B5E5]', expect: { kind: 'episode', episode: 18 } },
  // Traps that must NOT become episodes via the dash:
  { name: 'Show Season 1 - 720p HDRip x264', expect: { kind: 'season_batch', season: 1 } },   // resolution glued → stays season batch
  { name: 'Show Season 2 - 2019 1080p', expect: { kind: 'season_batch', season: 2 } },         // 4-digit year → stays season batch
  { name: 'Show Season 1 - 3 2160p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } }, // real season range wins earlier

  // ── bare-episode season-carry — "S04 Part2 e07" keeps its season ────────
  // A bare "e0N" / "episode N / eA-eB" marker with NO S/E adjacency used to drop
  // the season anchor earlier in the name ("Starfall S04 Part2 e07" →
  // episode E07, season lost). Now the season anchor ("S04"/"Season 3") is
  // carried onto the episode / episode_collection.
  { name: 'Starfall S04 Part2 e07 Jap 720p h264 MultiSub-RlsGrp', expect: { kind: 'episode', season: 4, episode: 7 } },
  { name: 'Starfall S04 Part2 e09 Jap 1080p h265 10bit MultiSub-RlsGrp', expect: { kind: 'episode', season: 4, episode: 9 } },
  { name: 'Starfall S04 Part2 e01-05 (720p Jap MultiSub) byRlsGrp', expect: { kind: 'episode_collection', season: 4, episode: 1, episodeEnd: 5 } },
  { name: 'Starfall S04 Part2 e01-12 [720p Jap MultiSub][RlsGrp] byRlsGrp', expect: { kind: 'episode_collection', season: 4, episode: 1, episodeEnd: 12 } },
  { name: '[RlsGrp] Starfall Season 3 Part 1 Episode 1-12 - English Dub 720p', expect: { kind: 'episode_collection', season: 3, episode: 1, episodeEnd: 12 } },

  // ── collection — full-series phrases ───────────────────────────────────
  { name: 'Show Complete Series 1080p', expect: { kind: 'collection', isCompletePack: true } },
  { name: 'Show Complete Collection 720p', expect: { kind: 'collection', isCompletePack: true } },
  { name: 'Show All Seasons WEB-DL', expect: { kind: 'collection', isCompletePack: true } },

  // ── collection — season LISTS (the unique seasons it contains) ─────────
  { name: 'Show Name Season 1, 2, 3 1080p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Name Season 1,2,3 1080p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Name Season 1, 2 and 3 1080p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Name Season 1 & 2 & 3 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Name Season 1 & 2 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Show Name Season 1 + 2 + 3 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Name Season 1+2 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Seasons 1, 2, 3 2160p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Season 1, 2, 3, 4, 5, 6, 7, 8 1080p', expect: { kind: 'collection', seasonRange: [1, 8], seasonList: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { name: 'Show Season 1, 2, 3 Complete 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3], isCompletePack: true } },

  // ── collection — season RANGES (dash/"to" → every season in between) ───
  { name: 'Show Name Season 1 - 3 2160p 4K SDR WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Season 1 to 4 OVA Hybrid', expect: { kind: 'collection', seasonRange: [1, 4], seasonList: [1, 2, 3, 4] } },
  { name: 'Show Name S01-S03 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show S1-S2-S3 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show S01-S08 COMPLETE 1080p', expect: { kind: 'collection', seasonRange: [1, 8], seasonList: [1, 2, 3, 4, 5, 6, 7, 8], isCompletePack: true } },
  { name: 'Show Season 1-3 Complete 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3], isCompletePack: true } },

  // ── collection — season ranges, spaced/lowercase/"Seasons" word forms ──
  // These are the SEASON side of the "S01 1 to 2" family: season spans must
  // stay `collection` no matter how the season is written (s01-S03 with spaces,
  // "season", "Seasons", "to", "-"). Contrast with S01 1 to 2 → episodes.
  { name: 'Show s01 - s03 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show S01 - S03 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show S01 - S08 COMPLETE 1080p', expect: { kind: 'collection', seasonRange: [1, 8], seasonList: [1, 2, 3, 4, 5, 6, 7, 8], isCompletePack: true } },
  { name: 'Show s1 - s2 - s3 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show season 1 - 2 720p', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Show Season 1 - 2 720p', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Show season 1 - 2 2160p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Show Seasons 1 - 2 720p', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Show Seasons 1 to 3 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Seasons 1 - 3 2160p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Show Seasons 1 to 4 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 4], seasonList: [1, 2, 3, 4] } },
  { name: 'Show Seasons 1 & 2 & 3 WEB-DL', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3] } },
  { name: 'Seasons 1 - 2 2160p WEB-DL', expect: { kind: 'collection', seasonRange: [1, 2], seasonList: [1, 2] } },
  { name: 'Show Seasons 1 to 3 COMPLETE 1080p', expect: { kind: 'collection', seasonRange: [1, 3], seasonList: [1, 2, 3], isCompletePack: true } },

  // ── episode — a single episode ─────────────────────────────────────────
  { name: 'Show.S01E05.720p', expect: { kind: 'episode', season: 1, episode: 5 } },
  { name: 'Show 1x05 720p', expect: { kind: 'episode', season: 1, episode: 5 } },      // x-notation
  { name: 'Show Season 1 Episode 5 1080p', expect: { kind: 'episode', season: 1, episode: 5 } }, // word form
  { name: 'Show Season 1 Ep 3', expect: { kind: 'episode', season: 1, episode: 3 } },
  { name: 'Show E05 720p', expect: { kind: 'episode', episode: 5 } },                  // season unknown
  { name: 'Show Episode 5', expect: { kind: 'episode', episode: 5 } },
  { name: 'Show Ep 12 720p', expect: { kind: 'episode', episode: 12 } },
  { name: 'Show Episode 122 720p', expect: { kind: 'episode', episode: 122 } },
  // Anime finale marker "<ep> END" — a season-episode dash followed by END is the
  // FINAL EPISODE, never a season range ("S2 - 12 END" ≠ seasons 2–12):
  { name: '[RlsGrp] Starfall S2 - 12 END (BS4 4K 3840x2160 x265 AAC).mkv', expect: { kind: 'episode', season: 2, episode: 12 } },
  { name: 'Show Season 2 - 12 END 1080p', expect: { kind: 'episode', season: 2, episode: 12 } },

  // ── episode_collection — same season, episode range ────────────────────
  { name: 'Show S01E01-E13 1080p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13 } },
  { name: 'Bunker.S03E01-E13.1080p', expect: { kind: 'episode_collection', season: 3, episode: 1, episodeEnd: 13 } },
  { name: 'Bunker S03E01 to E08 1080p', expect: { kind: 'episode_collection', season: 3, episode: 1, episodeEnd: 8 } },
  { name: 'Show S01E01-S01E05 1080p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 5, seasonEnd: 1 } },
  { name: 'Show E01-E13 1080p', expect: { kind: 'episode_collection', episode: 1, episodeEnd: 13 } },
  { name: 'Show E01 to E13 1080p', expect: { kind: 'episode_collection', episode: 1, episodeEnd: 13 } },
  { name: 'Show Episodes 1-13 1080p', expect: { kind: 'episode_collection', episode: 1, episodeEnd: 13 } },
  { name: 'Show Ep 1-9 720p', expect: { kind: 'episode_collection', episode: 1, episodeEnd: 9 } },
  { name: 'Show Episode 1 to 9 720p', expect: { kind: 'episode_collection', episode: 1, episodeEnd: 9 } },

  // ── episode_collection — season + episode range (season said differently) ──
  // "Season <N> <episode-word> <A> (to|till|thru|through|-|) <B>" — the season
  // is mentioned ONCE, in front. "Episode" / "Episodes" / "Eps" / "Ep" all work.
  { name: 'Show Season 1 Episode 1 to 2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show Name (2018) Season 1 Episode 1 to 22 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 22 } },
  { name: 'Show Season 1 Episode 1-9 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 9 } },
  { name: 'Show Season 1 Episodes 1-13 1080p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13 } },
  // Glued "Episodes1-13" (no space) — the trailing `s` of "Episodes" used to be
  // read as an "S" season prefix → fake [1,13] season collection. It is an
  // episode range: "S01 (Episodes1-13)" → S01E01-E13.
  { name: 'Starfall S01 (Episodes1-13) "Eng DUBBED"', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13 } },
  { name: 'Starfall S01 Episodes1-13', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13 } },
  { name: 'Show Season 1 Eps 1 to 2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show Season 1 Eps 1-9 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 9 } },
  { name: 'Show Season 1 Episode 1 till 2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show Season 1 Episode 1 thru 22 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 22 } },
  { name: 'Show Season 1 Episode 1 through 9 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 9 } },
  { name: 'Show Season 1 Eps 1 to 22 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 22 } },
  // Season in S-form + episode in word form — "S01 Eps 1 to 9" keeps S01:
  { name: 'Show S01 Eps 1 to 9 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 9 } },
  { name: 'Show S01 Episode 1 to 2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show S01 Eps 1 to 22 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 22 } },
  { name: 'Show S01 E1-9 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 9 } },

  // ── episode_collection — S-form + BARE episode range ─────────────────--
  // "S01 1 to 2" PREFIXES both episodes with season 1 — it IS S01E01..S01E02,
  // so it is an EPISODE collection, never a season batch or a season collection.
  // The second number is bare (no "s") and separated by whitespace, which is
  // what keeps "S01-S03" a real season range.
  { name: 'Show S01 1 to 2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show S01 1-2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show S01 1 till 2 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },
  { name: 'Show S02 1 to 9 1080p', expect: { kind: 'episode_collection', season: 2, episode: 1, episodeEnd: 9 } },
  { name: 'Show S03 1 - 13 1080p', expect: { kind: 'episode_collection', season: 3, episode: 1, episodeEnd: 13 } },
  { name: 'Show S01 01-02 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 2 } },

  // ── episode_collection — CROSS-season ranges (two ends, different seasons) ──
  { name: 'Show S01E09-S02E01 1080p', expect: { kind: 'episode_collection', season: 1, episode: 9, episodeEnd: 1, seasonEnd: 2 } },
  { name: 'Show S01E01-S03E13 1080p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13, seasonEnd: 3 } },
  { name: 'Show Season 1 Episode 9 to Season 2 Episode 5', expect: { kind: 'episode_collection', season: 1, episode: 9, episodeEnd: 5, seasonEnd: 2 } },
  { name: 'Show 1x09 to 2x05 720p', expect: { kind: 'episode_collection', season: 1, episode: 9, episodeEnd: 5, seasonEnd: 2 } },
  { name: 'Show 1x01-2x13 720p', expect: { kind: 'episode_collection', season: 1, episode: 1, episodeEnd: 13, seasonEnd: 2 } },

  // ── season_batch — "Season N S0N - YEAR" must NOT become a season range ──
  // Real-world search (Aug 2026): "S02 - 2019" was parsed as a [2,2019]
  // collection (a wrong season batch won the pick — 4-digit years/resolutions
  // are never range ends). Fixed with saneRangeEnd().
  { name: 'Gloom - Season 2 S02 - 2019 - 1080p - NF WEB-DL - AAC5.1 x264-RlsGrp', expect: { kind: 'season_batch', season: 2 } },
  { name: 'Gloom.Season.3.S03.2020.NF.English.720p.HDRip.x264', expect: { kind: 'season_batch', season: 3 } },
  { name: 'Show S02 - 2019 1080p', expect: { kind: 'season_batch', season: 2 } },
  { name: 'Show Season 2 - 2019 1080p', expect: { kind: 'season_batch', season: 2 } },
  { name: 'Show Season 3 S03 - 2019 2160p WEB-DL', expect: { kind: 'season_batch', season: 3 } },
  { name: 'Gloom Season 3 S03 - 2020 NF English 720p HDRip', expect: { kind: 'season_batch', season: 3 } },

  // ── x-notation vs codecs — "AAC5.1 x264" is NOT "1x264" ──
  // normalizeParseName turns dots into spaces ("aac5.1 x264" → "aac5 1 x264"),
  // which used to trick x-notation into S1E264. Guard: no digit/space-token
  // directly before the season number, so codec/resolution tails never fire.
  // Also: "1 x264" / "1x264" is a codec, NOT episode 264 (x264/x265 guard).
  { name: 'Show 5x12.HDTV.x264-PROPER', expect: { kind: 'episode', season: 5, episode: 12 } },
  { name: 'Show x264 AAC5.1 1080p', expect: { kind: 'others' } },
  { name: 'Show.5x12.720p.AAC5.1.x265-RlsGrp', expect: { kind: 'episode', season: 5, episode: 12 } },
  // x264/x265 must never be read as episode 264/265 (codec tails)
  { name: 'Starfall 2015 Part 1 X264 720p Esub BluRay Dual Audio Hindi RlsGrp', expect: { kind: 'movie' } },
  { name: 'Show 1x264 1080p', expect: { kind: 'others' } },
  { name: 'Show 1 x264 1080p', expect: { kind: 'others' } },
  { name: 'Show 1x265 1080p', expect: { kind: 'others' } },
  { name: 'Show 2x264 720p', expect: { kind: 'others' } },
  { name: 'Movie Title 2020 1080p x264', expect: { kind: 'movie' } },
];

const MARKERS = ['kind', 'season', 'episode', 'episodeEnd', 'seasonEnd', 'seasonRange', 'seasonList', 'isCompletePack'];

function expectedObject(expect) {
  const defaults = { kind: null, season: null, episode: null, episodeEnd: null, seasonEnd: null, seasonRange: null, seasonList: null, isCompletePack: false };
  return Object.assign(defaults, expect);
}

describe('categorization registry (categorize)', () => {
  for (const { name, expect } of CATEGORIZE_CASES) {
    it(name.slice(0, 72) + (name.length > 72 ? '…' : ''), () => {
      const actual = categorize(name);
      const subset = {};
      for (const k of MARKERS) subset[k] = actual[k];
      assert.deepEqual(subset, expectedObject(expect), name);
    });
  }
});

// The registry is the source of truth — but never let it silently shrink.
it('registry has at least 60 locked-in patterns', () => {
  assert.ok(CATEGORIZE_CASES.length >= 60, `only ${CATEGORIZE_CASES.length} patterns — every new pattern goes here`);
});
