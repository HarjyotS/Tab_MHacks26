// The parts of SPEC.md section 5 that the client reads or writes.

export type Reaction = "like" | "love" | "dislike" | "laugh" | "emphasize" | "question";

/** Arguments to the `ingest_message` reducer. */
export interface InboundMessage {
  message_id: string;
  group_id?: string;
  sender_phone: string;
  is_dm: boolean;
  kind: "text" | "image" | "reaction" | "system";
  text?: string;
  image_url?: string;
  reply_to_id?: string;
  reaction?: Reaction;
  received_at: Date;
}

export type OutboxKind = "group_message" | "dm" | "reaction" | "contact_card";
export type OutboxStatus = "queued" | "sending" | "sent" | "cancelled" | "failed";

export interface OutboxRow {
  action_id: string;
  kind: OutboxKind;
  group_id?: string;
  to_phone?: string;
  target_message_id?: string;
  text?: string;
  reaction?: Reaction;
  expense_id?: string;
  purpose: string;
  send_after: Date;
  status: OutboxStatus;
}

/** Arguments to the `mark_outbox` reducer. */
export interface OutboxUpdate {
  status: OutboxStatus;
  sent_photon_id?: string;
  sent_at?: Date;
  error?: string;
}
