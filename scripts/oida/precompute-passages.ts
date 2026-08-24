/**
 * Embed every page's passages once, so locating one at request time is free.
 *
 * A page's passages derive entirely from its word coordinates, which are written once by
 * `yarn oida:extract-boxes` and never change. Embedding them per request meant sending about
 * 2,000 tokens through a 2B model to answer a question whose only variable is the query —
 * ~1.3 s on MPS, and more than ten minutes on a CPU-only host, where it also starved the
 * searches behind it because the search page prefetches this for its top page result.
 *
 * Run this on a machine with a GPU or Apple MPS. The output ships with `public/`, so a
 * CPU-only production host reads vectors rather than computing them.
 *
 * Usage:
 *   yarn oida:precompute-passages
 *   yarn oida:precompute-passages --force     # redo pages that already have vectors
 *   yarn oida:precompute-passages --dry-run   # report what would be done, embed nothing
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  buildPassages,
  encodeVectors,
  groupIntoLines,
  lineBoxes,
  passagesFileFor,
  type StoredPassage,
  type WordBox,
} from '../../lib/passages/pagePassages';

const PAGES_DIR = path.join(process.cwd(), 'public', 'oida', 'pages');

/**
 * Passages are short and text-only, so they batch far more happily than page images. This is
 * bounded mainly to keep one request from holding the embedding service for a long time.
 */
const EMBED_BATCH = 32;

function embedUrl(): string {
  return process.env.NLP_PROCESSOR_URL ?? 'http://localhost:7070';
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await fetch(`${embedUrl()}/embed-multimodal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: batch.map((text) => ({ text })) }),
    });

    if (!res.ok) {
      throw new Error(`Embedding failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }

    const body = (await res.json()) as { vectors: number[][] };
    out.push(...body.vectors);
  }

  return out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

type PageJob = { wordsPath: string; outPath: string; imageUrl: string };

async function findPages(): Promise<PageJob[]> {
  const jobs: PageJob[] = [];

  let dirs: string[];
  try {
    dirs = await readdir(PAGES_DIR);
  } catch {
    throw new Error(`No rendered pages at ${PAGES_DIR}. Run yarn oida:fetch first.`);
  }

  for (const dir of dirs) {
    const full = path.join(PAGES_DIR, dir);
    if (!(await stat(full)).isDirectory()) continue;

    for (const file of await readdir(full)) {
      if (!file.endsWith('.words.json')) continue;
      const page = file.replace(/\.words\.json$/, '');
      const imageUrl = `/oida/pages/${dir}/${page}.png`;
      jobs.push({
        wordsPath: path.join(full, file),
        outPath: path.join(process.cwd(), 'public', passagesFileFor(imageUrl)),
        imageUrl,
      });
    }
  }

  return jobs.sort((a, b) => a.imageUrl.localeCompare(b.imageUrl));
}

async function main() {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');

  const jobs = await findPages();
  console.log(`Found ${jobs.length} pages with word coordinates.`);

  let written = 0;
  let skipped = 0;
  let empty = 0;
  let passagesTotal = 0;
  const started = Date.now();

  for (const job of jobs) {
    if (!force && (await exists(job.outPath))) {
      skipped += 1;
      continue;
    }

    const parsed = JSON.parse(await readFile(job.wordsPath, 'utf-8')) as { words: WordBox[] };
    const passages = buildPassages(groupIntoLines(parsed.words ?? []));

    if (!passages.length) {
      // A scan whose only text layer is the library's "Source:" stamp. Expected, not an error.
      empty += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  would embed ${String(passages.length).padStart(2)} passages  ${job.imageUrl}`);
      passagesTotal += passages.length;
      continue;
    }

    const vectors = await embedTexts(passages.map((passage) => passage.text));
    const stored: StoredPassage[] = passages.map((passage) => ({
      text: passage.text,
      boxes: lineBoxes(passage.lines),
    }));

    await writeFile(
      job.outPath,
      JSON.stringify({
        imageUrl: job.imageUrl,
        width: vectors[0]?.length ?? 0,
        passages: stored,
        vectors: encodeVectors(vectors),
      }),
    );

    written += 1;
    passagesTotal += passages.length;
    console.log(
      `  ${String(passages.length).padStart(2)} passages  ${job.imageUrl}` +
        `  (${written}/${jobs.length - skipped - empty})`,
    );
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${dryRun ? 'Would embed' : 'Embedded'} ${passagesTotal} passages across ` +
      `${dryRun ? jobs.length - skipped - empty : written} pages in ${seconds}s.`,
  );
  if (skipped) console.log(`Skipped ${skipped} already done (use --force to redo).`);
  if (empty) console.log(`${empty} pages have no positionable text; nothing to embed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
