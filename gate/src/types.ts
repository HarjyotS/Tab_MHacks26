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
}

export interface ClassifyResult {
  intent: Intent;
  confidence: number;
}

export type Classify = (input: ClassifyInput) => Promise<ClassifyResult>;
