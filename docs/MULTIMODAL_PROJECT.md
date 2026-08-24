# The Multimodal Portal

A record of the work that took this portal from a transcript search engine to a system where a
recording, a court exhibit, and a photograph answer the same question from the same query.

This is the end-to-end account: what was built, why the non-obvious calls were made that way, what
was measured, and what is still broken. [docs/MULTIMODAL_SEARCH.md](./MULTIMODAL_SEARCH.md) holds
the retrieval and ingest internals in more depth; this document covers the whole arc and is the
only place the Discover and interface layers are written down.

## The premise

A transcript, a scanned deposition exhibit, and a press photograph are three different kinds of
evidence about the same subject. A researcher does not want three search boxes. They want to ask
about the opioid epidemic and get back the moment a compliance officer was asked about it, the
clinical guideline page that contradicts her, and the photograph of the production line — ranked
against each other, in one list.

That requires one vector space, and one ranking that is honest across modalities. Neither comes
free, and the second is where most of the work went.

## What is actually in the index

| Class | Objects | What one object is |
|---|---|---|
| `Chunks` | 1,430 | A passage of transcript with word-level timings |
| `Exhibits` | 88 | One document page or one image, embedded as page image + OCR text |
| `Testimonies` | 9 | A recording |

The corpus is a curated sample from the UCSF **Opioid Industry Documents Archive** — 9 depositions
and voicemails transcribed by TheirStory, 76 document pages, and 12 images, drawn from 25 distinct
archival sources. Small on purpose: it is large enough that ranking mistakes are visible and small
enough to re-embed in an afternoon.

## Layer 1 — one vector space

`sentence-transformers/LaBSE` (text, 768 dims) was replaced with **`Qwen/Qwen3-VL-Embedding-2B`**
(text + image, 2048 dims). A page is embedded as its rendered image *and* its OCR text together, as
a single multimodal input, which beats either alone for pages whose meaning is split between the
two — a chart with an axis label, a memo with a letterhead.

Because the vector width changed, this was not an env-var flip: the collections had to be recreated
and the corpus re-embedded.

Two things about running it, both of which cost real time to discover:

- The embedding service runs **natively on the host**, not in Docker, because Docker cannot see
  Apple's MPS and a 150 DPI page costs roughly an order of magnitude more than a text chunk
  (~5 s/page vs milliseconds). Put a GPU in the ingest path before running this at archive scale.
- Encoding ran **inline inside an `async def`**, which blocked FastAPI's event loop so hard that
  `/health` hung during ingest. It is wrapped in `run_in_threadpool` now. Batch size is also chosen
  by what is in the batch: images get the small `EMBEDDING_IMAGE_BATCH_SIZE`, text does not, because
  forcing text to a batch of 2 turned passage localisation into a dozen sequential forward passes.

## Layer 2 — ranking across modalities

**A shared vector space does not give you comparable scores.** Querying for the same item measured
0.802 as text against 0.394 as a page image. Merge raw scores and every photograph sinks below every
mediocre transcript match — and it looks like it is working.

Two relative normalisations were tried and both failed, because they depend on the composition of
the candidate pool rather than on quality:

- **Min-max per type** promotes every type's best candidate to 1.0, so a type holding nothing
  relevant still surfaces its top item: an unrelated news report (0.635) tied the correct
  photograph (0.799).
- **Z-score per type** is worse here, because pages from one PDF are highly correlated: a mediocre
  document earned a *higher* z-score (+3.17) than the correct photograph (+2.47).

What shipped is a **fixed per-source-type calibration offset**, measured on the full index across 8
queries: best result per query scored recording 0.795, document 0.764, image 0.738. So only
recordings need correcting, at **0.05**. An earlier probe suggested ~0.20; it had compared a *title
string* against a page image and badly overstated the real case.

Ranking also **caps results per source** (default 3). Transcripts outnumber exhibit pages 16:1, so
"red flag prescriptions" returned 39 recording chunks out of 40 results, the top four from a single
deposition.

There is deliberately **no hybrid mode in the search UI**: equal-weight RRF fusion dropped
cross-lingual recall from 0.875 to **0.000**, because the keyword retriever votes with confidence
when it is out of its depth. Discover uses hybrid with `alpha: 0.55` — vector-dominant — where the
question is always natural language.

## Layer 3 — Discover answers from pages and photographs

Discover was a transcript RAG. It now retrieves across all three types and, critically, **reads the
pages it cites**.

`retrieveSourcesForChat` delegates to `multimodalSearch` (hybrid, alpha 0.55, limit 20,
`maxPerSource: 2`) rather than issuing its own queries, so the chat and the search page cannot drift
apart in what they consider relevant.

