'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap';
import { colors } from '@/lib/theme';
import type { SearchMode } from '@/lib/weaviate/multimodalSearch';
import { queryTerms, wordMatchesTerms } from './queryTerms';

type Rect = { x: number; y: number; w: number; h: number };
type WordBox = Rect & { t: string };
type PageWords = { page: number; words: WordBox[] };
type SemanticPassage = { similarity: number; text: string; boxes: Rect[] };

/**
 * How far "zoomed in" goes.
 *
 * 2.6x fit-width puts a US Letter page's body text at roughly 11px on a 390px phone, which
 * is the point of the exercise: readable without pinching. It is a single step rather than a
 * range because there is only one question being asked here — can I read this or not.
 */
const ZOOMED = 2.6;

type Props = {
  /** Rendered page image, e.g. /oida/pages/ffbd0426/p-14.png */
  imageUrl: string;
  alt: string;
  query: string;
  mode: SearchMode;
};

/**
 * Merge boxes that sit on the same line and touch, so a matched phrase reads as one
 * highlight rather than a row of separate blocks.
 */
function mergeAdjacent(boxes: WordBox[]): Rect[] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: Rect[] = [];

  for (const box of sorted) {
    const last = merged[merged.length - 1];
    const sameLine = last && Math.abs(last.y - box.y) < box.h * 0.5;
    const adjacent = last && box.x - (last.x + last.w) < box.h * 0.6;

    if (sameLine && adjacent) {
      const right = Math.max(last.x + last.w, box.x + box.w);
      last.x = Math.min(last.x, box.x);
      last.w = right - last.x;
      last.h = Math.max(last.h, box.h);
      continue;
    }

    merged.push({ x: box.x, y: box.y, w: box.w, h: box.h });
  }

  return merged;
}

/**
 * The page image with the relevant part marked on it, in two layers:
 *
 *  - a band over the passage the *semantic* search scored highest, which is the only thing
 *    that helps when the query and the page share no vocabulary
 *  - marks on the individual query terms, where they literally appear
 *
 * Both rely on word coordinates extracted from the PDF text layer at ingest time (see
 * scripts/oida/extract-word-boxes.ts) and stored as fractions of the page, so they overlay
 * correctly at whatever size the page is rendered. Pages with no usable text layer — scans,
 * photographs — have no coordinates and simply render the image.
 *
 * The legend sits above the image rather than over its bottom edge: it explains what the
 * marks mean, and hiding that behind a scroll on a tall page defeats the purpose.
 */
