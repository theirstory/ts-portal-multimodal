'use client';

import React from 'react';
import { Box, Tooltip } from '@mui/material';
import ArticleIcon from '@mui/icons-material/Article';
import ImageIcon from '@mui/icons-material/Image';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import { darken } from '@mui/material/styles';
import { Citation } from '@/types/chat';
import { useChatStore } from '@/app/stores/useChatStore';
import { useChatInteraction } from '@/app/discover/ChatInteractionContext';
import { colors } from '@/lib/theme';
import {
  SOURCE_TYPE_COLOR,
  SOURCE_TYPE_SHAPE,
  SOURCE_TYPE_LABEL,
  CHAPTER_SUMMARY_COLOR,
} from '@/lib/theme/sourceTypes';

type Props = {
  citation: Citation;
  siblings?: Citation[];
  messageId?: string;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}


/**
 * How each kind of citation looks inline.
 *
 * Colour alone was doing the work and doing it badly: images and chapter summaries were both
 * green, and documents sat a shade away from recordings, so a reader scanning a paragraph
 * could not tell what a claim rested on. Each kind now differs in three ways at once —
 * colour, shape, and a glyph — which survives both a fast scan and colour-blindness.
 *
 * Recordings keep the bare number and the pill shape they have always had, since they are
 * the common case and the baseline a reader learns first.
 */
type CitationLook = {
  bg: string;
  radius: string;
  Icon: typeof ArticleIcon | null;
  label: string;
};

function citationLook(citation: Citation): CitationLook {
  if (citation.sourceType === 'image') {
    return {
      bg: SOURCE_TYPE_COLOR.image,
      radius: SOURCE_TYPE_SHAPE.image,
      Icon: ImageIcon,
      label: SOURCE_TYPE_LABEL.image,
    };
  }
  if (citation.sourceType === 'document') {
    return {
      bg: SOURCE_TYPE_COLOR.document,
      radius: SOURCE_TYPE_SHAPE.document,
      Icon: ArticleIcon,
      label: SOURCE_TYPE_LABEL.document,
    };
  }
  if (citation.isChapterSynopsis) {
    return {
      bg: CHAPTER_SUMMARY_COLOR,
      radius: SOURCE_TYPE_SHAPE.recording,
      Icon: AutoStoriesIcon,
      label: 'Chapter summary',
    };
  }
  return {
    bg: SOURCE_TYPE_COLOR.recording,
    radius: SOURCE_TYPE_SHAPE.recording,
    Icon: null,
    label: SOURCE_TYPE_LABEL.recording,
  };
}

export const ChatCitationChip = ({ citation, siblings, messageId }: Props) => {
  const setActiveCitation = useChatStore((s) => s.setActiveCitation);
  const setHoveredCitationIndex = useChatStore((s) => s.setHoveredCitationIndex);
  const hoveredCitationIndex = useChatStore((s) => s.hoveredCitationIndex);
  const activeAssistantMessageId = useChatStore((s) => s.activeAssistantMessageId);
  const { onCitationClick } = useChatInteraction();

  // Only highlight if this chip belongs to the active assistant message (or no scoping)
  const isHighlighted = hoveredCitationIndex === citation.index &&
    (!activeAssistantMessageId || !messageId || activeAssistantMessageId === messageId);

  const isExhibit = citation.sourceType === 'document' || citation.sourceType === 'image';
  const look = citationLook(citation);

  const tooltipContent = isExhibit
    ? [
        look.label,
        `"${citation.interviewTitle}"`,
        citation.pageCount && citation.pageCount > 1 ? `page ${citation.page} of ${citation.pageCount}` : '',
        citation.batesNumber ? `Bates ${citation.batesNumber}` : '',
        // Worth stating: it changes how much weight the claim about this source deserves.
        citation.imageSentToModel ? 'read as an image' : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : citation.isChapterSynopsis
      ? `${look.label} — "${citation.interviewTitle}" · ${citation.sectionTitle}`
      : `${look.label} · ${citation.speaker} — "${citation.interviewTitle}" (${formatTime(citation.startTime)})`;

  return (
    <Tooltip title={tooltipContent} arrow placement="top">
      <Box
        component="span"
        data-citation-index={citation.index}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          if (onCitationClick) {
            onCitationClick(citation);
          } else {
            setActiveCitation(citation, siblings);
          }
        }}
        onMouseEnter={() => setHoveredCitationIndex(citation.index)}
        onMouseLeave={() => setHoveredCitationIndex(null)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.25,
          bgcolor: look.bg,
          color: colors.primary.contrastText,
          fontSize: '0.7rem',
          fontWeight: 700,
          borderRadius: look.radius,
          px: 0.6,
          py: 0.1,
          mx: 0.3,
          cursor: 'pointer',
          minWidth: 20,
          lineHeight: 1.4,
          verticalAlign: 'super',
          transition: 'all 0.15s',
          ...(isHighlighted && {
            transform: 'scale(1.3)',
            boxShadow: `0 0 0 2px ${colors.background.paper}, 0 0 0 4px ${look.bg}`,
          }),
          '&:hover': {
            bgcolor: darken(look.bg, 0.14),
          },
        }}>
        {look.Icon && <look.Icon sx={{ fontSize: '0.72rem' }} />}
        {citation.index}
      </Box>
    </Tooltip>
  );
};
