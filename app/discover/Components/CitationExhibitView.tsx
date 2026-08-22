'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { colors } from '@/lib/theme';
import { Citation } from '@/types/chat';

type Props = { citation: Citation };

/**
 * A cited document page or image, shown in the Discover side panel.
 *
 * The recording view mounts a player and seeks to a timestamp; a page has neither, so it
 * gets the page image and the provenance a researcher needs to cite it — Bates number first,
 * since that is how the page is referenced in a filing.
 *
 * When the page image was sent to the model, that is stated plainly. A reader deciding
 * whether to trust a claim about a photograph needs to know the difference between the model
 * having read the image and the model having paraphrased a catalogue title.
 */
export function CitationExhibitView({ citation }: Props) {
  const provenance = [
    citation.batesNumber ? `Bates ${citation.batesNumber}` : '',
    citation.exhibitNumber || '',
    citation.caseNumber || '',
  ].filter(Boolean);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {citation.imageSentToModel && (
        <Tooltip title="This page carries little or no machine-readable text, so the image itself was sent to the model. Its description of this source comes from looking at the page.">
          <Chip
            size="small"
            icon={<VisibilityOutlinedIcon sx={{ fontSize: 15 }} />}
            label="read as an image"
            sx={{
              alignSelf: 'flex-start',
              backgroundColor: 'rgba(56,132,255,0.12)',
              color: colors.info?.main ?? '#2f6f9f',
              fontSize: '0.68rem',
              height: 22,
            }}
          />
        </Tooltip>
      )}

      {citation.imageUrl && (
        <Box
          sx={{
            borderRadius: 2,
            overflow: 'hidden',
            border: `1px solid ${colors.grey[200]}`,
            backgroundColor: colors.grey[100],
            lineHeight: 0,
          }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={citation.imageUrl}
            alt={citation.interviewTitle}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Box>
      )}

      <Box>
        <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
          {citation.interviewTitle}
        </Typography>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {citation.sourceType === 'image' ? 'Image' : 'Document'}
          {citation.pageCount && citation.pageCount > 1 ? ` · page ${citation.page} of ${citation.pageCount}` : ''}
        </Typography>

        {provenance.length > 0 && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              color: colors.text?.secondary,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '0.68rem',
              wordBreak: 'break-word',
            }}>
            {provenance.join(' · ')}
          </Typography>
        )}
      </Box>

      {citation.transcription && (
        <Typography
          variant="body2"
          sx={{
            fontSize: '0.78rem',
            color: colors.text?.secondary,
            maxHeight: 180,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
          {citation.transcription}
        </Typography>
      )}

      {citation.sourceUrl && (
        <Link
          href={citation.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: '0.78rem' }}>
          View source in the Industry Documents Library
          <OpenInNewIcon sx={{ fontSize: 14 }} />
        </Link>
      )}
    </Box>
  );
}
