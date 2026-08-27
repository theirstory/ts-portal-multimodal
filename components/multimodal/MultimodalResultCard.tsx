'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import GraphicEqOutlinedIcon from '@mui/icons-material/GraphicEqOutlined';
import MovieOutlinedIcon from '@mui/icons-material/MovieOutlined';
import { AudioFileWave } from '@/app/assets/svg/AudioFileWave';
import { colors } from '@/lib/theme';
import { SOURCE_TYPE_COLOR, sourceTypeTint } from '@/lib/theme/sourceTypes';
import type { MultimodalResult, SourceType } from '@/lib/weaviate/multimodalSearch';

type Props = {
  result: MultimodalResult;
  showScores: boolean;
  /** Highest ranking score in the current result set, used to scale the relevance bar. */
  topScore: number;
  onSelect: (result: MultimodalResult) => void;
};

const SOURCE_LABELS: Record<SourceType, string> = {
  recording: 'Recording',
  document: 'Document',
  image: 'Image',
};

/** The shared palette, so a colour means the same thing here as in a Discover answer. */
const SOURCE_ACCENTS = SOURCE_TYPE_COLOR;

function formatTimecode(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds)) return '';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/**
 * The span the excerpt covers, as "44:31–44:58".
 *
 * Weaviate gives an end time for most chunks but not all, so a lone start is shown on its
 * own rather than as an open-ended range.
 */
function formatSpan(start?: number, end?: number): string {
  if (start === undefined || Number.isNaN(start)) return '';
  const from = formatTimecode(start);
  if (end === undefined || Number.isNaN(end) || end <= start) return from;
  return `${from}–${formatTimecode(end)}`;
}

function clamp01(value: number): number {
  return Math.max(Math.min(value, 1), 0);
}

function SourceIcon({ result, fontSize = 17 }: { result: MultimodalResult; fontSize?: number }) {
  const sx = { fontSize };

  if (result.sourceType === 'recording') {
    return result.isAudioFile ? <GraphicEqOutlinedIcon sx={sx} /> : <MovieOutlinedIcon sx={sx} />;
  }
  return result.sourceType === 'image' ? <ImageOutlinedIcon sx={sx} /> : <ArticleOutlinedIcon sx={sx} />;
}

/**
 * Every result gets a thumbnail, so the type and gist of a hit are legible at a glance
 * rather than only from its title: a page thumbnail for documents and images, a Mux poster
 * frame at the matched moment for video, and a waveform for audio, which has no frame.
 *
 * These are the small renders from `yarn oida:thumbnails`, not the full page images — those
 * run to 23 MB apiece, and a result page was pulling tens of megabytes to draw this column.
 */
function Thumbnail({ result, accent }: { result: MultimodalResult; accent: string }) {
  const [failed, setFailed] = React.useState(false);
  const src = result.thumbnailUrl && !failed ? result.thumbnailUrl : '';

  return (
    <Box
      sx={{
        position: 'relative',
        flexShrink: 0,
        width: { xs: 56, sm: 92 },
        height: { xs: 56, sm: 92 },
        borderRadius: 1,
        overflow: 'hidden',
        border: `1px solid ${colors.grey[200]}`,
        backgroundColor: colors.grey[100],
        display: 'grid',
        placeItems: 'center',
      }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
        />
      ) : result.sourceType === 'recording' && result.isAudioFile ? (
        <AudioFileWave width="42" height="26" color={colors.grey[600]} />
      ) : (
        <Box sx={{ color: colors.grey[500], display: 'grid', placeItems: 'center' }}>
          <SourceIcon result={result} fontSize={26} />
        </Box>
      )}

      {result.sourceType !== 'recording' && result.pageCount !== undefined && result.pageCount > 1 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            px: 0.4,
            borderRadius: 0.5,
            fontSize: '0.62rem',
            backgroundColor: colors.common?.overlay ?? 'rgba(0,0,0,0.65)',
            color: '#fff',
          }}>
          {result.page}/{result.pageCount}
        </Box>
      )}

      <Box sx={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', backgroundColor: accent }} />
    </Box>
  );
}

