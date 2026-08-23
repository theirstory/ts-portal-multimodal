'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useChatStore } from '@/app/stores/useChatStore';
import { Citation } from '@/types/chat';
import { colors } from '@/lib/theme';
import { highlightSearchText } from '@/app/indexes/highlightSearch';
import { CHAPTER_COLOR, CLIP_COLOR, formatTime, groupByRecording } from './recordingViewShared';
import { SourceThumbnail, sourceMetaLabel, sourceAccent } from './sourcePresentation';

const ExpandableText = ({ text, highlight = '' }: { text: string; highlight?: string }) => {
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    }
  }, [text, expanded]);

  return (
    <>
      <Typography
        ref={textRef}
        variant="body2"
        color="text.primary"
        sx={{
          mt: 0.5,
          lineHeight: 1.5,
          ...(!expanded && {
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }),
        }}>
        {highlightSearchText(text, highlight)}
      </Typography>
      {(isClamped || expanded) && (
        <Typography
          component="span"
          variant="caption"
          color="primary"
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          sx={{ cursor: 'pointer', fontWeight: 600, mt: 0.25, display: 'inline-block' }}>
          {expanded ? 'Show less' : 'Show more'}
        </Typography>
      )}
    </>
  );
};

export const CitationBadge = ({
  index,
  isChapter,
  onClick,
}: {
  index: number;
  isChapter: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) => (
  <Tooltip title={onClick ? 'Scroll to citation in chat' : ''}>
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: isChapter ? CHAPTER_COLOR : CLIP_COLOR,
        color: colors.primary.contrastText,
        fontWeight: 700,
        fontSize: '0.7rem',
        borderRadius: '4px',
        minWidth: 20,
        height: 20,
        flexShrink: 0,
        px: 0.4,
        ...(onClick && {
          cursor: 'pointer',
          transition: 'transform 0.15s',
          '&:hover': {
            transform: 'scale(1.2)',
            boxShadow: `0 0 0 2px ${colors.background.paper}, 0 0 0 3px ${isChapter ? CHAPTER_COLOR : CLIP_COLOR}`,
          },
        }),
      }}>
      {index}
    </Box>
  </Tooltip>
);

