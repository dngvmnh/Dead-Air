/**
 * `npm run validate:catalog` (add `-- --release` for the release checks).
 *
 * Thin CLI over the pure validator in `src/content/validateCatalog.ts`: it
 * reads the authored JSON off disk (channels, events, scenes) and the set of
 * local asset paths that actually exist under `public/`, runs every rule in
 * requirement 14 (and, under `--release`, requirement 4's depth rules), prints
 * the result, and exits non-zero on failure (requirement 14.1/14.5).
 *
 * Content is authored across later tasks, so every input is optional: a missing
 * catalogue/scenes/events directory is reported and treated as empty rather
 * than crashing. An empty catalogue passes the non-release rules and fails the
 * release depth rules, which is correct.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, type CatalogInput } from '../src/content/validateCatalog.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CATALOG_DIR = join(ROOT, 'src', 'content', 'catalog');
const EVENTS_DIR = join(ROOT, 'src', 'content', 'events');
const SCENES_DIR = join(ROOT, 'src', 'content', 'scenes');
const ROOM_PATHS_FILE = join(ROOT, 'src', 'content', 'room', 'paths.json');
const MEDIA_DIR = join(ROOT, 'public', 'media');

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(dir, f));
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Collect local asset paths under public/media, keyed as the catalogue writes
 *  them: relative to `public/media` with forward slashes (e.g. `cards/ch02.png`). */
function collectLocalAssets(dir: string): Set<string> {
  const assets = new Set<string>();
  if (!existsSync(dir)) return assets;
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else assets.add(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return assets;
}

function flattenEvents(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'events' in raw) {
    const events = (raw as { events: unknown }).events;
    if (Array.isArray(events)) return events;
  }
  return [raw];
}

/**
 * `--release` reaches us either as a plain argv flag (`tsx … --release`) or,
 * when invoked as `npm run validate:catalog -- --release`, as the npm config
 * env var `npm_config_release` — npm 10 strips option-looking args before the
 * script sees them and exposes them this way instead. Accept both.
 */
function releaseRequested(): boolean {
  if (process.argv.includes('--release')) return true;
  const env = process.env.npm_config_release;
  return env === 'true' || env === '1' || env === '';
}

function main(): void {
  const release = releaseRequested();

  const warnings: string[] = [];
  for (const [label, dir] of [
    ['catalog', CATALOG_DIR],
    ['scenes', SCENES_DIR],
    ['events', EVENTS_DIR],
  ] as const) {
    if (!existsSync(dir)) warnings.push(`no ${label} directory yet (${relative(ROOT, dir)})`);
  }

  const channels = listJson(CATALOG_DIR).map(readJson);
  const scenes = listJson(SCENES_DIR).map(readJson);
  const events = listJson(EVENTS_DIR).flatMap((f) => flattenEvents(readJson(f)));

  // Only enforce local-asset resolution once a media directory exists. Before
  // that (early tasks author catalogue entries before any art lands under
  // public/media) an empty set would false-fail every local reference, so we
  // skip the asset check entirely by leaving localAssets undefined.
  const hasMediaDir = existsSync(MEDIA_DIR);
  const localAssets = hasMediaDir ? collectLocalAssets(MEDIA_DIR) : undefined;
  if (!hasMediaDir) warnings.push(`no media directory yet (${relative(ROOT, MEDIA_DIR)}); local-asset references not checked`);

  const roomPaths = existsSync(ROOM_PATHS_FILE) ? (readJson(ROOM_PATHS_FILE) as Record<string, unknown>) : {};
  const input: CatalogInput = { channels, events, scenes, roomPaths, ...(localAssets ? { localAssets } : {}) };
  const result = validateCatalog(input, { release });

  const mode = release ? 'release' : 'standard';
  for (const w of warnings) console.warn(`warning: ${w}`);
  const assetSummary = localAssets ? `${localAssets.size} local asset(s)` : 'assets not checked';
  console.log(
    `validate:catalog (${mode}): ${channels.length} channel(s), ${scenes.length} scene(s), ${events.length} event(s), ${assetSummary}`,
  );

  if (result.ok) {
    console.log('OK: all catalogue rules pass.');
    process.exit(0);
  }

  console.error(`FAIL: ${result.errors.length} problem(s):`);
  for (const e of result.errors) {
    console.error(`  [${e.rule}] ${e.where}: ${e.message}`);
  }
  process.exit(1);
}

main();
