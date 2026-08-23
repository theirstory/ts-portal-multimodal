'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { colors } from '@/lib/theme';
import { useChatStore } from '@/app/stores/useChatStore';
import { SidePanelTranscriptView } from '@/app/discover/Components/SidePanelTranscriptView';
import type { MultimodalResult } from '@/lib/weaviate/multimodalSearch';

type Props = {
  result: MultimodalResult | null;
  onClose: () => void;
};

/**
 * A recording result opened in place, at the moment that matched.
 *
 * Search results used to open the story page in a new tab, which loses the result list and
 * makes comparing several hits tedious. This shows the same transcript view Discover uses —
 * player, chapters, and the full transcript scrolled to the matched passage — so the reader
 * stays in their search.
 *
 * It reuses SidePanelTranscriptView rather than reimplementing it. That view reads its
 * subject from the chat store, so opening one here means writing the result into that store
 * as a citation; the store is the shared vocabulary for "the moment currently being looked
 * at", whether a chat answer or a search result put it there.
 */
export function RecordingDetailDrawer({ result, onClose }: Props) {
  const openTranscript = useChatStore((s) => s.openTranscript);
  const isOpen = result !== null && result.sourceType === 'recording' && Boolean(result.storyId);

  React.useEffect(() => {
    if (!isOpen || !result) return;

    openTranscript({
      index: 0,
      transcription: result.snippet,
      speaker: result.speaker ?? '',
      interviewTitle: result.title,
      sectionTitle: result.sectionTitle ?? '',
      startTime: result.startTime ?? 0,
      endTime: result.endTime ?? 0,
      theirstoryId: result.storyId ?? '',
      videoUrl: result.videoUrl ?? '',
      isAudioFile: result.isAudioFile,
      sourceType: 'recording',
    });
  }, [isOpen, result, openTranscript]);

  return (
    <Drawer
      anchor="right"
      open={isOpen}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', md: 860 }, maxWidth: '100%' } }}>
      {result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              px: 2,
              py: 1.5,
              borderBottom: `1px solid ${colors.grey[200]}`,
              flexShrink: 0,
            }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                {result.title}
              </Typography>
              {(result.speaker || result.sectionTitle) && (
                <Typography variant="caption" color="text.secondary">
                  {[result.speaker, result.sectionTitle].filter(Boolean).join(' · ')}
                </Typography>
              )}
            </Box>
            <IconButton onClick={onClose} aria-label="Close" size="small">
              <CloseIcon />
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <SidePanelTranscriptView />
          </Box>
        </Box>
      )}
    </Drawer>
  );
}
