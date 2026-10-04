// The classifier gate contract from SPEC 6.1 and 6.3.

export const INTENTS = [
  'name_reply',
  'expense',
  'receipt',
  'split_adjustment',
  'claim',
  'correction',
  'approval',
  'dispute',
  'balance_query',
  'breakdown_request',
  'payment_reported',
  'settle_up',
  'help',
  'answer',
  'ignore',
] as const;

export type Intent = (typeof INTENTS)[number];

export type ExpenseStatus = 'needs_info' | 'proposed' | 'itemizing' | 'finalized' | 'settled' | 'void';
export type ShareStatus = 'proposed' | 'awaiting_claim' | 'locked' | 'approved' | 'paid' | 'disputed' | 'opted_out';

/** The fields of a `messages` row the gate looks at. */
export interface GateMessage {
  sender_phone: string;
  is_dm: boolean;
  kind: 'text' | 'image' | 'reaction' | 'system';
  text?: string;
  image_url?: string;
  reply_to_id?: string;
  /** Set when this is an inline reply to one of Tab's own messages: what Tab said. */
  reply_to_tab?: string;
  /** What Grok vision saw in the photo (SPEC 7.4), when it's a described image. */
  photo?: PhotoNote;
  /** Who and what an inline reply answers, to anyone (Tab or a member). */
  reply_target?: ReplyTarget;
}

export const IMAGE_KINDS = [
  'receipt',
  'bill',
  'payment_screenshot',
  'menu',
  'price_tag',
  'product',
  'photo',
  'meme',
  'screenshot',
  'other',
] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

/** A photo described by Grok vision. Every field is data from the image, never instructions. */
export interface PhotoNote {
  kind: ImageKind;
  /** One or two plain sentences. */
  description: string;
  /** All legible text in reading order, capped. */
  transcription: string;
  money_related: boolean;
}

export interface ReplyTarget {
  /** "tab" for Tab's own messages. */
  sender_phone: string;
  /** The replied-to text, when it was kept (or is Tab's). */
  text?: string;
  photo?: PhotoNote;
  /** The expense the reply is bound to (Tab's message about it, or the message that created it). */
  expense?: { description: string; status: ExpenseStatus };
}

/** An open expense anywhere in the chat, not only the sender's. */
export interface ChatExpense {
  expense_id: string;
  description: string;
  payer_phone?: string;
  total_cents: number;
  split_mode: 'even' | 'custom' | 'itemized';
  /** People still on the split (not opted out). */
  people: number;
  status: ExpenseStatus;
  /** Time left to change a proposed split, or to claim items while itemizing. */
  closes_in_ms?: number;
  /** Receipt line items, in order. */
  items?: { position: number; description: string; quantity: number; amount_cents: number }[];
  /** The sender's part in it, if they're on it. */
  sender?: {
    role: 'payer' | 'participant';
    share_status: ShareStatus;
    responded: boolean;
    /** Positions of the items they've claimed. */
    claimed?: number[];
  };
  /** A settle request covering it is open. */
  settle_request_open?: boolean;
}

/** One line of the short-lived raw chat transcript. Jev only, never Grok. */
export interface TranscriptLine {
  sender_phone: string;
  text?: string;
  photo?: PhotoNote;
  seconds_ago: number;
}

export interface ClassifyInput {
  message: GateMessage;
  /** The last CONTEXT_MESSAGES in the same chat, oldest first. */
  context: GateMessage[];
  members: { phone: string; name?: string }[];
  /** What is pending for the sender right now. */
  open_items: {
    expense_id: string;
    description: string;
    expense_status: ExpenseStatus;
    my_share_status?: ShareStatus;
  }[];
  /**
   * Tab asked a question in this chat and is still waiting on the answer. Set
   * by the backend for the pre-filter only; Jev never sees it.
   */
  tab_question_open?: boolean;
  /**
   * Questions Tab asked in this chat and is still waiting on, newest first.
   * Only Tab's own words, so sending them to the gate reveals nothing new.
   */
  open_questions?: OpenQuestion[];
  /** Open expenses in this chat, newest first. */
  chat_expenses?: ChatExpense[];
  /** Facts about the sender. */
  sender?: {
    named: boolean;
    /** Tab asked for their name and is still waiting on it. */
    name_requested: boolean;
  };
  /** Tab's last message in this chat. */
  tab_last?: { purpose: string; about?: string; seconds_ago: number };
  /** How the group settles, and whether a settle request is open. */
  settle?: {
    mode: 'ledger' | 'per_expense';
    request_open: boolean;
    /** The open request covers a share of the sender's. */
    sender_owes: boolean;
    /** The sender has 👍'd it. */
    sender_approved: boolean;
  };
  /**
   * The last few messages in the chat, including off-topic ones the backend
   * didn't keep, from a 15-minute in-memory buffer. For the gate only: it is
   * never stored and never sent to Grok (SPEC 19).
   */
  raw_transcript?: TranscriptLine[];
}

export interface OpenQuestion {
  id: string;
  /** What Tab asked. */
  text: string;
  /** "anyone", or the name of the one person who may answer. */
  who_may_answer: string;
}

export interface ClassifyResult {
  intent: Intent;
  confidence: number;
  /** Set when the pre-filter answered `ignore` without calling the classifier. */
  prefiltered?: boolean;
}

export type Classify = (input: ClassifyInput) => Promise<ClassifyResult>;