The part that makes it genuinely multimodal is `collectPageImages`. A cited page whose OCR text runs
under **120 characters** cannot stand on its own — a photograph has none at all — so up to **3**
such pages per turn are attached to the model as images alongside the text context. Thumbnails are
sent, not full renders: a 44 DPI page is legible to the model, while the full images run to 23 MB
apiece.

The proof that this is real reading and not retrieval theatre: asked about a page carrying **zero**
OCR characters, Discover reported "200 orange and 100 blue stickers per representative" — a fact
that exists only in the pixels.

Supporting work: `ChatImageAttachment` and `supportsImages` on the provider layer, so a
text-only model degrades to text context rather than failing; and document- and image-specific
prompt variants, because "the speaker says" is wrong for a page.

## Layer 4 — showing where the match is

Retrieval scores a whole page, which leaves the researcher scanning a dense two-column scan by eye.
`POST /api/search/passages` re-embeds the page's own passages and scores them against the query with
the same model that retrieved the page, then draws a band over the winner. This is the only thing
that helps when query and page share no vocabulary — "newborns withdrawing from opioids" locates the
"Babies Born Dependent on Opioids" chart with no shared words.

Literal query terms are marked inside that band in semantic mode, and everywhere in keyword mode,
where the terms *are* the answer. Marking every occurrence in semantic mode buried the band under
~30 stray marks on words like "patient" and "with".

**A cited page in Discover now carries the same marks**, with the question as the query — which is
the same relationship a search has to its results.

Three things that had to be right for this to work at all:

- **Columns.** Grouping words by vertical position alone interleaves the two columns of an academic
  page. Lines come from poppler's line index, then cluster into columns by left edge.
- **Blocks are not paragraphs.** Treating poppler `<block>` boundaries as passage boundaries
  collapsed similarity from 0.70 to 0.25.
- **The loop has to advance.** Backing up for passage overlap after a single-line group — which
  happens at every column boundary — advanced the index by nothing, spinning in place until the
  passage cap and leaving the rest of the page unexamined.

Coverage is **52 of 88 pages**. IDL stamps every page with a "Source: <url>" text layer, so a
scanned page reports two positionable words and no content. Those say "no text layer — matched on
the image" rather than pretending.

## Layer 5 — the interface

`/search` ("All Sources") and the Discover sources panel are the two places a reader meets the
corpus, and they now share their presentation deliberately: one palette
(`lib/theme/sourceTypes.ts`), one presenter (`app/discover/Components/recording/sourcePresentation.tsx`). Both had already drifted
once — documents rendered with an audio waveform and a 0:00 timecode in a panel that had been fixed
elsewhere — and a shared presenter is what stops that recurring.

Source type is carried by colour *and* shape, not colour alone: recording blue with a rounded
badge, document amber square, image purple circle. The same three read on result cards, inline
citations, filter chips, and the sources panel.

**Filters select rather than exclude.** They originally started all-on, so clicking "Documents"
hid the documents — the opposite of the instinct. Chips now start unselected, and clicking one
narrows to it.

**Filter counts describe the query, not the filter.** They used to count what was on screen, so
filtering documents out changed "Documents 16" to "Documents 0", which reads as "there are none"
rather than "these are hidden". Only an unfiltered fetch refreshes them.

**One 0–100 match scale.** Keyword showed BM25 running to ~10 while semantic showed a certainty
under 1, so a 6.7 beside a 0.82 said nothing about which was better. Both are percentages now, but
computed differently *because they have to be*: a semantic score is a calibrated certainty already
on 0–1 and converts directly; BM25 is unbounded with no ceiling to divide by, so a keyword hit is
scored against the best hit for that query. Scaling semantic the same relative way was tried first
and measured worse — semantic scores cluster so tightly that a 40-result set spanned only 100% down
to 75%, so the weakest result on the page would still have claimed 75%. Absolute, that set spans
82% to 62%.

**The card leads with the matched text.** The excerpt is what relevance is judged on and it was the
palest, smallest thing on the card, under a bold title that repeats verbatim across every excerpt
from the same deposition. They swapped.

**Sources open in place.** Clicking a recording opens a side drawer at the cited moment with the
full transcript and chapters, rather than a new tab via an interstitial "Open transcript" step.

## What was measured

| | Result |
|---|---|
| Multimodal retrieval eval | **10/10** correct top-1, including photographs with zero OCR retrieved from text descriptions alone (0.799) |
| Calibration, full index | recording 0.795 / document 0.764 / image 0.738 |
| Modality gap, same item | 0.802 as text vs 0.394 as image |
| RRF fusion, cross-lingual | recall 0.875 → 0.000 (why there is no hybrid in the search UI) |
| Semantic search | 126–285 ms |
| Keyword search | 23–172 ms |
| Browse | 276 ms |
| Passage localisation | 1.3 s cold, 12 ms cached (400-entry LRU) |
| Per-page Bates | 18 of 50 read off the page stamp, 32 derived and flagged; spot-checked against pages 1, 3, 11, 15, 17 |
| Thumbnails | 49 MB → 3.3 MB (93% smaller) at 44 DPI |

