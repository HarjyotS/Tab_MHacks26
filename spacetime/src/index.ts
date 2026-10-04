import { ScheduleAt } from 'spacetimedb';
import { schema, table, t } from 'spacetimedb/server';
import { computeSplit } from './split-math';

const groups = table(
  {},
  {
    group_id: t.string().primaryKey(),
    ledger_id: t.string().unique(),
    display_name: t.option(t.string()),
    timezone: t.string(),
    onboarding_status: t.string(),
    created_at: t.timestamp(),
  }
);

const members = table(
  {
    indexes: [
      { accessor: 'by_group', algorithm: 'btree', columns: ['group_id'] as const },
      { accessor: 'by_group_phone', algorithm: 'btree', columns: ['group_id', 'phone'] as const },
    ],
  },
  {
    member_id: t.string().primaryKey(),
    ledger_member_id: t.string().unique(),
    group_id: t.string(),
    phone: t.string(),
    name: t.option(t.string()),
    nessie_customer_id: t.option(t.string()),
    nessie_account_id: t.option(t.string()),
    joined_at: t.timestamp(),
    left_at: t.option(t.timestamp()),
  }
);

const messages = table(
  { indexes: [{ accessor: 'by_status', algorithm: 'btree', columns: ['status'] as const }] },
  {
    message_id: t.string().primaryKey(),
    group_id: t.option(t.string()),
    sender_phone: t.string(),
    is_dm: t.bool(),
    kind: t.string(),
    text: t.option(t.string()),
    image_url: t.option(t.string()),
    reply_to_id: t.option(t.string()),
    reaction: t.option(t.string()),
    received_at: t.timestamp(),
    intent: t.option(t.string()),
    confidence: t.option(t.f64()),
    status: t.string(),
    error: t.option(t.string()),
  }
);

const outbox = table(
  {
    indexes: [
      { accessor: 'by_status_send_after', algorithm: 'btree', columns: ['status', 'send_after_micros'] as const },
      { accessor: 'by_expense', algorithm: 'btree', columns: ['expense_key'] as const },
    ],
  },
  {
    action_id: t.string().primaryKey(),
    kind: t.string(),
    group_id: t.option(t.string()),
    to_phone: t.option(t.string()),
    target_message_id: t.option(t.string()),
    text: t.option(t.string()),
    reaction: t.option(t.string()),
    expense_id: t.option(t.string()),
    expense_key: t.string(),
    purpose: t.string(),
    send_after: t.timestamp(),
    send_after_micros: t.i64(),
    status: t.string(),
    sent_photon_id: t.option(t.string()),
    created_at: t.timestamp(),
    sent_at: t.option(t.timestamp()),
    error: t.option(t.string()),
  }
);

const expenses = table(
  {
    indexes: [
      { accessor: 'by_group', algorithm: 'btree', columns: ['group_id'] as const },
    ],
  },
  {
    expense_id: t.string().primaryKey(),
    group_id: t.string(),
    payer_phone: t.option(t.string()),
    description: t.string(),
    source_message_id: t.string().unique(),
    split_mode: t.string(),
    status: t.string(),
    subtotal_cents: t.option(t.i64()),
    tax_cents: t.i64(),
    tip_cents: t.i64(),
    fees_cents: t.i64(),
    discount_cents: t.i64(),
    total_cents: t.i64(),
    objection_deadline: t.option(t.timestamp()),
    claim_deadline: t.option(t.timestamp()),
    proposal_message_id: t.option(t.string()),
    settle_message_id: t.option(t.string()),
    created_at: t.timestamp(),
    finalized_at: t.option(t.timestamp()),
  }
);

const line_items = table(
  { indexes: [{ accessor: 'by_expense', algorithm: 'btree', columns: ['expense_id'] as const }] },
  {
    item_id: t.string().primaryKey(),
    expense_id: t.string(),
    position: t.u32(),
    description: t.string(),
    quantity: t.u32(),
    amount_cents: t.i64(),
  }
);

const claims = table(
  {
    indexes: [
      { accessor: 'by_item', algorithm: 'btree', columns: ['item_id'] as const },
      { accessor: 'by_expense', algorithm: 'btree', columns: ['expense_id'] as const },
    ],
  },
  {
    claim_id: t.string().primaryKey(),
    item_id: t.string(),
    expense_id: t.string(),
    phone: t.string(),
    source_message_id: t.string(),
    created_at: t.timestamp(),
  }
);

const shares = table(
  {
    indexes: [
      { accessor: 'by_expense', algorithm: 'btree', columns: ['expense_id'] as const },
      { accessor: 'by_phone', algorithm: 'btree', columns: ['phone'] as const },
      { accessor: 'by_expense_phone', algorithm: 'btree', columns: ['expense_id', 'phone'] as const },
    ],
  },
  {
    share_id: t.string().primaryKey(),
    expense_id: t.string(),
    phone: t.string(),
    role: t.string(),
    status: t.string(),
    fixed_cents: t.option(t.i64()),
    amount_cents: t.i64(),
    responded: t.bool(),
    followup_count: t.u32(),
    last_followup_at: t.option(t.timestamp()),
    updated_at: t.timestamp(),
  }
);

const transfers = table(
  {
    indexes: [
      { accessor: 'by_group', algorithm: 'btree', columns: ['group_id'] as const },
      { accessor: 'by_expense', algorithm: 'btree', columns: ['expense_id'] as const },
      { accessor: 'by_status', algorithm: 'btree', columns: ['status'] as const },
      { accessor: 'by_approval_expense', algorithm: 'btree', columns: ['approved_by_message_id', 'expense_id'] as const },
    ],
  },
  {
    transfer_id: t.string().primaryKey(),
    group_id: t.string(),
    expense_id: t.string(),
    from_phone: t.string(),
    to_phone: t.string(),
    amount_cents: t.i64(),
    provider: t.string(),
    status: t.string(),
    // One approval (a 👍 on a combined settle request) can pay several shares, so
    // this is not unique: create_transfer dedupes on (approval, expense) instead.
    approved_by_message_id: t.string(),
    created_at: t.timestamp(),
    completed_at: t.option(t.timestamp()),
    error: t.option(t.string()),
  }
);

const transfer_completion_schedule = table(
  {},
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
    transfer_id: t.string(),
  }
);

// One row per group that has chosen a settle mode (SPEC 7.6). No row means "ledger".
const group_settings = table(
  {},
  { group_id: t.string().primaryKey(), settle_mode: t.string(), updated_at: t.timestamp() }
);

const service_roles = table(
  {},
  { identity: t.identity().primaryKey(), role: t.string(), created_at: t.timestamp() }
);

