#!/usr/bin/env node
// Generates WebP + AVIF variants alongside every PNG screenshot in
// public/screenshots/. The marketing site's `<picture>` elements
// reference these so mobile devices ship the modern format (1/5 the
// bytes of PNG) while legacy clients still get the PNG fallback.
//
// MK-PERF-95 pass: also emits a 800px-wide variant of each format.
// The hero screenshot is the LCP element on mobile, and on a 360px
// viewport the browser was decoding the full 1600px image — wasted
// bytes + decode CPU. Astro's `<source media="(max-width: 768px)">`
// switches in the small variant before the desktop one's downloaded.
//
// Spec: docs/research/07-marketing-site.md — AVIF / WebP / PNG via
// the same source. PIPELINE: MK-PERF-95.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "public", "screenshots");

// Quality knobs chosen for visual parity with PNG at a fraction of
// the bytes. AVIF 60 ≈ PNG at perceptual quality; WebP 78 same.
const WEBP_QUALITY = 78;
const AVIF_QUALITY = 60;
// Mobile-LCP variant. 800px wide covers up to a 2× DPR 400px slot,
// which is roughly the largest hero / showcase frame on phones.
const SMALL_WIDTH = 800;
const SMALL_SUFFIX = "@800w";

async function run() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const pngs = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".png"))
    .map((e) => path.join(ROOT, e.name));

  if (pngs.length === 0) {
    console.error(`No PNGs found in ${ROOT}`);
    process.exit(1);
  }

  let totalPngBytes = 0;
  let totalWebpBytes = 0;
  let totalAvifBytes = 0;

  for (const png of pngs) {
    const base = png.replace(/\.png$/i, "");
    const webp = `${base}.webp`;
    const avif = `${base}.avif`;
    const webpSmall = `${base}${SMALL_SUFFIX}.webp`;
    const avifSmall = `${base}${SMALL_SUFFIX}.avif`;

    const pngStat = await fs.stat(png);
    totalPngBytes += pngStat.size;

    // Skip if up-to-date — generated variants newer than source PNG.
    const [webpFresh, avifFresh, webpSmallFresh, avifSmallFresh] = await Promise.all([
      isFresh(webp, pngStat.mtimeMs),
      isFresh(avif, pngStat.mtimeMs),
      isFresh(webpSmall, pngStat.mtimeMs),
      isFresh(avifSmall, pngStat.mtimeMs),
    ]);

    if (!webpFresh) {
      await sharp(png).webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(webp);
    }
    if (!avifFresh) {
      await sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toFile(avif);
    }
    if (!webpSmallFresh) {
      await sharp(png)
        .resize({ width: SMALL_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, effort: 6 })
        .toFile(webpSmall);
    }
    if (!avifSmallFresh) {
      await sharp(png)
        .resize({ width: SMALL_WIDTH, withoutEnlargement: true })
        .avif({ quality: AVIF_QUALITY, effort: 6 })
        .toFile(avifSmall);
    }
    totalWebpBytes += (await fs.stat(webp)).size + (await fs.stat(webpSmall)).size;
    totalAvifBytes += (await fs.stat(avif)).size + (await fs.stat(avifSmall)).size;
  }

  const pct = (n, of) => `${((1 - n / of) * 100).toFixed(0)}%`;
  console.log(
    `Optimized ${pngs.length} screenshots:\n` +
      `  PNG total:  ${fmt(totalPngBytes)}\n` +
      `  WebP total: ${fmt(totalWebpBytes)} (${pct(totalWebpBytes, totalPngBytes)} smaller)\n` +
      `  AVIF total: ${fmt(totalAvifBytes)} (${pct(totalAvifBytes, totalPngBytes)} smaller)`,
  );
}

async function isFresh(dest, sourceMtimeMs) {
  try {
    const s = await fs.stat(dest);
    return s.mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
