'use client';

import { Citation } from '@/types/chat';

export type SearchType = 'bm25' | 'vector' | 'hybrid';

export const SEARCH_TYPE_LABELS: Record<string, string> = {
  bm25: 'Keyword',
  vector: 'Thematic',
  hybrid: 'Hybrid',
};

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type RecordingGroup = {
  /**
   * Unique per group, and safe as a React key.
   *
   * theirstoryId used to serve that purpose, but it is the empty string for a document or
   * image, so once exhibits appeared every one of them keyed as "" and React warned about
   * duplicate keys — which risks rows being reused or dropped between renders.
   */
  groupId: string;
  theirstoryId: string;
  interviewTitle: string;
  videoUrl: string;
  isAudioFile: boolean;
  /** Set for document and image groups; absent for recordings. */
  sourceType?: Citation['sourceType'];
  thumbnailUrl?: string;
  results: Citation[];
};

/**
 * The key a citation groups under.
 *
 * Recordings group by their story id. Documents and images have no story id — it is the
 * empty string — so keying on it alone collapsed every exhibit in the panel into a single
 * bogus group titled after whichever one happened to arrive first. They group by their own
 * document id instead, which is what a reader expects: one group per document, its pages
 * inside it.
 */
function groupKey(citation: Citation): string {
  if (citation.sourceType === 'document' || citation.sourceType === 'image') {
    return `exhibit:${citation.sourceId ?? citation.interviewTitle}`;
  }
  return `recording:${citation.theirstoryId}`;
}

export function groupByRecording(citations: Citation[]): RecordingGroup[] {
  const map = new Map<string, Citation[]>();
  const order: string[] = [];
  const meta = new Map<string, Omit<RecordingGroup, 'results'>>();

  for (const c of citations) {
    const key = groupKey(c);
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
      meta.set(key, {
        groupId: key,
        theirstoryId: c.theirstoryId,
        interviewTitle: c.interviewTitle,
        videoUrl: c.videoUrl,
        isAudioFile: c.isAudioFile ?? false,
        sourceType: c.sourceType,
        thumbnailUrl: c.thumbnailUrl,
      });
    }
    map.get(key)!.push(c);
  }

  return order.map((key) => ({
    ...meta.get(key)!,
    // Recordings read in playback order; a document's pages read in page order.
    results: map.get(key)!.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.startTime - b.startTime),
  }));
}