const module_config = table(
  {},
  {
    config_key: t.string().primaryKey(),
    owner_identity: t.option(t.identity()),
    demo_mode: t.bool(),
  }
);

const ledger_secrets = table(
  {},
  { secret: t.string().primaryKey(), group_id: t.string().unique(), created_at: t.timestamp() }
);

const ledger_grants = table(
  {
    indexes: [
      { accessor: 'by_identity', algorithm: 'btree', columns: ['identity'] as const },
      { accessor: 'by_group', algorithm: 'btree', columns: ['group_id'] as const },
    ],
  },
  {
    grant_id: t.string().primaryKey(),
    identity: t.identity(),
    group_id: t.string(),
    created_at: t.timestamp(),
  }
);

const nessie_seed_progress = table(
  { indexes: [{ accessor: 'by_group', algorithm: 'btree', columns: ['group_id'] as const }] },
  {
    member_id: t.string().primaryKey(),
    group_id: t.string(),
    customer_id: t.option(t.string()),
    account_id: t.option(t.string()),
    deposit_created: t.bool(),
    seeded_balance_cents: t.i64(),
    updated_at: t.timestamp(),
  }
);

/**
 * What the Nessie mirror recorded for each settlement (SPEC 12.2). Nessie keeps
 * whole dollars only, so the dollars recorded per leg are kept here: the mirror
 * carries the remainder per account, and its running total never drifts more
 * than 50 cents from SpacetimeDB. Seeder role writes; nothing depends on it.
 */
const nessie_mirror_progress = table(
  {},
  {
    transfer_id: t.string().primaryKey(),
    status: t.string(), // recorded | failed
    from_account_id: t.string(),
    to_account_id: t.string(),
    amount_cents: t.i64(),
    withdrawn_dollars: t.i64(),
    deposited_dollars: t.i64(),
    withdrawal_id: t.option(t.string()),
    deposit_id: t.option(t.string()),
    attempts: t.u32(),
    error: t.option(t.string()),
    updated_at: t.timestamp(),
  }
);

/**
 * Each member's balance as Nessie's records show it: the account's opening
 * balance plus completed deposits minus completed withdrawals. Nessie's sandbox
 * never updates an account's own balance field, so the mirror computes this
 * from Nessie and stores it here for the ledger.
 */
const nessie_balances = table(
  { indexes: [{ accessor: 'by_group', algorithm: 'btree', columns: ['group_id'] as const }] },
  {
    member_id: t.string().primaryKey(),
    group_id: t.string(),
    balance_cents: t.i64(),
    synced_at: t.timestamp(),
  }
);

const spacetime = schema({
  groups,
  members,
  messages,
  outbox,
  expenses,
  line_items,
  claims,
  shares,
  transfers,
  transfer_completion_schedule,
  group_settings,
  service_roles,
  module_config,
  ledger_secrets,
  ledger_grants,
  nessie_seed_progress,
  nessie_mirror_progress,
  nessie_balances,
});

export default spacetime;

export const init = spacetime.init(ctx => {
  ctx.db.module_config.insert({
    config_key: 'main',
    owner_identity: undefined,
    demo_mode: false,
  });
});

function isOwner(ctx: any): boolean {
  return ctx.db.module_config.config_key.find('main')?.owner_identity?.isEqual(ctx.sender) ?? false;
}

function requireRole(ctx: any, ...roles: string[]): void {
  if (isOwner(ctx)) return;
  const row = ctx.db.service_roles.identity.find(ctx.sender);
  if (!row || !roles.includes(row.role)) throw new Error(`Requires service role: ${roles.join(' or ')}`);
}

