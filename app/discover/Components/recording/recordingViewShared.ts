'use client';

import { Citation } from '@/types/chat';
import { colors } from '@/lib/theme';

export const CHAPTER_COLOR = colors.success.main;
export const CLIP_COLOR = colors.primary.main;

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
  /** Page thumbnail for an exhibit group, so the header shows the document. */
  thumbnailUrl?: string;
  chapters: (Citation & { clips: Citation[] })[];
  ungroupedClips: Citation[];
};

/**
 * The key a citation groups under.
 *
 * Recordings group by story id. Documents and images have no story id — it is the empty
 * string — so keying on it alone collapsed every exhibit in the panel into a single group,
 * titled after whichever arrived first and drawn with an audio waveform. They group by their
 * own document id instead: one group per document, its pages inside.
 */
function groupKey(citation: Citation): string {
  if (citation.sourceType === 'document' || citation.sourceType === 'image') {
    return `exhibit:${citation.sourceId ?? citation.interviewTitle}`;
  }
  return `recording:${citation.theirstoryId}`;
}

export function groupByRecording(citations: Citation[]): RecordingGroup[] {
  const recordingMap = new Map<string, { chapters: Citation[]; clips: Citation[] }>();
  const recordingOrder: string[] = [];
  const recordingMeta = new Map<
    string,
    {
      groupId: string;
      theirstoryId: string;
      interviewTitle: string;
      videoUrl: string;
      isAudioFile: boolean;
      sourceType?: Citation['sourceType'];
      thumbnailUrl?: string;
    }
  >();

  for (const citation of citations) {
    const id = groupKey(citation);
    if (!recordingMap.has(id)) {
      recordingMap.set(id, { chapters: [], clips: [] });
      recordingOrder.push(id);
      recordingMeta.set(id, {
        groupId: id,
        theirstoryId: citation.theirstoryId,
        interviewTitle: citation.interviewTitle,
        videoUrl: citation.videoUrl,
        isAudioFile: citation.isAudioFile ?? false,
        sourceType: citation.sourceType,
        thumbnailUrl: citation.thumbnailUrl,
      });
    }

    if (citation.isChapterSynopsis) {
      recordingMap.get(id)!.chapters.push(citation);
    } else {
      recordingMap.get(id)!.clips.push(citation);
    }
  }

  return recordingOrder.map((id) => {
    const { chapters, clips } = recordingMap.get(id)!;
    const meta = recordingMeta.get(id)!;
    const sortedChapters = [...chapters].sort((a, b) => a.startTime - b.startTime);
    const assignedClipIndexes = new Set<number>();
    const chaptersWithClips = sortedChapters.map((chapter) => {
      const chapterClips: Citation[] = [];
      clips.forEach((clip, idx) => {
        if (!assignedClipIndexes.has(idx) && clip.startTime >= chapter.startTime && clip.startTime < chapter.endTime) {
          chapterClips.push(clip);
          assignedClipIndexes.add(idx);
        }
      });
      chapterClips.sort((a, b) => a.startTime - b.startTime);
      return { ...chapter, clips: chapterClips };
    });

    const ungroupedClips = clips.filter((_, idx) => !assignedClipIndexes.has(idx));
    ungroupedClips.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.startTime - b.startTime);

    return {
      groupId: meta.groupId,
      theirstoryId: meta.theirstoryId,
      interviewTitle: meta.interviewTitle,
      videoUrl: meta.videoUrl,
      isAudioFile: meta.isAudioFile,
      sourceType: meta.sourceType,
      thumbnailUrl: meta.thumbnailUrl,
      chapters: chaptersWithClips,
      ungroupedClips,
    };
  });
}
