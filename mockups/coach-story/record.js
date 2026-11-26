#!/usr/bin/env node
/**
 * Renders the coach-story animation to MP4, frame by frame (no screen recording).
 *
 *   node record.js            -> out/coach-story-es.mp4 + out/clips/NN-*.mp4
 *   node record.js --fps 30   (default 60)
 *
 * The page exposes window.__story: goStep(n) applies a step and pauses every
 * animation it starts; seek(ms) moves them to an exact time. Output is identical
 * every run and never drops a frame.
 *
 * Uses the Playwright package from ~/padel-visuals with the installed Google Chrome.
 */
const { chromium } = require(process.env.PW_PATH || '/Users/GuDenes/padel-visuals/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i === -1 ? d : Number(argv[i + 1]); };
const fps = flag('fps', 60);
const crf = flag('crf', 16);
const W = 1920, H = 1080;

// how long to hold each step after its animations finish (ms)
const HOLD = [2500, 1400, 1400, 1400, 1600, 1600, 2200, 3000];
const NAMES = ['senal', 'deteccion', 'medidas', 'colocacion', 'movimiento', 'scouting', 'informe', 'cierre'];

const here = __dirname;
const outDir = path.join(here, 'out');
const clipDir = path.join(outDir, 'clips');
fs.mkdirSync(clipDir, { recursive: true });

function encoder(file) {
  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  const write = (buf) => new Promise((res, rej) => ff.stdin.write(buf, (e) => (e ? rej(e) : res())));
  return { write, end: () => { ff.stdin.end(); return done; } };
}

(async () => {
  // installed Google Chrome by default (the cached Playwright Chromium is incomplete); override with PW_CHANNEL
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('pageerror', (e) => { console.error('page error:', e.message); process.exit(1); });

  await page.goto('file://' + path.join(here, 'index.html'), { waitUntil: 'networkidle' });
  const { steps } = await page.evaluate(() => window.__story.prepare());
  if (failed.length) console.warn(`warning: ${failed.length} request(s) failed, e.g. ${failed[0]}`);

  const full = encoder(path.join(outDir, 'coach-story-es.mp4'));
  const t0 = Date.now();
  let frames = 0;

  for (let s = 0; s < steps; s++) {
    const anim = await page.evaluate((n) => window.__story.goStep(n), s);
    const dur = Math.ceil(anim) + HOLD[s];
    const total = Math.round(dur / 1000 * fps);
    const name = `${String(s + 1).padStart(2, '0')}-${NAMES[s]}.mp4`;
    const clip = encoder(path.join(clipDir, name));
    for (let f = 0; f < total; f++) {
      await page.evaluate((ms) => window.__story.seek(ms), f * 1000 / fps);
      const buf = await page.screenshot({ type: 'png' });
      await Promise.all([full.write(buf), clip.write(buf)]);
      frames++;
    }
    await clip.end();
    console.log(`step ${s + 1}/${steps}  ${name}  ${(dur / 1000).toFixed(1)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }
  await full.end();
  await browser.close();
  console.log(`done: ${frames} frames @ ${fps}fps -> ${path.join(outDir, 'coach-story-es.mp4')}`);
})().catch((e) => { console.error(e); process.exit(1); });