function requireValue(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}: ${value}`);
}

export const grant_service_role = spacetime.reducer(
  { identity: t.identity(), role: t.string() },
  (ctx, { identity, role }) => {
    if (!isOwner(ctx)) throw new Error('Only the module owner can grant service roles');
    requireValue(role, ['client', 'backend', 'seeder'], 'service role');
    const existing = ctx.db.service_roles.identity.find(identity);
    const next = { identity, role, created_at: existing?.created_at ?? ctx.timestamp };
    if (existing) ctx.db.service_roles.identity.update(next);
    else ctx.db.service_roles.insert(next);
  }
);

export const claim_module_owner = spacetime.reducer(ctx => {
  const config = ctx.db.module_config.config_key.find('main');
  if (!config) throw new Error('Module configuration is missing');
  if (config.owner_identity && !config.owner_identity.isEqual(ctx.sender)) {
    throw new Error('Module owner has already been claimed');
  }
  ctx.db.module_config.config_key.update({ ...config, owner_identity: ctx.sender });
});

export const set_demo_mode = spacetime.reducer({ enabled: t.bool() }, (ctx, { enabled }) => {
  if (!isOwner(ctx)) throw new Error('Only the module owner can change demo mode');
  const config = ctx.db.module_config.config_key.find('main');
  if (!config) throw new Error('Module configuration is missing');
  ctx.db.module_config.config_key.update({ ...config, demo_mode: enabled });
});

export const ingest_message = spacetime.reducer(
  {
    message_id: t.string(), group_id: t.option(t.string()), group_ledger_id: t.option(t.string()),
    group_display_name: t.option(t.string()), group_timezone: t.string(), sender_phone: t.string(),
    sender_ledger_member_id: t.option(t.string()), is_dm: t.bool(), kind: t.string(),
    text: t.option(t.string()), image_url: t.option(t.string()), reply_to_id: t.option(t.string()),
    reaction: t.option(t.string()), received_at: t.timestamp(),
  },
  (ctx, input) => {
    requireRole(ctx, 'client', 'seeder');
    requireValue(input.kind, ['text', 'image', 'reaction', 'system'], 'message kind');
    const existing = ctx.db.messages.message_id.find(input.message_id);
    const row = {
      message_id: input.message_id, group_id: input.group_id, sender_phone: input.sender_phone,
      is_dm: input.is_dm, kind: input.kind, text: input.text, image_url: input.image_url,
      reply_to_id: input.reply_to_id, reaction: input.reaction, received_at: input.received_at,
      intent: existing?.intent, confidence: existing?.confidence, status: existing?.status ?? 'new',
      error: existing?.error,
    };
    if (existing) ctx.db.messages.message_id.update(row);
    else ctx.db.messages.insert(row);

    if (input.group_id) {
      let group = ctx.db.groups.group_id.find(input.group_id);
      if (!group) {
        if (!input.group_ledger_id) throw new Error('A new group requires group_ledger_id');
        group = ctx.db.groups.insert({
          group_id: input.group_id, ledger_id: input.group_ledger_id,
          display_name: input.group_display_name, timezone: input.group_timezone,
          onboarding_status: 'pending', created_at: ctx.timestamp,
        });
      }
      const memberId = `${input.group_id}:${input.sender_phone}`;
      if (!ctx.db.members.member_id.find(memberId)) {
        if (!input.sender_ledger_member_id) throw new Error('A new member requires sender_ledger_member_id');
        ctx.db.members.insert({
          member_id: memberId, ledger_member_id: input.sender_ledger_member_id,
          group_id: input.group_id, phone: input.sender_phone, name: undefined,
          nessie_customer_id: undefined, nessie_account_id: undefined,
          joined_at: ctx.timestamp, left_at: undefined,
        });
      }
    }
  }
);

export const mark_outbox = spacetime.reducer(
  { action_id: t.string(), status: t.string(), sent_photon_id: t.option(t.string()), error: t.option(t.string()) },
  (ctx, { action_id, status, sent_photon_id, error }) => {
    requireRole(ctx, 'client');
    requireValue(status, ['queued', 'sending', 'sent', 'cancelled', 'failed'], 'outbox status');
    const row = ctx.db.outbox.action_id.find(action_id);
    if (!row) throw new Error('Unknown outbox action');
    ctx.db.outbox.action_id.update({
      ...row, status, sent_photon_id, error, sent_at: status === 'sent' ? ctx.timestamp : row.sent_at,
    });
  }
);

export const set_message_result = spacetime.reducer(
  { message_id: t.string(), intent: t.option(t.string()), confidence: t.option(t.f64()), status: t.string(), error: t.option(t.string()) },
  (ctx, input) => {
    requireRole(ctx, 'backend');
    requireValue(input.status, ['new', 'processing', 'done', 'error'], 'message status');
    const row = ctx.db.messages.message_id.find(input.message_id);
    if (!row) throw new Error('Unknown message');
    ctx.db.messages.message_id.update({
      ...row,
      ...input,
      // Ignored chat content is not needed after classification. Keep the row for
      // idempotency and audit state, but discard its user-authored text.
      text: input.intent === 'ignore' ? undefined : row.text,
    });
  }
);

export const set_member_name = spacetime.reducer(
  { member_id: t.string(), name: t.string() },
  (ctx, { member_id, name }) => {
    requireRole(ctx, 'backend', 'seeder');
    const row = ctx.db.members.member_id.find(member_id);
    if (!row) throw new Error('Unknown member');
    ctx.db.members.member_id.update({ ...row, name: name.trim() });
  }
);

export const set_group_status = spacetime.reducer(
  { group_id: t.string(), status: t.string() },
  (ctx, { group_id, status }) => {
    requireRole(ctx, 'backend', 'seeder');
    requireValue(status, ['pending', 'active'], 'group status');
    const row = ctx.db.groups.group_id.find(group_id);
    if (!row) throw new Error('Unknown group');
    ctx.db.groups.group_id.update({ ...row, onboarding_status: status });
  }
);

export const upsert_expense = spacetime.reducer(
  {
    expense_id: t.string(), group_id: t.string(), payer_phone: t.option(t.string()), description: t.string(),
    source_message_id: t.string(), split_mode: t.string(), status: t.string(), subtotal_cents: t.option(t.i64()),
    tax_cents: t.i64(), tip_cents: t.i64(), fees_cents: t.i64(), discount_cents: t.i64(), total_cents: t.i64(),
    objection_deadline: t.option(t.timestamp()), claim_deadline: t.option(t.timestamp()),
    proposal_message_id: t.option(t.string()), settle_message_id: t.option(t.string()),
    finalized_at: t.option(t.timestamp()),
  },
  (ctx, input) => {
    requireRole(ctx, 'backend', 'seeder');
    requireValue(input.split_mode, ['even', 'custom', 'itemized'], 'split mode');
    requireValue(input.status, ['needs_info', 'proposed', 'itemizing', 'finalized', 'settled', 'void'], 'expense status');
    if (input.total_cents < 0n || (input.total_cents === 0n && input.status !== 'needs_info')) {
      throw new Error('Expense total must be positive unless more information is needed');
    }
    const bySource = ctx.db.expenses.source_message_id.find(input.source_message_id);
    if (bySource && bySource.expense_id !== input.expense_id) throw new Error('Source message already has an expense');
    const existing = ctx.db.expenses.expense_id.find(input.expense_id);
    const row = {
      expense_id: input.expense_id, group_id: input.group_id, payer_phone: input.payer_phone,
      description: input.description, source_message_id: input.source_message_id,
      split_mode: input.split_mode, status: input.status, subtotal_cents: input.subtotal_cents,
      tax_cents: input.tax_cents, tip_cents: input.tip_cents, fees_cents: input.fees_cents,
      discount_cents: input.discount_cents, total_cents: input.total_cents,
      objection_deadline: input.objection_deadline, claim_deadline: input.claim_deadline,
      proposal_message_id: input.proposal_message_id, settle_message_id: input.settle_message_id,
      created_at: existing?.created_at ?? ctx.timestamp, finalized_at: input.finalized_at,
    };
    if (existing) ctx.db.expenses.expense_id.update(row);
    else ctx.db.expenses.insert(row);
    if (!['finalized', 'settled', 'void'].includes(input.status) && ctx.db.shares.by_expense.filter(input.expense_id).next().value) {
      recompute(ctx, input.expense_id);
    }
  }
);

const lineItemInput = t.row('LineItemInput', {
  item_id: t.string(), position: t.u32(), description: t.string(), quantity: t.u32(), amount_cents: t.i64(),
});

export const set_line_items = spacetime.reducer(
  { expense_id: t.string(), items: t.array(lineItemInput) },
  (ctx, { expense_id, items }) => {
    requireRole(ctx, 'backend', 'seeder');
    if (!ctx.db.expenses.expense_id.find(expense_id)) throw new Error('Unknown expense');
    for (const claim of [...ctx.db.claims.by_expense.filter(expense_id)]) ctx.db.claims.delete(claim);
    for (const item of [...ctx.db.line_items.by_expense.filter(expense_id)]) ctx.db.line_items.delete(item);
    for (const item of items) {
      if (item.amount_cents < 0n || item.quantity === 0) throw new Error('Invalid line item');
      ctx.db.line_items.insert({ expense_id, ...item });
    }
    recompute(ctx, expense_id);
  }
);

export const add_claim = spacetime.reducer(
  { item_id: t.string(), phone: t.string(), source_message_id: t.string() },
  (ctx, { item_id, phone, source_message_id }) => {
    requireRole(ctx, 'backend', 'seeder');
    const item = ctx.db.line_items.item_id.find(item_id);
    if (!item) throw new Error('Unknown line item');
    const claim_id = `${item_id}:${phone}`;
    if (!ctx.db.claims.claim_id.find(claim_id)) {
      ctx.db.claims.insert({ claim_id, item_id, expense_id: item.expense_id, phone, source_message_id, created_at: ctx.timestamp });
    }
    recompute(ctx, item.expense_id);
  }
);

export const remove_claim = spacetime.reducer(
  { item_id: t.string(), phone: t.string() },
  (ctx, { item_id, phone }) => {
    requireRole(ctx, 'backend', 'seeder');
    const item = ctx.db.line_items.item_id.find(item_id);
    if (!item) throw new Error('Unknown line item');
    const claim = ctx.db.claims.claim_id.find(`${item_id}:${phone}`);
    if (claim) ctx.db.claims.delete(claim);
    recompute(ctx, item.expense_id);
  }
);

export const set_share = spacetime.reducer(
  {
    expense_id: t.string(), phone: t.string(), role: t.string(), status: t.string(),
    fixed_cents: t.option(t.i64()), responded: t.bool(), followup_count: t.u32(),
    last_followup_at: t.option(t.timestamp()),
  },
  (ctx, input) => {
    requireRole(ctx, 'backend', 'seeder');
    requireValue(input.role, ['payer', 'participant'], 'share role');
    requireValue(input.status, ['proposed', 'awaiting_claim', 'locked', 'approved', 'paid', 'disputed', 'opted_out'], 'share status');
    const share_id = `${input.expense_id}:${input.phone}`;
    const existing = ctx.db.shares.share_id.find(share_id);
    const row = {
      share_id, expense_id: input.expense_id, phone: input.phone, role: input.role,
      status: input.status, fixed_cents: input.fixed_cents,
      amount_cents: existing?.amount_cents ?? 0n, responded: input.responded,
      followup_count: input.followup_count, last_followup_at: input.last_followup_at,
      updated_at: ctx.timestamp,
    };
    if (existing) ctx.db.shares.share_id.update(row);
    else ctx.db.shares.insert(row);
    // A dispute changes workflow state, not the already-finalized amount. In
    // particular, recompute() intentionally rejects finalized expenses.
    if (input.status !== 'disputed') recompute(ctx, input.expense_id);
  }
);

export const recompute_expense = spacetime.reducer({ expense_id: t.string() }, (ctx, { expense_id }) => {
  requireRole(ctx, 'backend', 'seeder');
  recompute(ctx, expense_id);
});

function recompute(ctx: any, expenseId: string): void {
  const expense = ctx.db.expenses.expense_id.find(expenseId);
  if (!expense) throw new Error('Unknown expense');
  if (['finalized', 'settled', 'void'].includes(expense.status)) throw new Error('Expense amounts are locked');
  const shareRows = [...ctx.db.shares.by_expense.filter(expenseId)];
  if (shareRows.length === 0) return;
  const itemRows = [...ctx.db.line_items.by_expense.filter(expenseId)];
  if (expense.split_mode === 'itemized' && itemRows.length === 0) return;
  const result = computeSplit({
    mode: expense.split_mode,
    participants: shareRows.map((share: any) => ({
      phone: share.phone, fixedCents: share.fixed_cents, optedOut: share.status === 'opted_out',
    })),
    subtotalCents: expense.subtotal_cents ?? expense.total_cents,
    taxCents: expense.tax_cents, tipCents: expense.tip_cents,
    feesCents: expense.fees_cents, discountCents: expense.discount_cents,
    items: itemRows.map((item: any) => ({
      amountCents: item.amount_cents,
      claimers: [...ctx.db.claims.by_item.filter(item.item_id)].map((claim: any) => claim.phone),
    })),
  });
  const actual = [...result.values()].reduce((sum, amount) => sum + amount, 0n);
  if (actual !== expense.total_cents) throw new Error('Computed shares do not match expense total');
  for (const share of shareRows) {
    ctx.db.shares.share_id.update({
      ...share, amount_cents: result.get(share.phone) ?? 0n, updated_at: ctx.timestamp,
    });
  }
}

export const enqueue_outbox = spacetime.reducer(
  {
    action_id: t.string(), kind: t.string(), group_id: t.option(t.string()), to_phone: t.option(t.string()),
    target_message_id: t.option(t.string()), text: t.option(t.string()), reaction: t.option(t.string()),
    expense_id: t.option(t.string()), purpose: t.string(), send_after: t.timestamp(),
  },
  (ctx, input) => {
    requireRole(ctx, 'backend', 'seeder');
    if (ctx.db.outbox.action_id.find(input.action_id)) return;
    ctx.db.outbox.insert({
      action_id: input.action_id, kind: input.kind, group_id: input.group_id,
      to_phone: input.to_phone, target_message_id: input.target_message_id,
      text: input.text, reaction: input.reaction, expense_id: input.expense_id,
      expense_key: input.expense_id ?? '', purpose: input.purpose, send_after: input.send_after,
      send_after_micros: input.send_after.microsSinceUnixEpoch,
      status: 'queued', sent_photon_id: undefined, created_at: ctx.timestamp, sent_at: undefined, error: undefined,
    });
  }
);

export const cancel_outbox = spacetime.reducer(
  { expense_id: t.string(), to_phone: t.option(t.string()) },
  (ctx, { expense_id, to_phone }) => {
    requireRole(ctx, 'backend');
    for (const row of [...ctx.db.outbox.by_expense.filter(expense_id)]) {
      if (row.status === 'queued' && (!to_phone || row.to_phone === to_phone)) {
        ctx.db.outbox.action_id.update({ ...row, status: 'cancelled' });
      }
    }
  }
);

export const create_transfer = spacetime.reducer(
  { transfer_id: t.string(), expense_id: t.string(), from_phone: t.string(), approved_by_message_id: t.string() },
  (ctx, input) => {
    requireRole(ctx, 'backend', 'seeder');
    const existing = ctx.db.transfers.by_approval_expense
      .filter([input.approved_by_message_id, input.expense_id]).next().value;
    if (existing) return;
    const expense = ctx.db.expenses.expense_id.find(input.expense_id);
    if (!expense || !expense.payer_phone) throw new Error('Expense has no payer');
    if (expense.status !== 'finalized') throw new Error('Expense is not ready for settlement');
    if (input.from_phone === expense.payer_phone) throw new Error('Payer does not transfer to themselves');
    const approval = ctx.db.messages.message_id.find(input.approved_by_message_id);
    if (!approval || approval.sender_phone !== input.from_phone) throw new Error('Approval does not belong to debtor');
    const share = ctx.db.shares.share_id.find(`${input.expense_id}:${input.from_phone}`);
    if (!share || share.role !== 'participant' || share.status !== 'locked') throw new Error('Share is not payable');
    ctx.db.shares.share_id.update({ ...share, status: 'approved', updated_at: ctx.timestamp });
    ctx.db.transfers.insert({
      transfer_id: input.transfer_id, group_id: expense.group_id, expense_id: input.expense_id,
      from_phone: input.from_phone, to_phone: expense.payer_phone, amount_cents: share.amount_cents,
      provider: 'spacetime_simulated', status: 'pending', approved_by_message_id: input.approved_by_message_id,
      created_at: ctx.timestamp, completed_at: undefined, error: undefined,
    });
    const config = ctx.db.module_config.config_key.find('main');
    const delay = config?.demo_mode ? 750_000n : 2_000_000n;
    ctx.db.transfer_completion_schedule.insert({
      scheduled_id: 0n,
      scheduled_at: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + delay),
      transfer_id: input.transfer_id,
    });
  }
);

const SETTLE_MODES = ['ledger', 'per_expense'] as const;

export const set_settle_mode = spacetime.reducer(
  { group_id: t.string(), settle_mode: t.string() },
  (ctx, { group_id, settle_mode }) => {
    requireRole(ctx, 'backend');
    requireValue(settle_mode, SETTLE_MODES, 'settle mode');
    if (!ctx.db.groups.group_id.find(group_id)) throw new Error('Unknown group');
    const row = { group_id, settle_mode, updated_at: ctx.timestamp };
    if (ctx.db.group_settings.group_id.find(group_id)) ctx.db.group_settings.group_id.update(row);
    else ctx.db.group_settings.insert(row);
  }
);

// SPEC 7.6 disputes: only the disputing person's amount changes, and the payer's
// own share absorbs the difference so the expense total (and everyone else) is unchanged.
export const resolve_dispute = spacetime.reducer(
  { expense_id: t.string(), phone: t.string(), amount_cents: t.i64() },
  (ctx, { expense_id, phone, amount_cents }) => {
    requireRole(ctx, 'backend');
    if (amount_cents < 0n) throw new Error('Amount must not be negative');
    const expense = ctx.db.expenses.expense_id.find(expense_id);
    if (!expense) throw new Error('Unknown expense');
    if (expense.status !== 'finalized') throw new Error('Only finalized expenses have disputes to resolve');
    if (!expense.payer_phone) throw new Error('Expense has no payer');
    const share = ctx.db.shares.share_id.find(`${expense_id}:${phone}`);
    if (!share || share.role !== 'participant' || share.status !== 'disputed') throw new Error('Share is not disputed');
    const payerShare = ctx.db.shares.share_id.find(`${expense_id}:${expense.payer_phone}`);
    if (!payerShare) throw new Error('Payer share is missing');
    const payerAmount = payerShare.amount_cents - (amount_cents - share.amount_cents);
    if (payerAmount < 0n) throw new Error("Amount exceeds what the payer's share can absorb");
    ctx.db.shares.share_id.update({ ...share, amount_cents, status: 'locked', updated_at: ctx.timestamp });
    ctx.db.shares.share_id.update({ ...payerShare, amount_cents: payerAmount, updated_at: ctx.timestamp });
    const sum = [...ctx.db.shares.by_expense.filter(expense_id)].reduce((total, row) => total + row.amount_cents, 0n);
    if (sum !== expense.total_cents) throw new Error('Shares do not match expense total');
  }
);

export const complete_simulated_transfer = spacetime.reducer(
  { onSchedule: transfer_completion_schedule },
  { scheduled_transfer: transfer_completion_schedule.rowType },
  (ctx, { scheduled_transfer }) => {
    const transfer = ctx.db.transfers.transfer_id.find(scheduled_transfer.transfer_id);
    if (!transfer || transfer.status !== 'pending') return;
    const share = ctx.db.shares.share_id.find(`${transfer.expense_id}:${transfer.from_phone}`);
    if (!share || share.status !== 'approved') throw new Error('Approved share is missing');
    ctx.db.transfers.transfer_id.update({ ...transfer, status: 'done', completed_at: ctx.timestamp, error: undefined });
    ctx.db.shares.share_id.update({ ...share, status: 'paid', updated_at: ctx.timestamp });
    const allPaid = [...ctx.db.shares.by_expense.filter(transfer.expense_id)]
      .filter(row => row.role === 'participant' && row.status !== 'opted_out')
      .every(row => row.share_id === share.share_id || row.status === 'paid');
    if (allPaid) {
      const expense = ctx.db.expenses.expense_id.find(transfer.expense_id);
      if (expense) ctx.db.expenses.expense_id.update({ ...expense, status: 'settled' });
    }
  }
);

export const set_ledger_secret = spacetime.reducer(
  { group_id: t.string(), secret: t.string() },
  (ctx, { group_id, secret }) => {
    requireRole(ctx, 'backend', 'seeder');
    if (!ctx.db.groups.group_id.find(group_id)) throw new Error('Unknown group');
    if (secret.length < 24) throw new Error('Ledger secret must contain at least 24 characters');
    const current = ctx.db.ledger_secrets.group_id.find(group_id);
    if (current) ctx.db.ledger_secrets.delete(current);
    ctx.db.ledger_secrets.insert({ secret, group_id, created_at: ctx.timestamp });
  }
);

export const redeem_ledger_access = spacetime.reducer({ secret: t.string() }, (ctx, { secret }) => {
  const row = ctx.db.ledger_secrets.secret.find(secret);
  if (!row) throw new Error('Invalid ledger link');
  const grant_id = `${ctx.sender.toHexString()}:${row.group_id}`;
  if (!ctx.db.ledger_grants.grant_id.find(grant_id)) {
    ctx.db.ledger_grants.insert({ grant_id, identity: ctx.sender, group_id: row.group_id, created_at: ctx.timestamp });
  }
});

export const set_nessie_ids = spacetime.reducer(
  {
    member_id: t.string(), customer_id: t.option(t.string()), account_id: t.option(t.string()),
    deposit_created: t.bool(), seeded_balance_cents: t.i64(),
  },
  (ctx, input) => {
    requireRole(ctx, 'seeder');
    const member = ctx.db.members.member_id.find(input.member_id);
    if (!member) throw new Error('Unknown member');
    const row = {
      member_id: input.member_id, group_id: member.group_id, customer_id: input.customer_id,
      account_id: input.account_id, deposit_created: input.deposit_created,
      seeded_balance_cents: input.seeded_balance_cents, updated_at: ctx.timestamp,
    };
    const existing = ctx.db.nessie_seed_progress.member_id.find(input.member_id);
    if (existing) ctx.db.nessie_seed_progress.member_id.update(row);
    else ctx.db.nessie_seed_progress.insert(row);
    ctx.db.members.member_id.update({
      ...member, nessie_customer_id: input.customer_id, nessie_account_id: input.account_id,
    });
  }
);

const MIRROR_STATUSES = ['recorded', 'failed'] as const;

/** The Nessie mirror's result for one settlement. Seeder role only. */
export const record_nessie_mirror = spacetime.reducer(
  {
    transfer_id: t.string(), status: t.string(), withdrawn_dollars: t.i64(), deposited_dollars: t.i64(),
    withdrawal_id: t.option(t.string()), deposit_id: t.option(t.string()), attempts: t.u32(), error: t.option(t.string()),
  },
  (ctx, input) => {
    requireRole(ctx, 'seeder');
    requireValue(input.status, MIRROR_STATUSES, 'mirror status');
    const transfer = ctx.db.transfers.transfer_id.find(input.transfer_id);
    if (!transfer || transfer.status !== 'done') throw new Error('Only completed transfers are mirrored');
    const from = ctx.db.members.member_id.find(`${transfer.group_id}:${transfer.from_phone}`)?.nessie_account_id;
    const to = ctx.db.members.member_id.find(`${transfer.group_id}:${transfer.to_phone}`)?.nessie_account_id;
    if (!from || !to) throw new Error('Both people need Nessie accounts');
    if (input.withdrawn_dollars < 0n || input.deposited_dollars < 0n) throw new Error('Dollars must not be negative');
    const row = {
      transfer_id: input.transfer_id, status: input.status, from_account_id: from, to_account_id: to,
      amount_cents: transfer.amount_cents, withdrawn_dollars: input.withdrawn_dollars, deposited_dollars: input.deposited_dollars,
      withdrawal_id: input.withdrawal_id, deposit_id: input.deposit_id, attempts: input.attempts, error: input.error,
      updated_at: ctx.timestamp,
    };
    if (ctx.db.nessie_mirror_progress.transfer_id.find(input.transfer_id)) ctx.db.nessie_mirror_progress.transfer_id.update(row);
    else ctx.db.nessie_mirror_progress.insert(row);
  }
);

/** A member's balance as computed from Nessie's records. Seeder role only. */
export const set_nessie_balance = spacetime.reducer(
  { member_id: t.string(), balance_cents: t.i64() },
  (ctx, input) => {
    requireRole(ctx, 'seeder');
    const member = ctx.db.members.member_id.find(input.member_id);
    if (!member) throw new Error('Unknown member');
    const row = { member_id: input.member_id, group_id: member.group_id, balance_cents: input.balance_cents, synced_at: ctx.timestamp };
    if (ctx.db.nessie_balances.member_id.find(input.member_id)) ctx.db.nessie_balances.member_id.update(row);
    else ctx.db.nessie_balances.insert(row);
  }
);

export const seed_completed_transfer = spacetime.reducer(
  {
    transfer_id: t.string(), expense_id: t.string(), from_phone: t.string(),
    approved_by_message_id: t.string(), completed_at: t.timestamp(),
  },
  (ctx, input) => {
    requireRole(ctx, 'seeder');
    if (ctx.db.transfers.transfer_id.find(input.transfer_id)) return;
    const expense = ctx.db.expenses.expense_id.find(input.expense_id);
    const share = ctx.db.shares.share_id.find(`${input.expense_id}:${input.from_phone}`);
    if (!expense?.payer_phone || !share || share.role !== 'participant') throw new Error('Invalid seeded transfer');
    ctx.db.transfers.insert({
      transfer_id: input.transfer_id, group_id: expense.group_id, expense_id: input.expense_id,
      from_phone: input.from_phone, to_phone: expense.payer_phone, amount_cents: share.amount_cents,
      provider: 'spacetime_simulated', status: 'done', approved_by_message_id: input.approved_by_message_id,
      created_at: input.completed_at, completed_at: input.completed_at, error: undefined,
    });
    ctx.db.shares.share_id.update({ ...share, status: 'paid', updated_at: input.completed_at });
    const allPaid = [...ctx.db.shares.by_expense.filter(input.expense_id)]
      .filter(row => row.role === 'participant' && row.status !== 'opted_out')
      .every(row => row.share_id === share.share_id || row.status === 'paid');
    if (allPaid) ctx.db.expenses.expense_id.update({ ...expense, status: 'settled' });
  }
);

const ledgerGroupRow = t.row('LedgerGroup', {
  ledger_group_id: t.string().primaryKey(), display_name: t.option(t.string()), timezone: t.string(), status: t.string(),
});
const ledgerMemberRow = t.row('LedgerMember', {
  ledger_member_id: t.string().primaryKey(), ledger_group_id: t.string(), name: t.option(t.string()),
  // From Nessie's records (nessie_balances); absent until the mirror has synced it.
  bank_balance_cents: t.option(t.i64()),
});
const ledgerExpenseRow = t.row('LedgerExpense', {
  expense_id: t.string().primaryKey(), ledger_group_id: t.string(), payer_ledger_member_id: t.option(t.string()),
  description: t.string(), split_mode: t.string(), status: t.string(), total_cents: t.i64(), created_at: t.timestamp(),
});
const ledgerShareRow = t.row('LedgerShare', {
  ledger_share_id: t.string().primaryKey(), expense_id: t.string(), ledger_member_id: t.string(),
  role: t.string(), status: t.string(), amount_cents: t.i64(),
});
const ledgerItemRow = t.row('LedgerItem', {
  item_id: t.string().primaryKey(), expense_id: t.string(), position: t.u32(), description: t.string(),
  quantity: t.u32(), amount_cents: t.i64(),
});
const ledgerClaimRow = t.row('LedgerClaim', {
  ledger_claim_id: t.string().primaryKey(), item_id: t.string(), expense_id: t.string(), ledger_member_id: t.string(),
});
const ledgerTransferRow = t.row('LedgerTransfer', {
  transfer_id: t.string().primaryKey(), expense_id: t.string(), from_ledger_member_id: t.string(),
  to_ledger_member_id: t.string(), amount_cents: t.i64(), provider: t.string(), status: t.string(),
  created_at: t.timestamp(), completed_at: t.option(t.timestamp()),
});
const ledgerBalanceRow = t.row('LedgerBalance', {
  edge_id: t.string().primaryKey(), from_ledger_member_id: t.string(), to_ledger_member_id: t.string(), amount_cents: t.i64(),
});
const seederMemberRow = t.row('SeederMember', {
  member_id: t.string().primaryKey(), group_id: t.string(), phone: t.string(), name: t.option(t.string()),
  customer_id: t.option(t.string()), account_id: t.option(t.string()), deposit_created: t.bool(),
  seeded_balance_cents: t.i64(),
});
const backendMemberRow = t.row('BackendMember', {
  member_id: t.string().primaryKey(), ledger_member_id: t.string(), group_id: t.string(), phone: t.string(),
  name: t.option(t.string()), joined_at: t.timestamp(), left_at: t.option(t.timestamp()),
});

const backendGroupSettingsRow = t.row('BackendGroupSetting', {
  group_id: t.string().primaryKey(), settle_mode: t.string(),
});

const clientOutboxRow = t.row('ClientOutboxItem', {
  action_id: t.string().primaryKey(), kind: t.string(), group_id: t.option(t.string()), to_phone: t.option(t.string()),
  target_message_id: t.option(t.string()), text: t.option(t.string()), reaction: t.option(t.string()),
  expense_id: t.option(t.string()), purpose: t.string(), send_after: t.timestamp(), status: t.string(),
});

function grantedGroups(ctx: any): string[] {
  return [...ctx.db.ledger_grants.by_identity.filter(ctx.sender)].map((grant: any) => grant.group_id);
}

function ledgerMemberFor(ctx: any, groupId: string, phone: string): any {
  return ctx.db.members.by_group_phone.filter([groupId, phone]).next().value;
}

function canReadBackendViews(ctx: any): boolean {
  if (isOwner(ctx)) return true;
  return ctx.db.service_roles.identity.find(ctx.sender)?.role === 'backend';
}

export const backend_messages = spacetime.view(
  { name: 'backend_messages', public: true }, t.array(messages.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.messages] : []
);

export const backend_groups = spacetime.view(
  { name: 'backend_groups', public: true }, t.array(groups.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.groups] : []
);

/** One row per group with its effective settle mode ("ledger" when never set). */
export const backend_group_settings = spacetime.view(
  { name: 'backend_group_settings', public: true }, t.array(backendGroupSettingsRow), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.groups].map(group => ({
      group_id: group.group_id,
      settle_mode: ctx.db.group_settings.group_id.find(group.group_id)?.settle_mode ?? 'ledger',
    })) : []
);

export const backend_members = spacetime.view(
  { name: 'backend_members', public: true }, t.array(backendMemberRow), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.members].map(member => ({
      member_id: member.member_id, ledger_member_id: member.ledger_member_id, group_id: member.group_id,
      phone: member.phone, name: member.name, joined_at: member.joined_at, left_at: member.left_at,
    })) : []
);

export const backend_outbox = spacetime.view(
  { name: 'backend_outbox', public: true }, t.array(outbox.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.outbox] : []
);

export const backend_expenses = spacetime.view(
  { name: 'backend_expenses', public: true }, t.array(expenses.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.expenses] : []
);

export const backend_line_items = spacetime.view(
  { name: 'backend_line_items', public: true }, t.array(line_items.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.line_items] : []
);

export const backend_claims = spacetime.view(
  { name: 'backend_claims', public: true }, t.array(claims.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.claims] : []
);

export const backend_shares = spacetime.view(
  { name: 'backend_shares', public: true }, t.array(shares.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.shares] : []
);

export const backend_transfers = spacetime.view(
  { name: 'backend_transfers', public: true }, t.array(transfers.rowType), ctx =>
    canReadBackendViews(ctx) ? [...ctx.db.transfers] : []
);

export const ledger_groups = spacetime.view(
  { name: 'ledger_groups', public: true }, t.array(ledgerGroupRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => {
      const group = ctx.db.groups.group_id.find(groupId);
      return group ? [{ ledger_group_id: group.ledger_id, display_name: group.display_name, timezone: group.timezone, status: group.onboarding_status }] : [];
    })
);

export const ledger_members = spacetime.view(
  { name: 'ledger_members', public: true }, t.array(ledgerMemberRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => {
      const group = ctx.db.groups.group_id.find(groupId);
      if (!group) return [];
      return [...ctx.db.members.by_group.filter(groupId)].map(member => ({
        ledger_member_id: member.ledger_member_id, ledger_group_id: group.ledger_id, name: member.name,
        bank_balance_cents: ctx.db.nessie_balances.member_id.find(member.member_id)?.balance_cents,
      }));
    })
);

export const ledger_expenses = spacetime.view(
  { name: 'ledger_expenses', public: true }, t.array(ledgerExpenseRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => {
      const group = ctx.db.groups.group_id.find(groupId);
      if (!group) return [];
      return [...ctx.db.expenses.by_group.filter(groupId)].map(expense => ({
        expense_id: expense.expense_id, ledger_group_id: group.ledger_id,
        payer_ledger_member_id: expense.payer_phone ? ledgerMemberFor(ctx, groupId, expense.payer_phone)?.ledger_member_id : undefined,
        description: expense.description, split_mode: expense.split_mode, status: expense.status,
        total_cents: expense.total_cents, created_at: expense.created_at,
      }));
    })
);

export const ledger_shares = spacetime.view(
  { name: 'ledger_shares', public: true }, t.array(ledgerShareRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => [...ctx.db.expenses.by_group.filter(groupId)].flatMap(expense =>
      [...ctx.db.shares.by_expense.filter(expense.expense_id)].flatMap(share => {
        const member = ledgerMemberFor(ctx, groupId, share.phone);
        return member ? [{
          ledger_share_id: `${share.expense_id}:${member.ledger_member_id}`, expense_id: share.expense_id,
          ledger_member_id: member.ledger_member_id, role: share.role, status: share.status, amount_cents: share.amount_cents,
        }] : [];
      })
    ))
);

export const ledger_items = spacetime.view(
  { name: 'ledger_items', public: true }, t.array(ledgerItemRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => [...ctx.db.expenses.by_group.filter(groupId)].flatMap(expense =>
      [...ctx.db.line_items.by_expense.filter(expense.expense_id)].map(item => ({
        item_id: item.item_id, expense_id: item.expense_id, position: item.position,
        description: item.description, quantity: item.quantity, amount_cents: item.amount_cents,
      }))
    ))
);

export const ledger_claims = spacetime.view(
  { name: 'ledger_claims', public: true }, t.array(ledgerClaimRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => [...ctx.db.expenses.by_group.filter(groupId)].flatMap(expense =>
      [...ctx.db.claims.by_expense.filter(expense.expense_id)].flatMap(claim => {
        const member = ledgerMemberFor(ctx, groupId, claim.phone);
        return member ? [{
          ledger_claim_id: `${claim.item_id}:${member.ledger_member_id}`, item_id: claim.item_id,
          expense_id: claim.expense_id, ledger_member_id: member.ledger_member_id,
        }] : [];
      })
    ))
);

export const ledger_transfers = spacetime.view(
  { name: 'ledger_transfers', public: true }, t.array(ledgerTransferRow), ctx =>
    grantedGroups(ctx).flatMap(groupId => [...ctx.db.transfers.by_group.filter(groupId)].flatMap(transfer => {
      const from = ledgerMemberFor(ctx, groupId, transfer.from_phone);
      const to = ledgerMemberFor(ctx, groupId, transfer.to_phone);
      return from && to ? [{
        transfer_id: transfer.transfer_id, expense_id: transfer.expense_id,
        from_ledger_member_id: from.ledger_member_id, to_ledger_member_id: to.ledger_member_id,
        amount_cents: transfer.amount_cents, provider: transfer.provider, status: transfer.status,
        created_at: transfer.created_at, completed_at: transfer.completed_at,
      }] : [];
    }))
);

export const ledger_balances = spacetime.view(
  { name: 'ledger_balances', public: true }, t.array(ledgerBalanceRow), ctx => {
    const balances = new Map<string, { from: string; to: string; amount: bigint }>();
    for (const groupId of grantedGroups(ctx)) {
      for (const expense of ctx.db.expenses.by_group.filter(groupId)) {
        if (!expense.payer_phone) continue;
        const payer = ledgerMemberFor(ctx, groupId, expense.payer_phone);
        if (!payer) continue;
        for (const share of ctx.db.shares.by_expense.filter(expense.expense_id)) {
          if (share.role !== 'participant' || !['locked', 'approved', 'disputed'].includes(share.status)) continue;
          const debtor = ledgerMemberFor(ctx, groupId, share.phone);
          if (!debtor) continue;
          const key = `${debtor.ledger_member_id}:${payer.ledger_member_id}`;
          const current = balances.get(key);
          balances.set(key, {
            from: debtor.ledger_member_id, to: payer.ledger_member_id,
            amount: (current?.amount ?? 0n) + share.amount_cents,
          });
        }
      }
    }
    return [...balances.entries()].filter(([, value]) => value.amount > 0n).map(([edge_id, value]) => ({
      edge_id, from_ledger_member_id: value.from, to_ledger_member_id: value.to, amount_cents: value.amount,
    }));
  }
);

export const seeder_members = spacetime.view(
  { name: 'seeder_members', public: true }, t.array(seederMemberRow), ctx => {
    const service = ctx.db.service_roles.identity.find(ctx.sender);
    const config = ctx.db.module_config.config_key.find('main');
    const owner = config?.owner_identity?.isEqual(ctx.sender) ?? false;
    if (!owner && (!service || service.role !== 'seeder')) return [];
    return [...ctx.db.members].map(member => {
      const progress = ctx.db.nessie_seed_progress.member_id.find(member.member_id);
      return {
        member_id: member.member_id, group_id: member.group_id, phone: member.phone, name: member.name,
        customer_id: progress?.customer_id ?? member.nessie_customer_id,
        account_id: progress?.account_id ?? member.nessie_account_id,
        deposit_created: progress?.deposit_created ?? false,
        seeded_balance_cents: progress?.seeded_balance_cents ?? 0n,
      };
    });
  }
);

/** Outbox rows the iMessage client still has to send. Visible to the client role and the owner only. */
export const client_outbox = spacetime.view(
  { name: 'client_outbox', public: true }, t.array(clientOutboxRow), ctx => {
    if (!isOwner(ctx) && ctx.db.service_roles.identity.find(ctx.sender)?.role !== 'client') return [];
    return [...ctx.db.outbox]
      .filter(row => row.status === 'queued' || row.status === 'sending')
      .map(row => ({
        action_id: row.action_id, kind: row.kind, group_id: row.group_id, to_phone: row.to_phone,
        target_message_id: row.target_message_id, text: row.text, reaction: row.reaction,
        expense_id: row.expense_id, purpose: row.purpose, send_after: row.send_after, status: row.status,
      }));
  }
);

const nessieMirrorRow = t.row('NessieMirrorItem', {
  transfer_id: t.string().primaryKey(), amount_cents: t.i64(), from_account_id: t.string(), to_account_id: t.string(),
  completed_at: t.option(t.timestamp()),
  // What the mirror already recorded (nessie_mirror_progress), for its rounding carry and retries.
  from_member_id: t.string(), to_member_id: t.string(), mirror_status: t.option(t.string()),
  withdrawn_dollars: t.i64(), deposited_dollars: t.i64(), attempts: t.u32(),
});

/**
 * Completed settlements to copy into Nessie as a record (SPEC 12.2). Read-only:
 * settlement itself is simulated here and never waits on Nessie. Only transfers
 * where both people have Nessie accounts; seeder role and owner only.
 */
export const nessie_mirror = spacetime.view(
  { name: 'nessie_mirror', public: true }, t.array(nessieMirrorRow), ctx => {
    if (!isOwner(ctx) && ctx.db.service_roles.identity.find(ctx.sender)?.role !== 'seeder') return [];
    return [...ctx.db.transfers.by_status.filter('done')].flatMap(transfer => {
      const from = ctx.db.members.member_id.find(`${transfer.group_id}:${transfer.from_phone}`)?.nessie_account_id;
      const to = ctx.db.members.member_id.find(`${transfer.group_id}:${transfer.to_phone}`)?.nessie_account_id;
      if (!from || !to) return [];
      const progress = ctx.db.nessie_mirror_progress.transfer_id.find(transfer.transfer_id);
      return [{
        transfer_id: transfer.transfer_id, amount_cents: transfer.amount_cents, from_account_id: from, to_account_id: to,
        completed_at: transfer.completed_at,
        from_member_id: `${transfer.group_id}:${transfer.from_phone}`, to_member_id: `${transfer.group_id}:${transfer.to_phone}`,
        mirror_status: progress?.status, withdrawn_dollars: progress?.withdrawn_dollars ?? 0n,
        deposited_dollars: progress?.deposited_dollars ?? 0n, attempts: progress?.attempts ?? 0,
      }];
    });
  }
);
