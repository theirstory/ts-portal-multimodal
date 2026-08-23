import { retrieveSourcesForChat, retrieveAllChapterSynopses } from '@/lib/weaviate/chatRetrieval';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ChatRequest, Citation, ZoteroContextItem } from '@/types/chat';
import { createChatProvider, getChatProviderSettings, type ChatImageAttachment } from '@/lib/ai/chatProvider';
import { getZoteroSession } from '@/lib/zotero/cookies';
import { searchUserLibrary } from '@/lib/zotero/client';
import { isZoteroEnabled } from '@/config/organizationConfig';

function buildSystemPrompt(allCitations: Citation[], responseLanguage: string, zoteroItems?: ZoteroContextItem[]): string {
  const sourcesBlock = allCitations
    .map((c) => {
      if (c.sourceType === 'document' || c.sourceType === 'image') {
        const kind = c.sourceType === 'image' ? 'Image' : 'Document Page';
        const where = c.pageCount && c.pageCount > 1 ? ` | Page ${c.page} of ${c.pageCount}` : '';
        const provenance = [
          c.batesNumber ? `Bates ${c.batesNumber}` : '',
          c.caseNumber ? `Case ${c.caseNumber}` : '',
          c.exhibitNumber ? `Exhibit ${c.exhibitNumber}` : '',
        ]
          .filter(Boolean)
          .join(' | ');

        // Say plainly when a page carries no readable text, so the model treats the attached
        // image as the evidence rather than inventing content to fill the gap.
        const body = c.imageSentToModel
          ? c.transcription
            ? `Page text: "${c.transcription}"\n(The page image is attached to this message.)`
            : '(No readable text on this page. The page image is attached to this message — read it directly.)'
          : c.transcription
            ? `Page text: "${c.transcription}"`
            : '(No readable text on this page, and no image was attached. Do not guess at its contents.)';

        return `[${c.index}] (${kind}) "${c.interviewTitle}"${where}${provenance ? ` | ${provenance}` : ''}\n${body}`;
      }

      if (c.isChapterSynopsis) {
        return `[${c.index}] (Chapter Summary) Interview: "${c.interviewTitle}" | Chapter: "${c.sectionTitle}" | Time: ${formatTime(c.startTime)}–${formatTime(c.endTime)}\nSummary: ${c.transcription}`;
      }
      return `[${c.index}] (Transcript Excerpt) Speaker: ${c.speaker} | Interview: "${c.interviewTitle}" | Section: "${c.sectionTitle}" | Time: ${formatTime(c.startTime)}–${formatTime(c.endTime)}\n"${c.transcription}"`;
    })
    .join('\n\n');

  const zoteroBlock = zoteroItems?.length
    ? `\n\nZOTERO LIBRARY CONTEXT:
The researcher has the following related items in their personal Zotero library. Reference these when relevant to connect the archive sources with their existing research. Cite Zotero items as [Z1], [Z2], etc.
${zoteroItems.map((item, i) => `[Z${i + 1}] "${item.title}" by ${item.creators || 'Unknown'}. ${item.date || 'n.d.'}${item.abstractNote ? `. ${item.abstractNote.slice(0, 200)}` : ''}`).join('\n')}`
    : '';

  return `You are a helpful research assistant for an archive of primary sources. Answer questions based on the sources provided below.

Sources come in several kinds and should be treated differently:
- Transcript excerpts and chapter summaries come from recorded interviews and depositions. Cite what was said, and attribute it to the speaker.
- Document pages come from litigation productions. When one supports a claim, cite its Bates number if given, since that is how the page is cited in a filing.
- Images are photographs, charts, and exhibits. Some carry no text at all; where the page image is attached to this message, describe what you actually see in it rather than inferring from the title. Where no image is attached and there is no text, say the source could not be read rather than guessing.

RULES:
- Use numbered citations like [1], [2] to reference sources.
- Always cite your sources next to the relevant information. Not at the end of the answer, but right after the fact. For example: "The interviewee discusses their childhood in New York [3]."
- Only use bracketed citations for source numbers.
- The only valid citation format is a single number in brackets, like [3].
- Never output ranges like [3-5].
- Never output comma-separated or grouped citations inside one pair of brackets, like [3, 4] or [3, 5-7].
- If you need multiple citations, write them as separate adjacent citations, like [3][4][5].
- Never put timestamps in brackets.
- You MUST cite every source that is relevant to your answer, including chapter summaries.
- Include direct quotes from transcript excerpts when relevant, using quotation marks.
- If the sources don't contain enough information to answer, say so honestly.
- Be concise but thorough. Synthesize information across multiple sources when relevant.
- When multiple speakers discuss the same topic, note the different perspectives.
- For broad questions about themes or patterns, draw on the chapter summaries to cover the full breadth of the collection.
- Write the entire answer in ${responseLanguage}.
- If you include a direct quote from a source, keep the quote in its original language, but keep your explanation in ${responseLanguage}.${zoteroItems?.length ? '\n- When referencing items from the researcher\'s Zotero library, cite them as [Z1], [Z2], etc. and note that these come from their personal library.' : ''}

SOURCES:
${sourcesBlock}${zoteroBlock}`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function getUserFacingDiscoverError(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? 'Sorry, an error occurred while generating the response.');
}

/**
 * Page images are expensive in tokens, so only a few are sent, and only where they earn it.
 *
 * A page whose OCR text already carries its meaning gains nothing from the image — the model
 * can read the text. The pages that need it are the ones text cannot serve: photographs with
 * no words, and scans whose only text layer is an archive stamp. Those are exactly the
 * sources a text-only chat answers badly, usually by paraphrasing the title with unearned
 * confidence.
 *
 * Thumbnails are used rather than the full renders: a 44 DPI page is legible to the model,
 * while the full images run to 23 MB apiece.
 */
