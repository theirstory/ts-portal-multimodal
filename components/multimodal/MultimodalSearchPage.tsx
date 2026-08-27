'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { colors } from '@/lib/theme';
import useLayoutState from '@/app/stores/useLayout';
import { ALL_SOURCE_TYPES, useMultimodalSearchStore } from '@/app/stores/useMultimodalSearchStore';
import type { SearchMode, SourceType } from '@/lib/weaviate/multimodalSearch';
import { MultimodalResultCard } from './MultimodalResultCard';
import { ExhibitDetailDrawer } from './ExhibitDetailDrawer';
import { RecordingDetailDrawer } from './RecordingDetailDrawer';

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  recording: 'Recordings',
  document: 'Documents',
  image: 'Images',
};

const EXAMPLE_QUERIES = [
  'a photograph of a pharmaceutical production line',
  'red flag prescriptions dispensed by pharmacies',
  'babies born dependent on opioids',
  'sales representatives discussing prescriber targets',
];

export function MultimodalSearchPage() {
  const {
    query,
    results,
    typeCounts,
    activeSourceTypes,
    loading,
    hasSearched,
    browsing,
    error,
    selectedResult,
    showScores,
    mode,
    setQuery,
    setMode,
    toggleSourceType,
    setSelectedResult,
    toggleShowScores,
    search,
    browse,
    clear,
  } = useMultimodalSearchStore();

  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const urlOpen = searchParams.get('open') ?? '';
  const urlMode = searchParams.get('mode') === 'keyword' ? 'keyword' : 'semantic';

  const { setTopBarCollapsedAuto } = useLayoutState();
  const [submittedQuery, setSubmittedQuery] = React.useState('');

  // A shared link should reproduce the same result set, which means carrying the retrieval
  // mode as well as the query — the two produce very different answers.
  const buildUrl = React.useCallback((term: string, nextMode: SearchMode, openUuid?: string) => {
    const params = new URLSearchParams({ q: term });
    if (nextMode !== 'semantic') params.set('mode', nextMode);
    if (openUuid) params.set('open', openUuid);
    return `/search?${params.toString()}`;
  }, []);

  const runSearch = React.useCallback(
    (term?: string, nextMode?: SearchMode) => {
      const next = (term ?? query).trim();
      if (!next) return;

      setSubmittedQuery(next);
      // Reclaim the hero for results: on a search the answer is the point, not the banner.
      setTopBarCollapsedAuto(true);
      router.replace(buildUrl(next, nextMode ?? mode), { scroll: false });
      void search();
    },
    [buildUrl, mode, query, router, search, setTopBarCollapsedAuto],
  );

  // Open on the collection rather than an empty box, and run whatever a shared link asks for.
  const hydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    if (!urlQuery) {
      void browse();
      return;
    }

    setQuery(urlQuery);
    setSubmittedQuery(urlQuery);
    setTopBarCollapsedAuto(true);
    if (urlMode !== 'semantic') setMode(urlMode);
    void search();
  }, [urlQuery, urlMode, setQuery, setMode, search, browse, setTopBarCollapsedAuto]);

  /**
   * Which `open=` value has already been acted on.
   *
   * Closing the drawer clears the state and the URL together, but the router publishes the
   * new search params a render later — so this effect could still see the old uuid, find it
   * in the results, and immediately re-open what the reader had just dismissed. It looked
   * like the backdrop needed two clicks. Remembering what has been handled means a stale
   * parameter cannot resurrect a closed drawer, while a genuinely different uuid still opens.
   */
  const handledOpenRef = React.useRef('');

  React.useEffect(() => {
    if (!urlOpen) {
      handledOpenRef.current = '';
      return;
    }
    if (handledOpenRef.current === urlOpen) return;

    if (selectedResult?.uuid === urlOpen) {
      handledOpenRef.current = urlOpen;
      return;
    }

    const match = results.find((result) => result.uuid === urlOpen);
    if (match) {
      handledOpenRef.current = urlOpen;
      setSelectedResult(match);
    }
  }, [urlOpen, results, selectedResult, setSelectedResult]);

  // Both drawers close the same way; keeping it in one place also keeps the two in step.
  const closeDetail = React.useCallback(() => {
    setSelectedResult(null);
    if (submittedQuery || query) {
      router.replace(buildUrl(submittedQuery || query, mode), { scroll: false });
    }
  }, [buildUrl, mode, query, router, setSelectedResult, submittedQuery]);

  // Relevance bars are scaled against the best hit in the set, so they mean "how close to
  // the top result" rather than exposing an absolute cosine no reader can calibrate.
  const topScore = React.useMemo(() => results.reduce((max, result) => Math.max(max, result.score), 0), [results]);

  const showingResults = !loading && !error && results.length > 0;

  return (
    // Two height regimes. From md up this column is exactly the window and the result list
    // scrolls inside it, under controls that stay put. On a phone it grows with its content
    // and the page itself scrolls, so there is one scroller instead of two.
    <Box sx={{ flex: { xs: 'none', md: 1 }, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          maxWidth: '1600px',
          width: '100%',
          mx: 'auto',
          px: { xs: 1.75, sm: 3, md: 4 },
          py: { xs: 1.5, md: 2 },
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          flex: { xs: 'none', md: 1 },
        }}>
        {/*
          Controls in one compact row, so results start as high up the page as possible. On a
          phone there is no such row: the field takes a line and the mode toggle takes the
          next, which is why the field asks for the full width rather than a 320px minimum it
          cannot honour at 375px.
        */}
        <Box
          sx={{
            display: 'flex',
            gap: { xs: 1, sm: 1.5 },
            alignItems: 'center',
            flexWrap: 'wrap',
            flexShrink: 0,
            mb: 1.5,
          }}>
          <TextField
            size="small"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
            placeholder="Search recordings, documents, and images by meaning or by exact words…"
            sx={{ flex: 1, width: { xs: '100%', sm: 'auto' }, minWidth: { xs: 0, sm: 320 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: query ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label="Clear search"
                    onClick={() => {
                      clear();
                      setSubmittedQuery('');
                      router.replace('/search', { scroll: false });
                    }}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 1, sm: 1.5 },
              width: { xs: '100%', sm: 'auto' },
            }}>
            <Tooltip
              title={
                mode === 'semantic'
                  ? 'Semantic: finds material that means the same thing in different words, including photographs with no text at all.'
                  : 'Keyword: finds these exact terms and nothing else. Better for a name, a drug, or an acronym like DEA.'
              }>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={mode}
                onChange={(_event, next: SearchMode | null) => {
                  if (!next) return;
                  setMode(next);
                  if (submittedQuery) router.replace(buildUrl(submittedQuery, next), { scroll: false });
                }}
                // Two halves of the width on a phone: this is the page's main switch, and a
                // 32px-tall pair of buttons is an awkward thing to hit with a thumb.
                sx={{ flex: { xs: 1, sm: 'none' }, '& .MuiToggleButton-root': { flex: { xs: 1, sm: 'none' } } }}>
                <ToggleButton value="semantic" sx={{ textTransform: 'none', px: 1.5, minHeight: { xs: 40, sm: 0 } }}>
                  Semantic
                </ToggleButton>
                <ToggleButton value="keyword" sx={{ textTransform: 'none', px: 1.5, minHeight: { xs: 40, sm: 0 } }}>
                  Keyword
                </ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>

            <FormControlLabel
              sx={{ mr: 0, ml: 0, flexShrink: 0 }}
              control={<Switch size="small" checked={showScores} onChange={toggleShowScores} />}
              label={<Typography variant="caption">Scores</Typography>}
            />
          </Box>
        </Box>

        {/*
          Type filters, with live counts. The row wraps rather than scrolls: three chips and
          the result count are 16px too wide for a 375px screen, and a count half out of
          view reads as a rendering fault, where a second line just reads as a second line.
        */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            // This is a control strip: it keeps its height and the results give up the space.
            flexShrink: 0,
            mb: 1.5,
          }}>
          {ALL_SOURCE_TYPES.map((sourceType) => {
            const active = activeSourceTypes.includes(sourceType);
            // What exists for this query, not what survived the filter — a hidden type still
            // says how much it is hiding.
            const count = typeCounts[sourceType] || undefined;
            return (
              <Chip
                key={sourceType}
                size="small"
                label={
                  count === undefined ? SOURCE_TYPE_LABELS[sourceType] : `${SOURCE_TYPE_LABELS[sourceType]} ${count}`
                }
                onClick={() => toggleSourceType(sourceType)}
                variant={active ? 'filled' : 'outlined'}
                color={active ? 'primary' : 'default'}
                sx={{ flexShrink: 0, height: { xs: 34, sm: 24 }, px: { xs: 0.5, sm: 0 } }}
              />
            );
          })}

          {showingResults && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ ml: 'auto', flexShrink: 0, whiteSpace: 'nowrap' }}>
              {browsing ? `Browsing ${results.length} items` : `${results.length} results`}
            </Typography>
          )}
        </Box>

        {!hasSearched && !browsing && !loading && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
              Try one of these
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {EXAMPLE_QUERIES.map((example) => (
                <Chip
                  key={example}
                  size="small"
                  label={example}
                  variant="outlined"
                  onClick={() => {
                    setQuery(example);
                    runSearch(example);
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={36} />
          </Box>
        )}

        {showingResults && (
          <Box
            sx={{
              // On a phone the results are the page, so the page scrolls them: a scroll box
              // inside a 100dvh column means two nested scrollers, momentum that stops at a
              // boundary the reader cannot see, and no address bar collapse to win back
              // height. From md up the box scrolls under fixed controls, which is what a
              // pointer and a tall window want.
              flex: { xs: 'none', md: 1 },
              minHeight: 0,
              overflow: { xs: 'visible', md: 'auto' },
              pr: { xs: 0, md: 1 },
              // Room under the last card for the floating Ask AI button, which otherwise
              // sits on top of it.
              pb: { xs: 11, md: 2 },
              // Two columns on a wide screen: these cards are short, and one narrow column
              // left most of the page empty.
              display: 'grid',
              // min-content, not the default auto. WebKit sizes an auto row from a grid
              // item's specified min-height rather than from its content, so any stray
              // min-height on a card collapsed the whole list into overlapping rows on iOS.
              // min-content asks for the height the card actually needs.
              gridAutoRows: 'min-content',
              // minmax(0, 1fr), not 1fr: a bare 1fr is minmax(auto, 1fr), and an auto minimum
              // refuses to shrink below the intrinsic width of its content. The card's title
              // and detail lines are nowrap, so their intrinsic width is the whole
              // untruncated string — which pushed both columns past the viewport and put a
              // horizontal scrollbar under the results instead of ellipsising.
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
              gap: 1,
              alignContent: 'start',
              '&::-webkit-scrollbar': { width: '8px' },
              '&::-webkit-scrollbar-track': { backgroundColor: colors.grey[100], borderRadius: '4px' },
              '&::-webkit-scrollbar-thumb': { backgroundColor: colors.grey[400], borderRadius: '4px' },
            }}>
            {results.map((result) => (
              <MultimodalResultCard
                key={result.uuid}
                result={result}
                showScores={showScores}
                topScore={topScore}
                onSelect={(selected) => {
                  // Everything opens in place. Sending recordings to a new tab lost the
                  // result list, which is exactly what a reader is working from when
                  // comparing several hits.
                  setSelectedResult(selected);
                  if (submittedQuery || query) {
                    router.replace(buildUrl(submittedQuery || query, mode, selected.uuid), { scroll: false });
                  }
                }}
              />
            ))}
          </Box>
        )}

        {!loading && !error && results.length === 0 && (hasSearched || browsing) && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {mode === 'keyword'
              ? 'No text contains these exact terms. Switch to Semantic to search by meaning, which also reaches photographs.'
              : 'Nothing matched. Try describing the material differently, or re-enable a source type.'}
          </Typography>
        )}
      </Box>

      <RecordingDetailDrawer
        result={selectedResult?.sourceType === 'recording' ? selectedResult : null}
        onClose={closeDetail}
      />

      <ExhibitDetailDrawer
        result={selectedResult?.sourceType === 'recording' ? null : selectedResult}
        query={submittedQuery}
        onClose={closeDetail}
      />
    </Box>
  );
}
