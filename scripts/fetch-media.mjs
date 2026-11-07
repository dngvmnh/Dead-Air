/**
 * Fetches the public-domain films and cuts the clips the channels play. Media
 * binaries stay out of git (see safety-and-rights.md), so this rebuilds them on
 * any checkout and before a deploy. The rights evidence is in docs/rights-log.md.
 *
 *   node scripts/fetch-media.mjs
 *
 * Needs ffmpeg on the PATH. Re-running skips anything already there.
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const CACHE = '.media-cache';
const OUT = join('public', 'film');

/** Each clip: its source film on archive.org, where to cut, and how long. */
const CLIPS = [
  { out: 'spot-news.mp4', id: 'SpotNews1937', start: 20, seconds: 120 },
  { out: 'mother-goose.mp4', id: 'MotherGooseS', start: 30, seconds: 150 },
  { out: 'sleep-for-health.mp4', id: 'Sleepfor1950', start: 40, seconds: 120 },
  // Effectively silent at source (-70 dB): levelling would only amplify hiss, so
  // it gets a silent track and the channel's bed plays under it.
  { out: 'store.mp4', id: 'dollar_store', start: 0, seconds: 90, silent: true },
  { out: 'appliances.mp4', id: 'HomeElec1944', start: 30, seconds: 120 },
];

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function download(id) {
  const file = join(CACHE, `${id}_512kb.mp4`);
  if (existsSync(file)) return file;
  const url = `https://archive.org/download/${id}/${id}_512kb.mp4`;
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  renameSync(part, file);
  return file;
}

for (const clip of CLIPS) {
  const target = join(OUT, clip.out);
  if (existsSync(target)) {
    console.log(`have ${target}`);
    continue;
  }
  const source = await download(clip.id);
  // The CRT hides resolution, and small files start fast. -g keeps seeking cheap,
  // because tuning in lands mid-programme. A silent film gets a silent track, so
  // every clip plays through the same audio path. The rest are levelled to one
  // loudness: the sources differ by 13 dB, which reads as some channels being mute.
  const hasAudio = !clip.silent && execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', source],
    { encoding: 'utf8' },
  ).trim().length > 0;
  execFileSync(
    'ffmpeg',
    [
      '-y', '-v', 'error',
      '-ss', String(clip.start), '-t', String(clip.seconds), '-i', source,
      ...(hasAudio
        ? ['-map', '0:v:0', '-map', '0:a:0', '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11']
        : ['-f', 'lavfi', '-t', String(clip.seconds), '-i', 'anullsrc=r=44100:cl=mono', '-map', '0:v:0', '-map', '1:a:0', '-shortest']),
      '-vf', 'scale=480:360:force_original_aspect_ratio=decrease,pad=480:360:(ow-iw)/2:(oh-ih)/2,fps=24',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', '24', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '56k', '-ac', '1', '-ar', '44100',
      '-movflags', '+faststart',
      target,
    ],
    { stdio: 'inherit' },
  );
  console.log(`cut ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)`);
}
