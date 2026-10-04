// Every simulated payment in the group, newest first: who paid whom, for
// which expense, and when (SPEC 12.3). The expense detail only shows one
// expense's payments, and none for an itemized receipt; this is the history
// across all of them. Built only from views the page already subscribes to
// (ledger_transfers, ledger_expenses, ledger_members), so the module needs no
// change. Kept in its own file so App.tsx only renders it.
import { useMemo, useState } from 'react';
import type { LedgerExpense, LedgerTransfer } from './module_bindings/types';
import './payments.css';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const SHOWN = 8;
const STATUS: Record<string, string> = { done: 'Paid', pending: 'In progress', failed: 'Failed' };
const VERB: Record<string, string> = { done: 'paid', pending: 'is paying', failed: "couldn't pay" };

type Props = {
  transfers: readonly LedgerTransfer[];
  expenses: readonly LedgerExpense[];
  names: Map<string, string>;
  timeZone?: string;
};

export function Payments({ transfers, expenses, names, timeZone }: Props) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const what = new Map(expenses.map(expense => [expense.expenseId, expense.description]));
    const now = new Date();
    return [...transfers]
      .map(transfer => ({ transfer, at: (transfer.completedAt ?? transfer.createdAt).toDate() }))
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map(({ transfer, at }) => ({
        id: transfer.transferId,
        from: names.get(transfer.fromLedgerMemberId) ?? 'Someone',
        to: names.get(transfer.toLedgerMemberId) ?? 'someone',
        amount: money.format(Number(transfer.amountCents) / 100),
        what: what.get(transfer.expenseId),
        day: dayLabel(at, now, timeZone),
        exact: at.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }),
        status: transfer.status,
      }));
  }, [transfers, expenses, names, timeZone]);
  const shown = showAll ? rows : rows.slice(0, SHOWN);

  return (
    <section className="panel payments-panel" aria-label="Payments">
      <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Payments</h2></div><span className="count">{rows.length}</span></div>
      {rows.length === 0 ? (
        <p className="payments-empty muted">No payments yet. They show up here once someone taps 👍 on a settle request.</p>
      ) : (
        <ol className="payments-list">
          {shown.map(row => (
            <li className="payment-row" key={row.id}>
              <span className="payment-icon" aria-hidden>→</span>
              <span className="payment-what">
                <strong>{row.from} {VERB[row.status] ?? 'paid'} {row.to}</strong>
                <small>{row.what ? `for ${row.what} · ` : ''}<time title={row.exact}>{row.day}</time></small>
              </span>
              <span className="payment-amount"><b>{row.amount}</b><em className={`status ${row.status}`}>{STATUS[row.status] ?? row.status}</em></span>
            </li>
          ))}
        </ol>
      )}
      {rows.length > SHOWN && (
        <button className="payments-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

const dayKey = (date: Date, timeZone?: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(date);

/** "Today", "Yesterday", "Mon" within the week, else "Sep 26", in the group's time zone (as Tab says it in the chat). */
export function dayLabel(at: Date, now: Date, timeZone?: string): string {
  const days = Math.round((Date.parse(dayKey(now, timeZone)) - Date.parse(dayKey(at, timeZone))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const format: Intl.DateTimeFormatOptions = days < 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' };
  return new Intl.DateTimeFormat('en-US', { ...format, timeZone }).format(at);
}