export function MultimodalResultCard({ result, showScores, topScore, onSelect }: Props) {
  const accent = SOURCE_ACCENTS[result.sourceType];
  const hasSnippet = Boolean(result.snippet);
  // Relevance relative to the best hit in this set: an absolute cosine means little to a
  // reader, but "how close to the top result" is directly useful when scanning.
  //
  // A top score of zero means nothing was ranked — the browse listing — so the bar is
  // hidden rather than drawn empty next to a meaningless 0.00.
  const ranked = topScore > 0;
  // Match strength as one 0-100 scale across both retrievals, since a bare BM25 6.7 beside a
  // semantic 0.82 said nothing about which was the better hit.
  //
  // The two are computed differently because they have to be. A semantic score is a
  // calibrated certainty already on 0-1, so it converts directly. BM25 is unbounded and
  // corpus-dependent, with no ceiling to divide by, so a keyword hit is scored against the
  // best hit for this query. Dividing semantic scores by the top hit as well would have been
  // tidier but worse: they cluster so tightly that the whole 40-result set spanned 100% down
  // to only 75%, so the last and weakest result on the page would still have claimed 75%.
  const match = !ranked
    ? 0
    : result.mode === 'keyword'
      ? Math.round(clamp01(result.score / topScore) * 100)
      : Math.round(clamp01(result.score) * 100);
  const relative = match / 100;
  const span = result.sourceType === 'recording' ? formatSpan(result.startTime, result.endTime) : '';
  const detail =
    result.sourceType === 'recording' ? [span, result.speaker, result.sectionTitle].filter(Boolean).join(' · ') : '';

  return (
    <Box
      onClick={() => onSelect(result)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(result);
        }
      }}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: { xs: 1.25, sm: 1.5 },
        px: { xs: 1.25, sm: 1.5 },
        py: 1.25,
        borderRadius: 1.5,
        border: `1px solid ${colors.grey[200]}`,
        borderLeft: `4px solid ${accent}`,
        backgroundColor: colors.common?.white ?? '#fff',
        cursor: 'pointer',
        // A card is a layout box before it is a control, so its touch target comes from its
        // own content rather than a global min-height on [role='button'] — see globals.css.
        // `overflow: hidden` is the belt to that braces: whatever a browser does to this
        // box's height, its text is clipped to it instead of printed over the next result.
        overflow: 'hidden',
        transition: 'box-shadow 120ms ease, border-color 120ms ease',
        '&:hover': { boxShadow: 2, borderColor: accent },
        '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
      }}>
      <Thumbnail result={result} accent={accent} />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'nowrap', mb: 0.25 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.4,
              color: accent,
              backgroundColor: sourceTypeTint(result.sourceType),
              borderRadius: 0.75,
              px: 0.6,
              py: 0.15,
              flexShrink: 0,
            }}>
            <SourceIcon result={result} fontSize={14} />
            <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.3, fontSize: '0.64rem' }}>
              {SOURCE_LABELS[result.sourceType].toUpperCase()}
            </Typography>
          </Box>

          {result.exhibitNumber && (
            <Typography
              variant="caption"
              sx={{
                color: colors.text?.secondary,
                fontSize: '0.66rem',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {result.exhibitNumber}
            </Typography>
          )}

          <Box sx={{ flex: 1 }} />

          {/* Relevance, as a bar plus the number behind it. */}
          {ranked && (
            <Tooltip
              title={
                result.mode === 'keyword'
                  ? `${match}% as strong a term match as the top hit for this query (BM25 ${result.score.toFixed(2)}). BM25 has no fixed ceiling, so keyword matches are scored against the best hit.`
                  : `${match}% match. Raw certainty ${result.certainty.toFixed(3)}, ranked at ${result.score.toFixed(3)} after this source type's calibration offset.` +
                    (result.embeddedModality ? ` Embedded as ${result.embeddedModality}.` : '')
              }>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                <Box sx={{ width: { xs: 38, sm: 54 }, height: 5, borderRadius: 3, backgroundColor: colors.grey[200] }}>
                  <Box sx={{ width: `${relative * 100}%`, height: '100%', borderRadius: 3, backgroundColor: accent }} />
                </Box>
                {showScores && (
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.64rem',
                      color: colors.text?.secondary,
                      minWidth: 30,
                      textAlign: 'right',
                    }}>
                    {match}%
                  </Typography>
                )}
              </Box>
            </Tooltip>
          )}
        </Box>

        <Typography
          variant="caption"
          sx={{
            // Two lines on a phone, one on a wide screen. These titles distinguish themselves
            // late — "Deposition of Matthew Harbaugh, President and CEO of Specialty
            // Generics…" — so on a 375px column a single ellipsised line named nobody.
            display: '-webkit-box',
            WebkitLineClamp: { xs: 2, md: 1 },
            WebkitBoxOrient: 'vertical',
            fontWeight: 600,
            fontSize: { xs: '0.75rem', sm: '0.72rem' },
            lineHeight: 1.3,
            mb: 0.35,
            color: colors.text?.secondary,
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}>
          {result.title || 'Untitled'}
        </Typography>

        {hasSnippet ? (
          <Typography
            variant="body2"
            sx={{
              fontSize: { xs: '0.9rem', sm: '0.95rem' },
              lineHeight: 1.45,
              color: colors.text?.primary,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}>
            {result.snippet}
          </Typography>
        ) : (
          // Photographs carry no OCR text at all: they were retrieved from the image alone.
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem', fontStyle: 'italic' }}>
            No text on this page — matched on the image itself.
          </Typography>
        )}

        {/*
          Where the excerpt sits, who is speaking, and which chapter it falls in. This used to
          share the top line with the type badge and the score, which left four things
          competing for one row: the chapter title was cut to an ellipsis and the score wrapped
          onto a line of its own. Underneath the snippet it has the width to be read.
        */}
        {detail && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.4,
              color: colors.text?.secondary,
              fontSize: '0.7rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {detail}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