const MAX_IMAGES_PER_TURN = 3;
/** Below this, a page's text cannot stand on its own. */
const THIN_TEXT_CHARS = 120;

async function collectPageImages(citations: Citation[]): Promise<ChatImageAttachment[]> {
  const candidates = citations
    .filter((c) => c.sourceType === 'document' || c.sourceType === 'image')
    .filter((c) => (c.transcription ?? '').trim().length < THIN_TEXT_CHARS)
    .filter((c) => Boolean(c.thumbnailUrl))
    .slice(0, MAX_IMAGES_PER_TURN);

  const attachments: ChatImageAttachment[] = [];

  for (const citation of candidates) {
    // Only ever read from the generated thumbnails, never an arbitrary path.
    const url = citation.thumbnailUrl ?? '';
    if (!/^\/oida\/pages\/[A-Za-z0-9_-]+\/p-\d+\.thumb\.jpg$/.test(url)) continue;

    try {
      const bytes = await readFile(path.join(process.cwd(), 'public', url));
      attachments.push({
        index: citation.index,
        base64: bytes.toString('base64'),
        mediaType: 'image/jpeg',
        caption: [citation.interviewTitle, citation.pageCount && citation.pageCount > 1 ? `page ${citation.page}` : '']
          .filter(Boolean)
          .join(', '),
      });
    } catch {
      // A missing thumbnail is not worth failing the turn over; the text still goes.
    }
  }

  return attachments;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const { messages, query, responseLanguage, includeZoteroContext } = body;

    if (!query?.trim()) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Phase 1: Search the archive
          controller.enqueue(encoder.encode(sseEvent({ type: 'status', status: 'Searching the archive...' })));

          const [chunkCitations, synopses] = await Promise.all([
            retrieveSourcesForChat(query, 20),
            retrieveAllChapterSynopses(),
          ]);

          // Phase 1b: Search Zotero library if authenticated
          let zoteroItems: ZoteroContextItem[] = [];
          if (isZoteroEnabled && includeZoteroContext) {
            try {
              const zoteroSession = await getZoteroSession();
              if (zoteroSession) {
                controller.enqueue(encoder.encode(sseEvent({ type: 'status', status: 'Searching your Zotero library...' })));
                const results = await searchUserLibrary(zoteroSession.apiKey, zoteroSession.userID, query, 8);
                zoteroItems = results.map((r) => ({
                  key: r.key,
                  title: r.title,
                  creators: r.creators,
                  date: r.date,
                  itemType: r.itemType,
                  abstractNote: r.abstractNote,
                  url: r.url,
                }));
                if (zoteroItems.length > 0) {
                  controller.enqueue(encoder.encode(sseEvent({ type: 'zotero_context', items: zoteroItems })));
                }
              }
            } catch (zoteroError) {
              console.error('Zotero search in chat failed (non-fatal):', zoteroError);
            }
          }

          // Phase 2: Preparing sources
          controller.enqueue(encoder.encode(sseEvent({ type: 'status', status: 'Gathering sources...' })));

          const synopsisCitations: Citation[] = synopses.map((s) => ({
            index: 0,
            transcription: s.synopsis,
            speaker: '',
            interviewTitle: s.interviewTitle,
            sectionTitle: s.sectionTitle,
            startTime: s.startTime,
            endTime: s.endTime,
            theirstoryId: s.theirstoryId,
            videoUrl: s.videoUrl,
            isAudioFile: s.isAudioFile,
            isChapterSynopsis: true,
          }));

          const allCitations = [...chunkCitations, ...synopsisCitations].map((c, i) => ({
            ...c,
            index: i + 1,
          }));

          const providerSettings = getChatProviderSettings();
          const provider = createChatProvider(providerSettings);

          // Attach page images for sources the model could not otherwise read. Doing this
          // before building the prompt lets the prompt say which images are attached.
          const images = provider.supportsImages ? await collectPageImages(allCitations) : [];
          const attachedIndexes = new Set(images.map((image) => image.index));
          const citations = allCitations.map((c) =>
            attachedIndexes.has(c.index) ? { ...c, imageSentToModel: true } : c,
          );

          if (images.length) {
            controller.enqueue(
              encoder.encode(
                sseEvent({
                  type: 'status',
                  status: `Reading ${images.length} page image${images.length === 1 ? '' : 's'}...`,
                }),
              ),
            );
          }

          const systemPrompt = buildSystemPrompt(citations, responseLanguage?.trim() || 'English', zoteroItems);

          // Send citations to client
          controller.enqueue(encoder.encode(sseEvent({ type: 'citations', citations })));

          // Phase 3: Generating response
          controller.enqueue(encoder.encode(sseEvent({ type: 'status', status: 'Generating response...' })));

          const providerMessages = messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }));

          for await (const text of provider.streamText({
            model: providerSettings.model,
            maxTokens: 2048,
            systemPrompt,
            messages: providerMessages,
            images,
          })) {
            controller.enqueue(encoder.encode(sseEvent({ type: 'text', content: text })));
          }

          controller.enqueue(encoder.encode(sseEvent({ type: 'done' })));
        } catch (err) {
          console.error('Chat provider streaming error:', err);
          controller.enqueue(encoder.encode(sseEvent({ type: 'text', content: getUserFacingDiscoverError(err) })));
          controller.enqueue(encoder.encode(sseEvent({ type: 'done' })));
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json({ error: 'Failed to process chat request' }, { status: 500 });
  }
}