## Known limitations

- **OCR-noise pages get a confident band.** A page whose text layer is garbage ("keep yaw cud kr Mao
  roes") scored 0.527 and would draw a highlight over gibberish. Margin-from-mean does not separate
  it — the noise page had the *highest* margin (+0.180) against a genuine match's +0.127. Neither an
  absolute threshold nor a "stands out from the page" test works. Not tuned, because three samples
  is not enough to tune on.
- **Keyword's top hit is always 100%.** BM25 has no absolute ceiling, so keyword will read more
  confident than semantic on identical results.
- **Text-layer coverage is 52/88 pages**, so on 36 pages the passage band is unavailable.
- **Passage vectors must be precomputed on a GPU or MPS machine** (`yarn oida:precompute-passages`)
  and shipped with `public/`. Embedding them per request is ~1.3 s on MPS and does not finish
  inside ten minutes on a CPU-only host. Precomputed, it is ~60 ms per page after the query is
  embedded.
- **Recording ingest is manual.** TheirStory has no ingest API: media is downloaded, uploaded by
  hand, transcribed by TheirStory, then pulled back with `yarn theirstory:import-stories`.
- **Archival metadata is exhibit-side only.** The equivalent fields on `Testimonies` were
  deliberately deferred.
- **IIIF manifests** were evaluated and recommended as a data layer, not adopted. Universal Viewer
  was assessed as the wrong shape for a search UI.

## Where things live

| Path | What it is |
|---|---|
| `nlp-processor/embedding_service.py` | Multimodal encoding, device auto-detection, content-aware batching |
| `nlp-processor/main.py` | `/embed-multimodal`, both embed endpoints on a threadpool |
| `lib/weaviate/multimodalSearch.ts` | Calibration, per-source caps, the three retrieval modes, browse |
| `lib/weaviate/chatRetrieval.ts` | `retrieveSourcesForChat` — Discover's hybrid entry point |
| `app/api/discover/route.ts` | RAG turn, `collectPageImages`, per-type prompts |
| `app/api/search/passages/route.ts` | Passage localisation, column detection, LRU cache |
| `lib/ai/chatProvider.ts` | `ChatImageAttachment`, `supportsImages`, message assembly |
| `lib/theme/sourceTypes.ts` | The one palette for source type |
| `app/discover/Components/recording/sourcePresentation.tsx` | The one presenter for a cited source |
| `components/multimodal/` | Search page, result card, exhibit and recording drawers, page highlighting |
| `scripts/oida/` | Eight-script corpus pipeline — fetch, ingest, boxes, thumbnails, metadata, manifests |

## Non-obvious things that bit us

Worth reading before changing this code.

- **There are two `groupByRecording` functions.** `components/floating-chat-drawer/helpers.ts` and
  `app/discover/Components/recording/recordingViewShared.ts`. Patching the wrong one made documents show audio waveforms
  and collapsed every exhibit into a single group.
- **`1fr` is `minmax(auto, 1fr)`**, and an auto minimum will not shrink below the intrinsic width of
  `nowrap` content. A long deposition title pushed the results grid past the viewport.
- **Router search params publish one render after state.** A close handler that reads `open=` from
  the URL sees the stale value and reopens the drawer, so closing took two clicks.
- **`pdftoppm` zero-pads.** It writes `p-03.png` while the coordinate files were named `p-3.words.json`,
  which silently 404'd highlighting on pages 1–9 of every 10+ page document.
- **Exhibits have no `theirstoryId`.** Four components keyed React lists on it, producing duplicate
  empty keys. Groups now carry an explicit `recording:<id>` / `exhibit:<id>` id.
- **Mux cannot type `.m4a`.** Audio playback needs the `.m3u8` HLS URL.

## Verifying it still works

```bash
# Services (see MULTIMODAL_SEARCH.md for the full local setup)
docker compose --profile local up -d weaviate
cd nlp-processor && EMBEDDING_DEVICE=mps CONFIG_PATH=../config.json \
  ./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 7070

# Index counts should be 1430 / 88 / 9
curl -s localhost:8081/v1/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{Aggregate{Chunks{meta{count}}}}"}'

# A photograph with no OCR should still come back for a text description
curl -s -X POST localhost:3000/api/search/multimodal -H 'Content-Type: application/json' \
  -d '{"query":"photograph of a pharmaceutical production line","mode":"semantic","limit":5}'

# All three types should appear for a general query
curl -s -X POST localhost:3000/api/search/multimodal -H 'Content-Type: application/json' \
  -d '{"query":"negative impact of opioids","mode":"semantic","limit":40}'
```
