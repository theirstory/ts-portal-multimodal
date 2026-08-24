import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildPassages,
  cosineTyped,
  decodeVectors,
  groupIntoLines,
  lineBoxes,
  MIN_PASSAGE_SIMILARITY,
  passagesFileFor,
  wordsFileFor,
  type PassageBox,
  type StoredPassage,
  type WordBox,
} from '@/lib/passages/pagePassages';

/**
 * Locate, on a page image, the passage a semantic search actually considered relevant.
 *
 * A page is embedded as one vector, so retrieval tells you the page matched but not where.
 * And because the match is semantic, the query's words are frequently nowhere on the page —
 * which is why term highlighting alone leaves a researcher scanning a dense two-column scan
 * by eye. This scores the page's own passages against the query with the same model that
 * retrieved the page: a second, finer-grained pass of exactly the comparison that produced
 * the hit, rather than a keyword approximation.
 *
 * The passages' vectors are precomputed by `yarn oida:precompute-passages`, because a page's
 * passages derive from its word coordinates and never change. Only the query needs embedding
 * at request time.
 *
 * This used to embed the passages on every request — about 2,000 tokens through a 2B model
 * against the query's four. That was ~1.3 s on MPS and did not finish inside ten minutes on
 * a CPU-only host, which was ruinous rather than merely slow: the search page prefetches
 * this for its top page result, so every search launched a job that saturated the machine.
 * Precomputed, a request costs one query embedding and a handful of dot products.
 */

type ScoredPassage = { similarity: number; passage: StoredPassage };

type Answer = {
  passages: { similarity: number; text: string; boxes: PassageBox[] }[];
  reason?: string;
  considered?: number;
  source?: 'precomputed' | 'live';
};

async function embedTexts(texts: string[]): Promise<number[][]> {
  const baseUrl = process.env.NLP_PROCESSOR_URL ?? 'http://nlp-processor:7070';

  const res = await fetch(`${baseUrl}/embed-multimodal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: texts.map((text) => ({ text })) }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Embedding service failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as { vectors: number[][] };
  return body.vectors;
}

/**
 * Opening the same page twice, or reopening it from a shared link, should not recompute
 * anything. Keyed by page and query, which is exactly what the answer depends on.
 */
const PASSAGE_CACHE_LIMIT = 400;
const passageCache = new Map<string, Answer>();

function cacheGet(key: string): Answer | undefined {
  const hit = passageCache.get(key);
  if (hit === undefined) return undefined;
  // Refresh recency so the map evicts genuinely cold entries.
  passageCache.delete(key);
  passageCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: Answer): Answer {
  if (passageCache.size >= PASSAGE_CACHE_LIMIT) {
    const oldest = passageCache.keys().next().value;
    if (oldest !== undefined) passageCache.delete(oldest);
  }
  passageCache.set(key, value);
  return value;
}

/**
 * Whether to fall back to embedding a page's passages when it has no precomputed file.
 *
 * On a GPU or MPS host that fallback is a feature: a page added since the last precompute
 * still gets a band. On a CPU-only host it is the pathological path described above, so set
 * PASSAGE_LOCALIZATION=off there. Precomputed pages keep working either way — this governs
 * only the fallback.
 */
const LIVE_FALLBACK_ENABLED = (process.env.PASSAGE_LOCALIZATION ?? 'on').toLowerCase() !== 'off';

/** Query vectors are reused across pages: opening three results for one query embeds once. */
const QUERY_VECTOR_LIMIT = 200;
const queryVectors = new Map<string, number[]>();

async function queryVector(query: string): Promise<number[]> {
  const cached = queryVectors.get(query);
  if (cached) return cached;

  const [vector] = await embedTexts([query]);
  if (queryVectors.size >= QUERY_VECTOR_LIMIT) {
    const oldest = queryVectors.keys().next().value;
    if (oldest !== undefined) queryVectors.delete(oldest);
  }
  queryVectors.set(query, vector);
  return vector;
}

function bestOf(
  scored: ScoredPassage[],
  considered: number,
  source: 'precomputed' | 'live',
): Answer {
  const top = scored.sort((a, b) => b.similarity - a.similarity)[0];

  if (!top || top.similarity < MIN_PASSAGE_SIMILARITY) {
    return { passages: [], reason: 'below-threshold', considered, source };
  }

  return {
    passages: [
      {
        similarity: Number(top.similarity.toFixed(4)),
        text: top.passage.text.slice(0, 600),
        boxes: top.passage.boxes,
      },
    ],
    considered,
    source,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { imageUrl?: string; query?: string };
    const query = (body.query ?? '').trim();
    const imageUrl = (body.imageUrl ?? '').trim();

    if (!query || !imageUrl) {
      return NextResponse.json({ error: 'imageUrl and query are required' }, { status: 400 });
    }

    // Only ever read the generated files, never an arbitrary path from the client.
    if (!/^\/oida\/pages\/[A-Za-z0-9_-]+\/p-\d+\.png$/.test(imageUrl)) {
      return NextResponse.json({ error: 'unsupported imageUrl' }, { status: 400 });
    }

    const cacheKey = `${imageUrl}::${query}`;
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) {
      return NextResponse.json(cached);
    }

    const publicDir = path.join(process.cwd(), 'public');

    // Precomputed vectors: the ordinary path, and the only cheap one.
    let stored: { width: number; passages: StoredPassage[]; vectors: string } | null = null;
    try {
      stored = JSON.parse(
        await readFile(path.join(publicDir, passagesFileFor(imageUrl)), 'utf-8'),
      ) as { width: number; passages: StoredPassage[]; vectors: string };
    } catch {
      stored = null;
    }

    if (stored?.passages?.length) {
      const vectors = decodeVectors(stored.vectors, stored.width);
      const vector = await queryVector(query);

      const scored = stored.passages.map((passage, index) => ({
        passage,
        similarity: vectors[index] ? cosineTyped(vector, vectors[index]) : 0,
      }));

      return NextResponse.json(
        cacheSet(cacheKey, bestOf(scored, stored.passages.length, 'precomputed')),
      );
    }

    if (!LIVE_FALLBACK_ENABLED) {
      // Same shape as a page with no text layer: no band, and the prefetch costs nothing.
      return NextResponse.json(cacheSet(cacheKey, { passages: [], reason: 'not-precomputed' }));
    }

    let words: WordBox[];
    try {
      const parsed = JSON.parse(
        await readFile(path.join(publicDir, wordsFileFor(imageUrl)), 'utf-8'),
      ) as { words: WordBox[] };
      words = parsed.words ?? [];
    } catch {
      // Scanned pages have no positioned text; that is expected, not an error.
      return NextResponse.json(cacheSet(cacheKey, { passages: [], reason: 'no-text-layer' }));
    }

    const passages = buildPassages(groupIntoLines(words));
    if (!passages.length) {
      return NextResponse.json(cacheSet(cacheKey, { passages: [], reason: 'no-passages' }));
    }

    const vectors = await embedTexts([query, ...passages.map((passage) => passage.text)]);
    const scored = passages.map((passage, index) => ({
      passage: { text: passage.text, boxes: lineBoxes(passage.lines) },
      similarity: cosineTyped(vectors[0], vectors[index + 1]),
    }));

    return NextResponse.json(cacheSet(cacheKey, bestOf(scored, passages.length, 'live')));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to locate passages' },
      { status: 500 },
    );
  }
}