export function PageImageWithHighlights({ imageUrl, alt, query, mode }: Props) {
  const [words, setWords] = React.useState<WordBox[] | null>(null);
  const [passage, setPassage] = React.useState<SemanticPassage | null>(null);
  const [passageState, setPassageState] = React.useState<'idle' | 'loading' | 'done'>('idle');
  /** 1 means fit the width. Anything more scrolls inside the viewport below. */
  const [zoom, setZoom] = React.useState(1);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setWords(null);
    setZoom(1);

    if (!imageUrl) return;

    fetch(imageUrl.replace(/\.png$/, '.words.json'))
      .then((response) => (response.ok ? response.json() : null))
      .then((body: PageWords | null) => {
        if (!cancelled) setWords(body?.words ?? []);
      })
      .catch(() => {
        // A missing coordinate file is expected for scanned pages, not an error.
        if (!cancelled) setWords([]);
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  // Ask the server which passage the model considers closest to the query. Skipped only for
  // keyword search, where the terms themselves are the answer and are already marked. Any
  // other query is a description of meaning — a semantic search, or a question put to
  // Discover — and is worth locating on the page.
  React.useEffect(() => {
    let cancelled = false;
    setPassage(null);

    if (!imageUrl || !query || mode === 'keyword') {
      setPassageState('done');
      return;
    }

    setPassageState('loading');

    fetch('/api/search/passages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, query }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { passages?: SemanticPassage[] } | null) => {
        if (!cancelled) setPassage(body?.passages?.[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setPassage(null);
      })
      .finally(() => {
        if (!cancelled) setPassageState('done');
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, query, mode]);

  const termHighlights = React.useMemo(() => {
    if (!words?.length) return [];

    const terms = queryTerms(query);
    if (!terms.length) return [];

    let matched = words.filter((word) => wordMatchesTerms(word.t, terms));

    // A natural-language query shares ordinary words with the whole page — "patient",
    // "with", "history" — so marking every occurrence lights up the page and drowns out the
    // passage band that is the actual answer. When a passage has been located, confine the
    // marks to it. Keyword searches mark everything, because there the terms *are* the answer.
    if (passage?.boxes.length) {
      matched = matched.filter((word) =>
        passage.boxes.some((box) => {
          const verticallyInside = word.y + word.h > box.y && word.y < box.y + box.h;
          const horizontallyInside = word.x + word.w > box.x - 0.01 && word.x < box.x + box.w + 0.01;
          return verticallyInside && horizontallyInside;
        }),
      );
    }

    return mergeAdjacent(matched);
  }, [words, query, passage]);

  /**
   * Where to look first when the page is enlarged: the closest passage if the model found
   * one, otherwise the first literal term match, otherwise the top of the page. Zooming into
   * the middle of a page and leaving the reader to find the highlight themselves is most of
   * the work the highlight was supposed to save them.
   */
  const focusPoint = React.useMemo(() => {
    const box = passage?.boxes?.[0] ?? termHighlights[0];
    if (!box) return null;
    return { fx: box.x + box.w / 2, fy: box.y + box.h / 2 };
  }, [passage, termHighlights]);

  /**
   * Enlarge the page and bring a point of it into view.
   *
   * The scroll has to wait for the layout the new zoom produces, hence the frame delay —
   * scrollWidth is still the old width in the same tick.
   */
  const applyZoom = React.useCallback(
    (next: number, focus: { fx: number; fy: number } | null) => {
      setZoom(next);

      if (next === 1) return;

      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const target = focus ?? focusPoint ?? { fx: 0.5, fy: 0 };
        viewport.scrollLeft = target.fx * viewport.scrollWidth - viewport.clientWidth / 2;
        viewport.scrollTop = target.fy * viewport.scrollHeight - viewport.clientHeight / 2;
      });
    },
    [focusPoint],
  );

  // A page rendered to the width of a phone is a picture of text, not text. Tapping it is
  // the gesture everyone already tries, so it is the one that enlarges — at the point that
  // was tapped, so a reader can aim at the passage they want.
  const handlePageClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (zoom > 1) {
        applyZoom(1, null);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      applyZoom(ZOOMED, {
        fx: (event.clientX - rect.left) / rect.width,
        fy: (event.clientY - rect.top) / rect.height,
      });
    },
    [applyZoom, zoom],
  );

  const locating = passageState === 'loading';
  // Hold the term marks until the passage has settled. Drawing them first and re-scoping
  // them a second later reads as a glitch: the same page flashes ~30 marks, then 3.
  const showTerms = !locating && termHighlights.length > 0;
  const hasTextLayer = words !== null && words.length > 0;
  const settledWithNothing = passageState === 'done' && words !== null && !passage && !termHighlights.length;

  return (
    <Box>
      {/* Legend first, so it is visible without scrolling a tall page. */}
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mb: 1, minHeight: 24 }}>
        {locating && (
          <Chip
            size="small"
            icon={<CircularProgress size={11} thickness={6} sx={{ ml: 0.75, color: 'inherit' }} />}
            label="locating closest passage…"
            sx={{ backgroundColor: colors.grey[200], fontSize: '0.68rem', height: 22 }}
          />
        )}

        {passage && (
          <Tooltip title="The passage on this page whose meaning is closest to the query, scored by the same model that retrieved the page. Shown in blue.">
            <Chip
              size="small"
              label={`closest passage · ${passage.similarity.toFixed(2)}`}
              sx={{ backgroundColor: 'rgba(56,132,255,0.9)', color: '#fff', fontSize: '0.68rem', height: 22 }}
            />
          </Tooltip>
        )}

        {showTerms && (
          <Tooltip
            title={
              passage
                ? 'Your search terms, where they appear inside the closest passage. Shown in yellow.'
                : 'Your search terms, where they appear on this page. Shown in yellow.'
            }>
            <Chip
              size="small"
              label={
                passage
                  ? `${termHighlights.length} term${termHighlights.length === 1 ? '' : 's'} in passage`
                  : `${termHighlights.length} term match${termHighlights.length === 1 ? '' : 'es'}`
              }
              sx={{ backgroundColor: 'rgba(170,120,0,0.92)', color: '#fff', fontSize: '0.68rem', height: 22 }}
            />
          </Tooltip>
        )}

        {!hasTextLayer && words !== null && (
          <Tooltip title="This page is a scan with no text layer, so there is nothing to position a highlight against. It was retrieved from the page image itself.">
            <Chip
              size="small"
              label="no text layer — matched on the image"
              sx={{ backgroundColor: colors.grey[300], fontSize: '0.68rem', height: 22 }}
            />
          </Tooltip>
        )}

        {hasTextLayer && settledWithNothing && (
          <Chip
            size="small"
            label="no single passage stood out — matched on the page as a whole"
            sx={{ backgroundColor: colors.grey[300], fontSize: '0.68rem', height: 22 }}
          />
        )}

        <Box sx={{ flex: 1, minWidth: 4 }} />

        <Tooltip title={zoom > 1 ? 'Fit the page to the width' : 'Enlarge the page to read it'}>
          <IconButton
            size="small"
            aria-label={zoom > 1 ? 'Fit page to width' : 'Enlarge page'}
            onClick={() => applyZoom(zoom > 1 ? 1 : ZOOMED, null)}
            sx={{ width: 34, height: 34, color: colors.text?.secondary }}>
            {zoom > 1 ? <ZoomOutMapIcon fontSize="small" /> : <ZoomInIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {/*
        At fit-width this is a plain image in a bordered box. Enlarged, it becomes a viewport
        the page is panned inside: bounded in height so the drawer around it does not turn
        into a mile of scroll, and scrolled straight to the highlight.
      */}
      <Box
        ref={viewportRef}
        onClick={handlePageClick}
        sx={{
          position: 'relative',
          lineHeight: 0,
          border: `1px solid ${colors.grey[200]}`,
          borderRadius: 1,
          overflow: zoom > 1 ? 'auto' : 'hidden',
          maxHeight: zoom > 1 ? { xs: '68vh', md: '80vh' } : 'none',
          WebkitOverflowScrolling: 'touch',
          backgroundColor: colors.grey[100],
          cursor: zoom > 1 ? 'zoom-out' : 'zoom-in',
        }}>
        {/*
          maxWidth: none is load-bearing on a phone. globals.css caps every element at 100vw
          there, which silently pinned this wrapper to the screen width and made zooming look
          like it did nothing — the page has to be allowed to be wider than the window for
          there to be anything to pan.
        */}
        <Box sx={{ position: 'relative', width: `${zoom * 100}%`, maxWidth: 'none', lineHeight: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={alt}
            // Same reason as the wrapper: the mobile 100vw cap would otherwise hold the image
            // at screen width while the highlight boxes scaled with the wrapper around it,
            // and the marks would drift off the words they belong to.
            style={{ width: '100%', maxWidth: 'none', height: 'auto', display: 'block' }}
          />

          {/* Semantic passage: a soft band behind the term marks. */}
          {passage?.boxes.map((box, index) => (
            <Box
              key={`passage-${index}`}
              aria-hidden
              sx={{
                position: 'absolute',
                left: `${Math.max(box.x - 0.004, 0) * 100}%`,
                top: `${Math.max(box.y - 0.002, 0) * 100}%`,
                width: `${(box.w + 0.008) * 100}%`,
                height: `${(box.h + 0.004) * 100}%`,
                backgroundColor: 'rgba(56, 132, 255, 0.20)',
                mixBlendMode: 'multiply',
                borderRadius: '2px',
                pointerEvents: 'none',
              }}
            />
          ))}

          {/* Literal query terms, drawn on top so they stay findable inside the band. */}
          {showTerms &&
            termHighlights.map((box, index) => (
              <Box
                key={`term-${index}`}
                aria-hidden
                sx={{
                  position: 'absolute',
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  // Multiply keeps the words legible through the highlight, like a marker.
                  backgroundColor: 'rgba(255, 215, 0, 0.45)',
                  mixBlendMode: 'multiply',
                  borderRadius: '2px',
                  outline: '1px solid rgba(214, 158, 0, 0.55)',
                  pointerEvents: 'none',
                }}
              />
            ))}
        </Box>
      </Box>
    </Box>
  );
}
