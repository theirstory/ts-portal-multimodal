import { colors } from './colors';

/**
 * One palette for the three kinds of primary source, used everywhere they appear:
 * the All Sources result cards, the inline citations in a Discover answer, and the
 * sources panel beside it.
 *
 * It lives here rather than in any one component because the same source shows up in all
 * three places, and the whole point is that a reader learns "amber means a produced
 * document" once. Two components picking their own blues taught them nothing.
 *
 * Amber and violet were chosen to sit far from the portal's blues and greens, which were
 * already spoken for by recordings and chapter summaries. Colour is never the only signal —
 * see `SOURCE_TYPE_SHAPE` — because these hues are nearly identical in greyscale.
 */
export type SourceKind = 'recording' | 'document' | 'image';

export const SOURCE_TYPE_COLOR: Record<SourceKind, string> = {
  recording: colors.primary.main,
  document: '#b06a00',
  image: '#7b4bc4',
};

/** Chapter summaries are recordings, but distinct enough to earn their own accent. */
export const CHAPTER_SUMMARY_COLOR = colors.success.main;

/**
 * Shape carries the distinction where colour cannot: in greyscale the portal blue and green
 * differ by about 2 luma, so a colour-blind reader or a printed page needs another signal.
 */
export const SOURCE_TYPE_SHAPE: Record<SourceKind, string> = {
  recording: '9px',
  document: '2px',
  image: '50%',
};

export const SOURCE_TYPE_LABEL: Record<SourceKind, string> = {
  recording: 'Recording',
  document: 'Document',
  image: 'Image',
};

/** Plural form, for filter chips and counts. */
export const SOURCE_TYPE_LABEL_PLURAL: Record<SourceKind, string> = {
  recording: 'Recordings',
  document: 'Documents',
  image: 'Images',
};

/** A tint of the accent, for card backgrounds and left borders. */
export function sourceTypeTint(kind: SourceKind, alpha = 0.08): string {
  const hex = SOURCE_TYPE_COLOR[kind].replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
