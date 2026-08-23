export type ZoteroContextItem = {
  key: string;
  title: string;
  creators: string;
  date: string;
  itemType: string;
  abstractNote: string;
  url: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  zoteroItems?: ZoteroContextItem[];
};

/**
 * What kind of source a citation points at.
 *
 * Discover began as transcript-only, so `Citation` is shaped around a recording and every
 * consumer assumes a player and a timestamp. Rather than break those, the recording fields
 * stay where they are and exhibits fill them with empty values, distinguished by
 * `sourceType` — which is absent on older citations and therefore treated as 'recording'.
 */
export type CitationSourceType = 'recording' | 'document' | 'image';

export type Citation = {
  index: number;
  /** Transcript text for a recording; OCR page text for a document or image. */
  transcription: string;
  speaker: string;
  /** Recording title, or the exhibit's title. */
  interviewTitle: string;
  sectionTitle: string;
  startTime: number;
  endTime: number;
  theirstoryId: string;
  videoUrl: string;
  isAudioFile?: boolean;
  score?: number;
  isChapterSynopsis?: boolean;

  /** Absent on citations created before Discover covered documents and images. */
  sourceType?: CitationSourceType;

  // Exhibit-only. Set when sourceType is 'document' or 'image'.
  /** IDL document id, e.g. ffbd0426. */
  sourceId?: string;
  page?: number;
  pageCount?: number;
  /** Full-size rendered page image, served from public/. */
  imageUrl?: string;
  /** Small render, used for cards and for what is sent to the model. */
  thumbnailUrl?: string;
  /** The record in the Industry Documents Library. */
  sourceUrl?: string;
  /** Bates number for this page: how a filing cites it. */
  batesNumber?: string;
  caseNumber?: string;
  exhibitNumber?: string;
  /**
   * True when the page image was sent to the model rather than only its text — so the UI
   * can say the answer was drawn from looking at the page.
   */
  imageSentToModel?: boolean;
};

export type ChatRequest = {
  messages: { role: 'user' | 'assistant'; content: string }[];
  query: string;
  responseLanguage?: string;
  includeZoteroContext?: boolean;
};

export type ChatStreamChunk =
  | { type: 'status'; status: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'text'; content: string }
  | { type: 'zotero_context'; items: ZoteroContextItem[] }
  | { type: 'done' };