export function NumberedSourcesView({
  citations,
  filterTerm,
  onSelectCitation,
}: {
  citations: Citation[];
  filterTerm: string;
  onSelectCitation: (citation: Citation) => void;
}) {
  const sorted = useMemo(() => [...citations].sort((a, b) => a.index - b.index), [citations]);
  const hoveredCitationIndex = useChatStore((s) => s.hoveredCitationIndex);
  const hoveredFromPanel = useChatStore((s) => s.hoveredFromPanel);
  const setHoveredCitationIndex = useChatStore((s) => s.setHoveredCitationIndex);
  const scrollToCitation = useChatStore((s) => s.scrollToCitation);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hoveredCitationIndex === null || hoveredFromPanel || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-citation-index="${hoveredCitationIndex}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [hoveredCitationIndex, hoveredFromPanel]);

  if (citations.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
        No sources match your filter.
      </Typography>
    );
  }

  const highlightSx = (index: number) => ({
    ...(hoveredCitationIndex === index && {
      bgcolor: `${colors.primary.main}14`,
      boxShadow: `inset 3px 0 0 ${colors.primary.main}`,
    }),
  });

  return (
    <Box ref={containerRef}>
      {sorted.map((citation) => {
        const isChapter = !!citation.isChapterSynopsis;
        const accentColor = sourceAccent(citation, isChapter ? CHAPTER_COLOR : CLIP_COLOR);

        return (
          <Box
            key={`num-${citation.index}`}
            data-citation-index={citation.index}
            onClick={() => onSelectCitation(citation)}
            onMouseEnter={() => setHoveredCitationIndex(citation.index, true)}
            onMouseLeave={() => setHoveredCitationIndex(null)}
            sx={{
              display: 'flex',
              gap: 1.5,
              px: 2,
              py: 1.25,
              cursor: 'pointer',
              borderBottom: '1px solid',
              borderColor: 'divider',
              borderLeft: `3px solid ${accentColor}`,
              '&:hover': { bgcolor: colors.grey[50] },
              transition: 'all 0.15s',
              ...highlightSx(citation.index),
            }}>
            <SourceThumbnail source={citation} alt={citation.interviewTitle} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                <CitationBadge
                  index={citation.index}
                  isChapter={isChapter}
                  onClick={(e) => {
                    e.stopPropagation();
                    scrollToCitation(citation.index);
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
                  {isChapter ? (
                    <>
                      {highlightSearchText(citation.interviewTitle, filterTerm)} &middot;{' '}
                      {highlightSearchText(citation.sectionTitle, filterTerm)}
                    </>
                  ) : (
                    <>
                      {highlightSearchText(citation.speaker, filterTerm)} &middot;{' '}
                      {highlightSearchText(citation.sectionTitle, filterTerm)}
                    </>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {sourceMetaLabel(citation, formatTime)}
                </Typography>
              </Box>
              <ExpandableText text={citation.transcription} highlight={filterTerm} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function GroupedSourcesView({
  citations,
  filterTerm,
  onSelectCitation,
}: {
  citations: Citation[];
  filterTerm: string;
  onSelectCitation: (citation: Citation) => void;
}) {
  const groups = useMemo(() => groupByRecording(citations), [citations]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hoveredCitationIndex = useChatStore((s) => s.hoveredCitationIndex);
  const hoveredFromPanel = useChatStore((s) => s.hoveredFromPanel);
  const setHoveredCitationIndex = useChatStore((s) => s.setHoveredCitationIndex);
  const scrollToCitation = useChatStore((s) => s.scrollToCitation);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hoveredCitationIndex === null || hoveredFromPanel || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-citation-index="${hoveredCitationIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    for (const group of groups) {
      const allIndices = [
        ...group.chapters.map((chapter) => chapter.index),
        ...group.chapters.flatMap((chapter) => chapter.clips.map((clip) => clip.index)),
        ...group.ungroupedClips.map((clip) => clip.index),
      ];

      if (allIndices.includes(hoveredCitationIndex) && collapsed.has(group.theirstoryId)) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(group.theirstoryId);
          return next;
        });
        requestAnimationFrame(() => {
          const expandedEl = containerRef.current?.querySelector(`[data-citation-index="${hoveredCitationIndex}"]`);
          expandedEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        break;
      }
    }
  }, [hoveredCitationIndex, hoveredFromPanel, groups, collapsed]);

  if (citations.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
        No sources match your filter.
      </Typography>
    );
  }

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const highlightSx = (index: number) => ({
    ...(hoveredCitationIndex === index && {
      bgcolor: `${colors.primary.main}14`,
      boxShadow: `inset 3px 0 0 ${colors.primary.main}`,
    }),
  });

  return (
    <Box ref={containerRef}>
      {groups.map((group) => {
        const hasContent = group.chapters.length > 0 || group.ungroupedClips.length > 0;
        if (!hasContent) return null;

        const isCollapsed = collapsed.has(group.theirstoryId);
        const itemCount = group.chapters.length + group.ungroupedClips.length;
        const chronologicalItems: (
          | { kind: 'chapter'; chapter: Citation & { clips: Citation[] } }
          | { kind: 'clip'; clip: Citation }
        )[] = [];

        for (const chapter of group.chapters) chronologicalItems.push({ kind: 'chapter', chapter });
        for (const clip of group.ungroupedClips) chronologicalItems.push({ kind: 'clip', clip });

        chronologicalItems.sort((a, b) => {
          const aTime = a.kind === 'chapter' ? a.chapter.startTime : a.clip.startTime;
          const bTime = b.kind === 'chapter' ? b.chapter.startTime : b.clip.startTime;
          return aTime - bTime;
        });

        return (
          <Box key={group.theirstoryId} sx={{ borderBottom: '2px solid', borderColor: 'divider' }}>
            <Box
              onClick={() => toggleCollapse(group.theirstoryId)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 2,
                py: 1.5,
                bgcolor: colors.grey[50],
                position: 'sticky',
                top: 0,
                zIndex: 2,
                cursor: 'pointer',
                borderBottom: '1px solid',
                borderColor: 'divider',
                '&:hover': { bgcolor: colors.grey[100] },
              }}>
              <ExpandMoreIcon
                sx={{
                  fontSize: 20,
                  transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  flexShrink: 0,
                }}
              />
              <SourceThumbnail source={group} alt={group.interviewTitle} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ lineHeight: 1.3 }}>
                  {highlightSearchText(group.interviewTitle, filterTerm)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {itemCount} source{itemCount !== 1 ? 's' : ''}
                </Typography>
              </Box>
            </Box>

            {!isCollapsed &&
              chronologicalItems.map((entry) => {
                if (entry.kind === 'chapter') {
                  const chapter = entry.chapter;
                  return (
                    <Box key={`ch-${chapter.startTime}`}>
                      <Box
                        data-citation-index={chapter.index}
                        onClick={() => onSelectCitation(chapter)}
                        onMouseEnter={() => setHoveredCitationIndex(chapter.index, true)}
                        onMouseLeave={() => setHoveredCitationIndex(null)}
                        sx={{
                          pl: 2,
                          pr: 2,
                          py: 1.25,
                          cursor: 'pointer',
                          borderLeft: `3px solid ${CHAPTER_COLOR}`,
                          '&:hover': { bgcolor: colors.grey[50] },
                          transition: 'all 0.15s',
                          ...highlightSx(chapter.index),
                        }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <CitationBadge
                            index={chapter.index}
                            isChapter
                            onClick={(e) => {
                              e.stopPropagation();
                              scrollToCitation(chapter.index);
                            }}
                          />
                          <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 0 }}>
                            {highlightSearchText(chapter.sectionTitle, filterTerm)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {sourceMetaLabel(chapter, formatTime)}
                          </Typography>
                        </Box>
                        <ExpandableText text={chapter.transcription} highlight={filterTerm} />
                      </Box>

                      {chapter.clips.map((clip) => (
                        <Box
                          key={`clip-${clip.startTime}-${clip.index}`}
                          data-citation-index={clip.index}
                          onClick={() => onSelectCitation(clip)}
                          onMouseEnter={() => setHoveredCitationIndex(clip.index, true)}
                          onMouseLeave={() => setHoveredCitationIndex(null)}
                          sx={{
                            pl: 4,
                            pr: 2,
                            py: 1,
                            cursor: 'pointer',
                            borderLeft: `3px solid ${CLIP_COLOR}`,
                            ml: 2,
                            '&:hover': { bgcolor: colors.grey[50] },
                            transition: 'all 0.15s',
                            ...highlightSx(clip.index),
                          }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                            <CitationBadge
                              index={clip.index}
                              isChapter={false}
                              onClick={(e) => {
                                e.stopPropagation();
                                scrollToCitation(clip.index);
                              }}
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                              {highlightSearchText(clip.speaker, filterTerm)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                              {sourceMetaLabel(clip, formatTime)}
                            </Typography>
                          </Box>
                          <ExpandableText text={clip.transcription} highlight={filterTerm} />
                        </Box>
                      ))}
                    </Box>
                  );
                }

                const clip = entry.clip;
                return (
                  <Box
                    key={`uclip-${clip.startTime}-${clip.index}`}
                    data-citation-index={clip.index}
                    onClick={() => onSelectCitation(clip)}
                    onMouseEnter={() => setHoveredCitationIndex(clip.index, true)}
                    onMouseLeave={() => setHoveredCitationIndex(null)}
                    sx={{
                      pl: 2,
                      pr: 2,
                      py: 1.25,
                      cursor: 'pointer',
                      borderLeft: `3px solid ${CLIP_COLOR}`,
                      '&:hover': { bgcolor: colors.grey[50] },
                      transition: 'all 0.15s',
                      ...highlightSx(clip.index),
                    }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <CitationBadge
                        index={clip.index}
                        isChapter={false}
                        onClick={(e) => {
                          e.stopPropagation();
                          scrollToCitation(clip.index);
                        }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        {highlightSearchText(clip.speaker, filterTerm)}
                        {clip.sectionTitle && <> &middot; {highlightSearchText(clip.sectionTitle, filterTerm)}</>}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                        {sourceMetaLabel(clip, formatTime)}
                      </Typography>
                    </Box>
                    <ExpandableText text={clip.transcription} highlight={filterTerm} />
                  </Box>
                );
              })}
          </Box>
        );
      })}
    </Box>
  );
}
