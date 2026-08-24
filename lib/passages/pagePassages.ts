/**
 * Building a page's passages, shared by the search route and the precompute script.
 *
 * These two must agree exactly. The script stores one vector per passage, and the route
 * looks those vectors up by index — so if the two built passages differently, the route
 * would score a query against vectors belonging to different text. Hence one module rather
 * than two copies.
 */

export type WordBox = { t: string; x: number; y: number; w: number; h: number; b?: number; l?: number };
export type Line = { words: WordBox[]; y: number; height: number; block: number; column: number };
export type Passage = { text: string; lines: Line[] };

/**
 * Roughly a paragraph: long enough to carry meaning, short enough to localise.
 *
 * Each passage costs one forward pass of a 2B-parameter model, so this number is the whole
 * latency budget. At 45 words a dense page produced 24 passages and took 1.3-6s, which is
 * long enough that the highlight appeared well after the page image. Longer passages mean
 * fewer of them, trading a little precision for a response that lands with the image.
 */
export const TARGET_PASSAGE_WORDS = 95;
/** Lines shared between neighbouring passages, so a match spanning a boundary is still found. */
const PASSAGE_OVERLAP_LINES = 1;
export const MAX_PASSAGES = 14;
/**
 * Left edges within this fraction of the page width belong to the same column. Poppler's
 * own <block> grouping is too fine to use for this — a block is frequently a single line,
 * so treating block boundaries as passage boundaries reduced every passage to one line and
 * dropped similarity from ~0.70 to ~0.25.
 */
const COLUMN_GAP = 0.15;
/** Cosine floor. Below this the page matched for reasons no single passage explains. */
export const MIN_PASSAGE_SIMILARITY = 0.35;

/**
 * Group words into lines using the block/line indices poppler assigned, falling back to
 * vertical position for coordinate files written before those were recorded.
 *
 * This matters on multi-column pages: grouping by vertical position alone merges the left
 * and right columns into single lines, which garbles the passage text and produces
 * highlights spanning the whole page width instead of marking the passage.
 */
export function groupIntoLines(words: WordBox[]): Line[] {
  const hasLayout = words.some((word) => typeof word.l === 'number' && word.l >= 0);

  if (hasLayout) {
    const byLine = new Map<string, Line>();

    for (const word of words) {
      const block = word.b ?? 0;
      const key = `${block}:${word.l ?? 0}`;
      const line = byLine.get(key);

      if (line) {
        line.words.push(word);
        line.y = Math.min(line.y, word.y);
        line.height = Math.max(line.height, word.h);
        continue;
      }

      byLine.set(key, { words: [word], y: word.y, height: word.h, block, column: 0 });
    }

    const lines = [...byLine.values()];
    for (const line of lines) line.words.sort((a, b) => a.x - b.x);
    return assignColumns(lines);
  }

  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: Line[] = [];

  for (const word of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - word.y) < Math.max(word.h, current.height) * 0.6) {
      current.words.push(word);
      current.height = Math.max(current.height, word.h);
      continue;
    }
    lines.push({ words: [word], y: word.y, height: word.h, block: 0, column: 0 });
  }

  for (const line of lines) line.words.sort((a, b) => a.x - b.x);
  return assignColumns(lines);
}

/**
 * Assign each line to a column by clustering left edges, then order lines in reading order:
 * down one column, then down the next. This is what keeps a two-column page from
 * interleaving, while still letting a passage span consecutive paragraphs of one column.
 */
function assignColumns(lines: Line[]): Line[] {
  const edges = [...new Set(lines.map((line) => Math.min(...line.words.map((word) => word.x))))].sort(
    (a, b) => a - b,
  );

  const columnStarts: number[] = [];
  for (const edge of edges) {
    if (!columnStarts.length || edge - columnStarts[columnStarts.length - 1] > COLUMN_GAP) {
      columnStarts.push(edge);
    }
  }

  for (const line of lines) {
    const left = Math.min(...line.words.map((word) => word.x));
    let column = 0;
    for (let i = 0; i < columnStarts.length; i++) {
      if (left >= columnStarts[i] - 0.001) column = i;
    }
    line.column = column;
  }

  return [...lines].sort((a, b) => a.column - b.column || a.y - b.y);
}

export function buildPassages(lines: Line[]): Passage[] {
  const passages: Passage[] = [];
  let index = 0;

  while (index < lines.length && passages.length < MAX_PASSAGES) {
    const group: Line[] = [];
    let wordCount = 0;

    const startColumn = lines[index].column;

    while (index < lines.length && wordCount < TARGET_PASSAGE_WORDS) {
      // A passage that jumps columns is not a passage.
      if (group.length && lines[index].column !== startColumn) break;
      group.push(lines[index]);
      wordCount += lines[index].words.length;
      index += 1;
    }

    if (group.length) {
      passages.push({
        text: group.map((line) => line.words.map((word) => word.t).join(' ')).join(' '),
        lines: group,
      });
    }

    // Back up for overlap only when the group was long enough to spare a line. Backing up
    // after a single-line group — which happens at every column boundary — would advance the
    // index by nothing at all, spinning in place until MAX_PASSAGES and leaving the rest of
    // the page unexamined.
    if (index < lines.length && group.length > PASSAGE_OVERLAP_LINES) {
      index -= PASSAGE_OVERLAP_LINES;
    }
  }

  return passages;
}

/** One box per line, spanning that line's words. */
export function lineBoxes(lines: Line[]): { x: number; y: number; w: number; h: number }[] {
  return lines.map((line) => {
    const left = Math.min(...line.words.map((word) => word.x));
    const right = Math.max(...line.words.map((word) => word.x + word.w));
    const top = Math.min(...line.words.map((word) => word.y));
    const bottom = Math.max(...line.words.map((word) => word.y + word.h));
    return {
      x: Number(left.toFixed(4)),
      y: Number(top.toFixed(4)),
      w: Number((right - left).toFixed(4)),
      h: Number((bottom - top).toFixed(4)),
    };
  });
}
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}


export type PassageBox = { x: number; y: number; w: number; h: number };

/** One passage as stored on disk: its text, where to draw it, and its vector. */
export type StoredPassage = { text: string; boxes: PassageBox[] };

/**
 * Vectors are stored as base64 float32 rather than JSON numbers. A page runs to fourteen
 * 2048-dimension vectors; as JSON that is about 280 KB per page and 25 MB across the corpus,
 * against 13 MB base64, and base64 round-trips exactly where rounded decimals would not.
 */
export function encodeVectors(vectors: number[][]): string {
  const width = vectors[0]?.length ?? 0;
  const flat = new Float32Array(vectors.length * width);
  vectors.forEach((vector, i) => flat.set(vector, i * width));
  return Buffer.from(flat.buffer).toString('base64');
}

export function decodeVectors(encoded: string, width: number): Float32Array[] {
  const bytes = Buffer.from(encoded, 'base64');
  const flat = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const out: Float32Array[] = [];
  for (let i = 0; i + width <= flat.length; i += width) out.push(flat.subarray(i, i + width));
  return out;
}

/** Cosine against a stored vector, which arrives as a Float32Array rather than number[]. */
export function cosineTyped(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Where a page's precomputed passages live, given its image path. */
export function passagesFileFor(imageUrl: string): string {
  return imageUrl.replace(/\.png$/, '.passages.json');
}

/** Where a page's word coordinates live, given its image path. */
export function wordsFileFor(imageUrl: string): string {
  return imageUrl.replace(/\.png$/, '.words.json');
}
