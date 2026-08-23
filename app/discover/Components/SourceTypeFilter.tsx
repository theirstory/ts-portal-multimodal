'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { Citation, CitationSourceType } from '@/types/chat';
import { colors } from '@/lib/theme';

export const SOURCE_TYPE_ORDER: CitationSourceType[] = ['recording', 'document', 'image'];

const LABELS: Record<CitationSourceType, string> = {
  recording: 'Recordings',
  document: 'Documents',
  image: 'Images',
};

/** Matches the accents used on the unified search page and the citation chips. */
const ACCENTS: Record<CitationSourceType, string> = {
  recording: colors.primary.main,
  document: colors.info?.main ?? '#2f6f9f',
  image: colors.success?.main ?? '#3f7d58',
};

/** Citations predating multimodal Discover have no sourceType and are recordings. */
export function citationSourceType(citation: Citation): CitationSourceType {
  return citation.sourceType ?? 'recording';
}

export function countBySourceType(citations: Citation[]): Record<CitationSourceType, number> {
  const counts: Record<CitationSourceType, number> = { recording: 0, document: 0, image: 0 };
  for (const citation of citations) counts[citationSourceType(citation)] += 1;
  return counts;
}

export function filterBySourceTypes(citations: Citation[], active: CitationSourceType[]): Citation[] {
  // An empty selection means "no filter" rather than "nothing", so clearing every chip
  // shows everything instead of emptying the panel.
  if (!active.length || active.length === SOURCE_TYPE_ORDER.length) return citations;
  return citations.filter((citation) => active.includes(citationSourceType(citation)));
}

type Props = {
  citations: Citation[];
  active: CitationSourceType[];
  onToggle: (sourceType: CitationSourceType) => void;
};

/**
 * Filter the cited sources by kind.
 *
 * An answer can rest on testimony, on produced documents, and on photographs at once, and a
 * researcher checking it usually wants one of those at a time — "show me the documents this
 * claim rests on" is a different question from "show me who said it". Types with no
 * citations in the current answer are hidden rather than shown as dead zeroes.
 */
export function SourceTypeFilter({ citations, active, onToggle }: Props) {
  const counts = countBySourceType(citations);
  const present = SOURCE_TYPE_ORDER.filter((sourceType) => counts[sourceType] > 0);

  // Nothing to choose between when the answer draws on a single kind of source.
  if (present.length < 2) return null;

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
      {present.map((sourceType) => {
        const isActive = active.includes(sourceType);
        return (
          <Chip
            key={sourceType}
            size="small"
            label={`${LABELS[sourceType]} ${counts[sourceType]}`}
            onClick={() => onToggle(sourceType)}
            variant={isActive ? 'filled' : 'outlined'}
            sx={{
              height: 24,
              fontSize: '0.7rem',
              ...(isActive
                ? { backgroundColor: ACCENTS[sourceType], color: '#fff' }
                : { borderColor: ACCENTS[sourceType], color: ACCENTS[sourceType] }),
            }}
          />
        );
      })}
    </Box>
  );
}
