'use client';

import React from 'react';
import Box from '@mui/material/Box';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import { AudioFileWave } from '@/app/assets/svg/AudioFileWave';
import { getMuxPlaybackId } from '@/app/utils/converters';
import { colors } from '@/lib/theme';
import { Citation } from '@/types/chat';
import { SOURCE_TYPE_COLOR } from '@/lib/theme/sourceTypes';

/**
 * How a cited source is presented in the sources panel.
 *
 * The panel was built for recordings, so it assumed every source had a Mux poster frame and
 * a start and end time. Documents and images have neither: they showed an empty grey box and
 * a meaningless "0:00–0:00". These helpers keep all the render points in agreement about
 * what a source looks like and what identifies it.
 */

export type SourceLike = {
  sourceType?: Citation['sourceType'];
  videoUrl?: string;
  isAudioFile?: boolean;
  startTime?: number;
  thumbnailUrl?: string;
  page?: number;
  pageCount?: number;
};

export function isExhibit(source: SourceLike): boolean {
  return source.sourceType === 'document' || source.sourceType === 'image';
}

/**
 * The line that identifies a source: a timecode for a recording, where it sits in the
 * document for a page. Returns an empty string when there is nothing meaningful to say,
 * so callers can omit the element rather than render a placeholder.
 */
export function sourceMetaLabel(source: SourceLike, formatTime: (seconds: number) => string): string {
  if (isExhibit(source)) {
    const kind = source.sourceType === 'image' ? 'Image' : 'Document';
    if (source.pageCount && source.pageCount > 1) return `${kind} · page ${source.page} of ${source.pageCount}`;
    return kind;
  }

  const start = source.startTime ?? 0;
  const end = (source as { endTime?: number }).endTime ?? 0;
  // A recording clip with no span is a chapter or a whole-recording reference; a zeroed
  // timecode tells the reader nothing, so it is left off.
  if (!start && !end) return '';
  return `${formatTime(start)}–${formatTime(end)}`;
}

type ThumbnailProps = {
  source: SourceLike;
  alt: string;
  /** Pixel width; the box keeps a 16/9 frame to match the recording posters. */
  width?: number;
};

/**
 * A preview for any source type: the Mux poster for video, a waveform for audio, and the
 * rendered page for a document or image.
 */
export function SourceThumbnail({ source, alt, width = 64 }: ThumbnailProps) {
  const frame = {
    width,
    aspectRatio: '16/9',
    borderRadius: 1,
    bgcolor: colors.grey[200],
    flexShrink: 0,
    alignSelf: 'flex-start',
    mt: 0.25,
    overflow: 'hidden',
  } as const;

  if (isExhibit(source)) {
    if (source.thumbnailUrl) {
      return (
        <Box
          component="img"
          src={source.thumbnailUrl}
          alt={alt}
          loading="lazy"
          // Pages are portrait, so anchor to the top: the header of a document identifies it
          // far better than its middle.
          sx={{ ...frame, objectFit: 'cover', objectPosition: 'top' }}
        />
      );
    }

    return (
      <Box sx={{ ...frame, display: 'grid', placeItems: 'center', color: colors.grey[500] }}>
        {source.sourceType === 'image' ? (
          <ImageOutlinedIcon sx={{ fontSize: 20 }} />
        ) : (
          <ArticleOutlinedIcon sx={{ fontSize: 20 }} />
        )}
      </Box>
    );
  }

  const playbackId = getMuxPlaybackId(source.videoUrl ?? '');
  if (playbackId && !source.isAudioFile) {
    const at = Math.floor(source.startTime ?? 0);
    return (
      <Box
        component="img"
        src={`https://image.mux.com/${playbackId}/thumbnail.jpg?width=320&height=180&fit_mode=crop&time=${at}`}
        alt={alt}
        loading="lazy"
        sx={{ ...frame, objectFit: 'cover' }}
      />
    );
  }

  return (
    <Box sx={{ ...frame, display: 'grid', placeItems: 'center' }}>
      <AudioFileWave width="44" height="20" color={colors.grey[600]} />
    </Box>
  );
}

/** Accent used down the left edge of a row, matching the citation chips. */
export function sourceAccent(source: SourceLike, fallback: string): string {
  if (source.sourceType === 'image') return SOURCE_TYPE_COLOR.image;
  if (source.sourceType === 'document') return SOURCE_TYPE_COLOR.document;
  return fallback;
}
