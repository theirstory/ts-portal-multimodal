'use server';

import { Chunks, SchemaTypes } from '@/types/weaviate';
import { Citation } from '@/types/chat';
import { initWeaviateClient } from './client';
import { getLocalEmbedding, bm25Search, vectorSearch, hybridSearch, getAllStoriesFromCollection } from './search';
import { QueryProperty } from 'weaviate-client';

const CHAT_RETURN_PROPS: QueryProperty<Chunks>[] = [
  'transcription',
  'speaker',
  'interview_title',
  'section_title',
  'start_time',
  'end_time',
  'theirstory_id',
  'video_url',
  'isAudioFile',
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSignificantOverlap(a: string, b: string): boolean {
  const wordsA = new Set(
    normalizeText(a)
      .split(' ')
      .filter((w) => w.length > 3),
  );
  const wordsB = new Set(
    normalizeText(b)
      .split(' ')
      .filter((w) => w.length > 3),
  );

  if (wordsA.size < 5 || wordsB.size < 5) return false;

  const smaller = wordsA.size <= wordsB.size ? wordsA : wordsB;
  const larger = wordsA.size <= wordsB.size ? wordsB : wordsA;

  let overlap = 0;
  for (const word of smaller) {
    if (larger.has(word)) overlap++;
  }

  return overlap / smaller.size > 0.6;
}

function deduplicateCitations(citations: Citation[]): Citation[] {
  const result: Citation[] = [];
  for (const c of citations) {
    const isDuplicate = result.some((existing) => {
      // Same interview, overlapping time ranges (within 2 seconds)
      if (existing.theirstoryId === c.theirstoryId) {
        const timeOverlap = existing.startTime <= c.endTime + 2 && c.startTime <= existing.endTime + 2;
        if (timeOverlap) return true;
      }
      // Content overlap
      return hasSignificantOverlap(existing.transcription, c.transcription);
    });
    if (!isDuplicate) {
      result.push(c);
    }
  }

  return result;
}

export async function retrieveChunksForChat(query: string, limit = 8): Promise<Citation[]> {
  const client = await initWeaviateClient();
  const myCollection = client.collections.get<Chunks>(SchemaTypes.Chunks);

  const vector = await getLocalEmbedding(query);

  const response = await myCollection.query.hybrid(query, {
    vector,
    alpha: 0.55,
    fusionType: 'RelativeScore',
    limit,
    returnMetadata: ['score'],
    returnProperties: CHAT_RETURN_PROPS,
  });

  const citations: Citation[] = response.objects.map((obj, idx) => {
    const props = obj.properties;
    return {
      index: idx + 1,
      transcription: props.transcription || '',
      speaker: props.speaker || '',
      interviewTitle: props.interview_title || '',
      sectionTitle: props.section_title || '',
      startTime: props.start_time,
      endTime: props.end_time,
      theirstoryId: props.theirstory_id || '',
      videoUrl: props.video_url || '',
      isAudioFile: props.isAudioFile || false,
      score: obj.metadata?.score ?? 0,
    };
  });

  const deduped = deduplicateCitations(citations);
  // Re-index after dedup
  return deduped.map((c, i) => ({ ...c, index: i + 1 }));
}

export async function retrieveChunksForSearch(
  query: string,
  searchType: 'bm25' | 'vector' | 'hybrid',
  limit = 10,
): Promise<Citation[]> {
  let response;

  if (searchType === 'bm25') {
    response = await bm25Search(
      SchemaTypes.Chunks,
      query,
      limit * 2,
      0,
      undefined,
      undefined,
      undefined,
      CHAT_RETURN_PROPS,
    );
  } else if (searchType === 'vector') {
    response = await vectorSearch(
      SchemaTypes.Chunks,
      query,
      limit * 2,
      0,
      undefined,
      undefined,
      undefined,
      CHAT_RETURN_PROPS,
      0.6,
      1.0,
    );
  } else {
    response = await hybridSearch(
      SchemaTypes.Chunks,
      query,
      limit * 2,
      0,
      undefined,
      undefined,
      undefined,
      CHAT_RETURN_PROPS,
      0.6,
      1.0,
    );
  }

  const citations: Citation[] = response.objects.map((obj, idx) => {
    const props = obj.properties as Chunks;
    return {
      index: idx + 1,
      transcription: props.transcription || '',
      speaker: props.speaker || '',
      interviewTitle: props.interview_title || '',
      sectionTitle: props.section_title || '',
      startTime: props.start_time,
      endTime: props.end_time,
      theirstoryId: props.theirstory_id || '',
      videoUrl: props.video_url || '',
      isAudioFile: props.isAudioFile || false,
      score: obj.metadata?.score ?? 0,
    };
  });

  const deduped = deduplicateCitations(citations);
  return deduped.slice(0, limit).map((c, i) => ({ ...c, index: i + 1 }));
}

export type ChapterSynopsis = {
  interviewTitle: string;
  sectionTitle: string;
  synopsis: string;
  theirstoryId: string;
  videoUrl: string;
  isAudioFile: boolean;
  startTime: number;
  endTime: number;
};

export async function retrieveAllChapterSynopses(): Promise<ChapterSynopsis[]> {
  const response = await getAllStoriesFromCollection(
    SchemaTypes.Testimonies,
    ['interview_title', 'transcription', 'video_url', 'isAudioFile'],
    500,
    0,
  );

  const synopses: ChapterSynopsis[] = [];
  for (const obj of response?.objects ?? []) {
    const props = obj.properties as Record<string, unknown>;
    const title = String(props?.interview_title ?? '');
    const storyId = obj.uuid ?? '';
    const videoUrl = String(props?.video_url ?? '');
    const isAudioFile = Boolean(props?.isAudioFile);
    const raw = props?.transcription;
    if (typeof raw !== 'string' || !raw) continue;

    try {
      const parsed = JSON.parse(raw) as {
        sections?: Array<{ title?: string; synopsis?: string; start?: number; end?: number }>;
      };
      for (const section of parsed?.sections ?? []) {
        const synopsis = section.synopsis?.trim();
        if (synopsis) {
          synopses.push({
            interviewTitle: title,
            sectionTitle: section.title?.trim() || 'Untitled',
            synopsis,
            theirstoryId: storyId,
            videoUrl,
            isAudioFile,
            startTime: section.start ?? 0,
            endTime: section.end ?? 0,
          });
        }
      }
    } catch {
      // skip unparseable transcriptions
    }
  }

  return synopses;
}

/**
 * Retrieve across every source type for Discover: transcript chunks, document pages, and
 * images, ranked together.
 *
 * This delegates to `multimodalSearch` rather than issuing its own queries, because merging
 * two classes naively is exactly the trap that function already solves. Raw scores are not
 * comparable across a vector space that holds both text and images — text-to-text similarity
 * runs systematically higher — so a naive merge buries every page and photograph beneath
 * mediocre transcript matches, and the chat quietly becomes transcript-only again.
 *
 * Hybrid, at the alpha Discover has always used, so its retrieval behaviour does not change
 * for recordings.
 */
export async function retrieveSourcesForChat(query: string, limit = 20): Promise<Citation[]> {
  const { multimodalSearch } = await import('./multimodalSearch');

  const { results } = await multimodalSearch(query, {
    mode: 'hybrid',
    hybridAlpha: 0.55,
    limit,
    // Chat cites a handful of sources, so spread them across documents rather than letting
    // one long deposition or report supply every citation.
    maxPerSource: 2,
  });

  return results.map((result, index) => {
    if (result.sourceType === 'recording') {
      return {
        index: index + 1,
        sourceType: 'recording' as const,
        transcription: result.snippet,
        speaker: result.speaker ?? '',
        interviewTitle: result.title,
        sectionTitle: result.sectionTitle ?? '',
        startTime: result.startTime ?? 0,
        endTime: result.endTime ?? 0,
        theirstoryId: result.storyId ?? '',
        videoUrl: result.videoUrl ?? '',
        isAudioFile: result.isAudioFile,
        score: result.score,
      };
    }

    return {
      index: index + 1,
      sourceType: result.sourceType,
      transcription: result.snippet,
      speaker: '',
      interviewTitle: result.title,
      sectionTitle: '',
      // A page has no timeline; these stay zero so existing consumers do not break.
      startTime: 0,
      endTime: 0,
      theirstoryId: '',
      videoUrl: '',
      score: result.score,
      sourceId: result.sourceId,
      page: result.page,
      pageCount: result.pageCount,
      imageUrl: result.imageUrl,
      thumbnailUrl: result.thumbnailUrl,
      sourceUrl: result.sourceUrl,
      batesNumber: result.archival?.batesForPage || result.archival?.batesNumber || '',
      caseNumber: result.archival?.caseNumbers?.[0] ?? '',
      exhibitNumber: result.exhibitNumber ?? '',
    };
  });
}
