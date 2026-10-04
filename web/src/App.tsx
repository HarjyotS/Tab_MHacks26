import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import type {
  LedgerBalance, LedgerClaim, LedgerExpense, LedgerItem,
  LedgerMember, LedgerShare, LedgerTransfer,
} from './module_bindings/types';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const formatMoney = (cents: bigint) => money.format(Number(cents) / 100);

type AppProps = { secret: string };
type Pulse = { transferId: string; from: string; to: string; amount: bigint };

export function App({ secret }: AppProps) {
  const { isActive, connectionError } = useSpacetimeDB();
  const redeem = useReducer(reducers.redeemLedgerAccess);
  const [groups, groupsReady] = useTable(tables.ledgerGroups);
  const [members] = useTable(tables.ledgerMembers);
  const [expenses] = useTable(tables.ledgerExpenses);
  const [shares] = useTable(tables.ledgerShares);
  const [items] = useTable(tables.ledgerItems);
  const [claims] = useTable(tables.ledgerClaims);
  const [transfers] = useTable(tables.ledgerTransfers);
  const [balances] = useTable(tables.ledgerBalances);
  const [accessState, setAccessState] = useState<'idle' | 'redeeming' | 'ready' | 'invalid'>('idle');
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>();
  const [pulse, setPulse] = useState<Pulse>();
  const redeemedRef = useRef(false);
  const previousTransferStatus = useRef<Map<string, string> | undefined>(undefined);

  useEffect(() => {
    if (!isActive || redeemedRef.current || !secret) return;
    redeemedRef.current = true;
    setAccessState('redeeming');
    redeem({ secret }).then(() => setAccessState('ready')).catch(() => setAccessState('invalid'));
  }, [isActive, redeem, secret]);

  useEffect(() => {
    const next = new Map(transfers.map(transfer => [transfer.transferId, transfer.status]));
    const previous = previousTransferStatus.current;
    if (previous) {
      const completed = transfers.find(transfer => transfer.status === 'done' && previous.get(transfer.transferId) === 'pending');
      if (completed) {
        setPulse({
          transferId: completed.transferId,
          from: completed.fromLedgerMemberId,
          to: completed.toLedgerMemberId,
          amount: completed.amountCents,
        });
        const timer = window.setTimeout(() => setPulse(undefined), 1800);
        previousTransferStatus.current = next;
        return () => window.clearTimeout(timer);
      }
    }
    previousTransferStatus.current = next;
  }, [transfers]);

  useEffect(() => {
    if (!selectedExpenseId && expenses.length) setSelectedExpenseId(expenses[0].expenseId);
  }, [expenses, selectedExpenseId]);

  const names = useMemo(
    () => new Map(members.map(member => [member.ledgerMemberId, member.name ?? 'Unnamed member'])),
    [members]
  );
  const graph = useMemo(
    () => buildGraph(members, balances, pulse, names),
    [members, balances, pulse, names]
  );

  if (!secret) return <StatusPage title="Ledger link required" detail="Open the private link posted by Tab in your group chat." />;
  if (connectionError) return <StatusPage title="Ledger unavailable" detail={connectionError.message} />;
  if (!isActive || !groupsReady || accessState === 'idle' || accessState === 'redeeming') {
    return <StatusPage title="Opening your ledger" detail="Connecting to the live SpacetimeDB view…" loading />;
  }
  if (accessState === 'invalid') return <StatusPage title="That link is invalid" detail="Ask Tab for a fresh private ledger link." />;
  if (!groups.length) return <StatusPage title="Access granted" detail="Waiting for this group’s first ledger update…" loading />;

  const group = groups[0];
  const selectedExpense = expenses.find(expense => expense.expenseId === selectedExpenseId);
  const outstanding = balances.reduce((sum, balance) => sum + balance.amountCents, 0n);
  const paid = transfers.filter(transfer => transfer.status === 'done').reduce((sum, transfer) => sum + transfer.amountCents, 0n);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">T</span><span>Tab</span></div>
        <div className="live"><span /> Live from SpacetimeDB</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">{group.status === 'active' ? 'Active group' : group.status}</p>
          <h1>{group.displayName ?? 'Shared ledger'}</h1>
          <p>Every balance below is computed in the database and updates as the group chat changes.</p>
        </div>
        <div className="hero-total">
          <span>Outstanding</span>
          <strong>{formatMoney(outstanding)}</strong>
        </div>
      </section>

      {pulse && (
        <div className="settlement-toast" role="status">
          <span className="check">✓</span>
          <div><strong>Simulated settlement complete</strong><small>{names.get(pulse.from)} paid {names.get(pulse.to)} {formatMoney(pulse.amount)}</small></div>
        </div>
      )}

      <section className="stats">
        <Metric label="Open expenses" value={String(expenses.filter(expense => expense.status !== 'settled').length)} />
        <Metric label="Simulated paid" value={formatMoney(paid)} />
        <Metric label="Housemates" value={String(members.length)} />
      </section>

      {/* Synced by the Nessie mirror from each member's Nessie records; hidden until it has run. */}
      {members.some(member => member.bankBalanceCents !== undefined) && (
        <section className="bank" aria-label="Bank balances">
          <p className="eyebrow">Bank balances · Nessie sandbox</p>
          <div className="bank-list">
            {members.filter(member => member.bankBalanceCents !== undefined).map(member => (
              <div className="bank-item" key={member.ledgerMemberId}>
                <span>{member.name ?? 'Unnamed'}</span><strong>{formatMoney(member.bankBalanceCents!)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-grid">
        <article className="panel graph-panel">
          <div className="panel-heading"><div><p className="eyebrow">Money flow</p><h2>Who owes whom</h2></div><span className="hint">Live</span></div>
          <div className="graph-wrap">
            {balances.length === 0 && !pulse ? (
              <div className="empty-state"><span>✓</span><strong>Everyone is square</strong><small>No outstanding balances</small></div>
            ) : (
              <ReactFlow nodes={graph.nodes} edges={graph.edges} fitView minZoom={0.65} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false}>
                <Background color="#d7dfda" gap={22} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
            )}
          </div>
        </article>

        <article className="panel expense-panel">
          <div className="panel-heading"><div><p className="eyebrow">History</p><h2>Expenses</h2></div><span className="count">{expenses.length}</span></div>
          <div className="expense-list">
            {[...expenses].sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch)).map(expense => (
              <button key={expense.expenseId} className={expense.expenseId === selectedExpenseId ? 'expense-row selected' : 'expense-row'} onClick={() => setSelectedExpenseId(expense.expenseId)}>
                <span className="expense-icon">{expense.status === 'settled' ? '✓' : '$'}</span>
                <span><strong>{expense.description}</strong><small>{expense.splitMode} split · {expense.status}</small></span>
                <b>{formatMoney(expense.totalCents)}</b>
              </button>
            ))}
          </div>
        </article>
      </section>

      {selectedExpense && (
        <ExpenseDetail
          expense={selectedExpense}
          shares={shares.filter(share => share.expenseId === selectedExpense.expenseId)}
          items={items.filter(item => item.expenseId === selectedExpense.expenseId)}
          claims={claims.filter(claim => claim.expenseId === selectedExpense.expenseId)}
          transfers={transfers.filter(transfer => transfer.expenseId === selectedExpense.expenseId)}
          names={names}
        />
      )}
      <footer>Simulated settlement · Nessie supplies setup-time sandbox profiles · No real money moves</footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function StatusPage({ title, detail, loading }: { title: string; detail: string; loading?: boolean }) {
  return <main className="status-page"><div className={loading ? 'status-logo loading' : 'status-logo'}>T</div><h1>{title}</h1><p>{detail}</p></main>;
}

function ExpenseDetail({ expense, shares, items, claims, transfers, names }: {
  expense: LedgerExpense; shares: readonly LedgerShare[]; items: readonly LedgerItem[];
  claims: readonly LedgerClaim[]; transfers: readonly LedgerTransfer[]; names: Map<string, string>;
}) {
  return (
    <section className="panel detail-panel">
      <div className="detail-title"><div><p className="eyebrow">Expense detail</p><h2>{expense.description}</h2></div><strong>{formatMoney(expense.totalCents)}</strong></div>
      <div className="detail-columns">
        <div><h3>Shares</h3>{shares.map(share => (
          <div className="detail-row" key={share.ledgerShareId}><span>{names.get(share.ledgerMemberId)}<small>{share.role}</small></span><span><b>{formatMoney(share.amountCents)}</b><em className={`status ${share.status}`}>{share.status}</em></span></div>
        ))}</div>
        <div><h3>{items.length ? 'Items & claims' : 'Settlement'}</h3>{items.length ? [...items].sort((a, b) => a.position - b.position).map(item => {
          const itemClaims = claims.filter(claim => claim.itemId === item.itemId).map(claim => names.get(claim.ledgerMemberId)).join(', ');
          return <div className="detail-row" key={item.itemId}><span>{item.position}. {item.description}<small>{itemClaims || 'Unclaimed'}</small></span><b>{formatMoney(item.amountCents)}</b></div>;
        }) : transfers.length ? transfers.map(transfer => (
          <div className="detail-row" key={transfer.transferId}><span>{names.get(transfer.fromLedgerMemberId)} → {names.get(transfer.toLedgerMemberId)}<small>Simulated settlement</small></span><span><b>{formatMoney(transfer.amountCents)}</b><em className={`status ${transfer.status}`}>{transfer.status}</em></span></div>
        )) : <p className="muted">Awaiting approval.</p>}</div>
      </div>
    </section>
  );
}

function buildGraph(
  members: readonly LedgerMember[], balances: readonly LedgerBalance[], pulse: Pulse | undefined, names: Map<string, string>
): { nodes: Node[]; edges: Edge[] } {
  const radius = 165;
  const nodes: Node[] = members.map((member, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(members.length, 1) - Math.PI / 2;
    return {
      id: member.ledgerMemberId,
      position: { x: 210 + Math.cos(angle) * radius, y: 180 + Math.sin(angle) * radius },
      data: { label: <div className="person-node"><span>{(member.name ?? '?').slice(0, 1).toUpperCase()}</span><strong>{member.name ?? 'Unnamed'}</strong></div> },
      className: pulse && (pulse.from === member.ledgerMemberId || pulse.to === member.ledgerMemberId) ? 'graph-node pulse' : 'graph-node',
    };
  });
  const edges: Edge[] = balances.map(balance => ({
    id: balance.edgeId, source: balance.fromLedgerMemberId, target: balance.toLedgerMemberId,
    label: `${names.get(balance.fromLedgerMemberId)} owes ${formatMoney(balance.amountCents)}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ee5d3f' },
    style: { stroke: '#ee5d3f', strokeWidth: 2.5 }, labelStyle: { fill: '#28322d', fontWeight: 700, fontSize: 12 },
  }));
  if (pulse) edges.push({
    id: `settled-${pulse.transferId}`, source: pulse.from, target: pulse.to, animated: true,
    label: `Settled ${formatMoney(pulse.amount)}`, markerEnd: { type: MarkerType.ArrowClosed, color: '#2ba879' },
    className: 'settled-edge', style: { stroke: '#2ba879', strokeWidth: 4 },
    labelStyle: { fill: '#157153', fontWeight: 800, fontSize: 13 },
  });
  return { nodes, edges };
}
