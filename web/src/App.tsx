import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  MarkerType,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
} from '@xyflow/react';
import { centers, extent, layoutEdges, PILL_H, pillWidth, type Person, type Pt } from './graphLayout';
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
  const [allMembers] = useTable(tables.ledgerMembers);
  const [allExpenses] = useTable(tables.ledgerExpenses);
  const [allShares] = useTable(tables.ledgerShares);
  const [allItems] = useTable(tables.ledgerItems);
  const [allClaims] = useTable(tables.ledgerClaims);
  const [allTransfers] = useTable(tables.ledgerTransfers);
  const [allBalances] = useTable(tables.ledgerBalances);
  const [accessState, setAccessState] = useState<'idle' | 'redeeming' | 'ready' | 'invalid'>('idle');
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>();
  const [pulse, setPulse] = useState<Pulse>();
  const redeemedRef = useRef(false);
  const previousTransferStatus = useRef<Map<string, string> | undefined>(undefined);

  // main.tsx gives each link its own identity, so the views should hold one group.
  // Still pin everything to a single group so a stray grant can never mix ledgers.
  const group = groups[0];
  const scoped = useMemo(
    () => scopeToGroup(group?.ledgerGroupId, {
      members: allMembers, expenses: allExpenses, shares: allShares, items: allItems,
      claims: allClaims, transfers: allTransfers, balances: allBalances,
    }),
    [group?.ledgerGroupId, allMembers, allExpenses, allShares, allItems, allClaims, allTransfers, allBalances]
  );
  const { members, expenses, shares, items, claims, transfers, balances } = scoped;

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
    if (expenses.some(expense => expense.expenseId === selectedExpenseId)) return;
    setSelectedExpenseId(expenses[0]?.expenseId);
  }, [expenses, selectedExpenseId]);

  const names = useMemo(() => memberNames(members), [members]);
  const [graphBox, setGraphBox] = useState<Size>({ width: 0, height: 0 });
  const [graphElement, setGraphElement] = useState<HTMLDivElement | null>(null);
  const graph = useMemo(
    () => buildGraph(members, balances, pulse, names),
    [members, balances, pulse, names]
  );

  // Lay the graph out for the box it actually has, and refit when that box changes.
  useEffect(() => {
    const element = graphElement;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setGraphBox(current => current.width === Math.round(width) && current.height === Math.round(height)
        ? current : { width: Math.round(width), height: Math.round(height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [graphElement]);

  if (!secret) return <StatusPage title="Ledger link required" detail="Open the private link posted by Tab in your group chat." />;
  if (connectionError) return <StatusPage title="Ledger unavailable" detail={connectionError.message} />;
  if (!isActive || !groupsReady || accessState === 'idle' || accessState === 'redeeming') {
    return <StatusPage title="Opening your ledger" detail="Connecting to the live SpacetimeDB view…" loading />;
  }
  if (accessState === 'invalid') return <StatusPage title="That link is invalid" detail="Ask Tab for a fresh private ledger link." />;
  if (!group) return <StatusPage title="Access granted" detail="Waiting for this group’s first ledger update…" loading />;

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
        <Metric label="People" value={String(members.length)} />
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
          <div className="graph-wrap" ref={setGraphElement}>
            {balances.length === 0 && !pulse ? (
              <div className="empty-state"><span>✓</span><strong>Everyone is square</strong><small>No outstanding balances</small></div>
            ) : (
              <ReactFlow
                key={`${graphBox.width}x${graphBox.height}`} nodes={graph.nodes} edges={graph.edges} edgeTypes={EDGE_TYPES}
                fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.2} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false}
              >
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

/**
 * Display names for the ledger. Members Tab hasn't learned a name for get
 * "Member 1", "Member 2"… in a stable order; the views never expose phones.
 */
function memberNames(members: readonly LedgerMember[]): Map<string, string> {
  const names = new Map<string, string>();
  let unnamed = 0;
  for (const member of [...members].sort((a, b) => a.ledgerMemberId.localeCompare(b.ledgerMemberId))) {
    const name = member.name?.trim();
    names.set(member.ledgerMemberId, name || `Member ${++unnamed}`);
  }
  return names;
}

type LedgerRows = {
  members: readonly LedgerMember[]; expenses: readonly LedgerExpense[]; shares: readonly LedgerShare[];
  items: readonly LedgerItem[]; claims: readonly LedgerClaim[]; transfers: readonly LedgerTransfer[];
  balances: readonly LedgerBalance[];
};

/** Keeps only the rows that belong to one group: by group id, then by its expenses and members. */
function scopeToGroup(groupId: string | undefined, rows: LedgerRows): LedgerRows {
  const members = rows.members.filter(member => member.ledgerGroupId === groupId);
  const expenses = rows.expenses.filter(expense => expense.ledgerGroupId === groupId);
  const memberIds = new Set(members.map(member => member.ledgerMemberId));
  const expenseIds = new Set(expenses.map(expense => expense.expenseId));
  return {
    members,
    expenses,
    shares: rows.shares.filter(share => expenseIds.has(share.expenseId)),
    items: rows.items.filter(item => expenseIds.has(item.expenseId)),
    claims: rows.claims.filter(claim => expenseIds.has(claim.expenseId)),
    transfers: rows.transfers.filter(transfer => expenseIds.has(transfer.expenseId)),
    balances: rows.balances.filter(balance =>
      memberIds.has(balance.fromLedgerMemberId) && memberIds.has(balance.toLedgerMemberId)),
  };
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

type Size = { width: number; height: number };

// A debt arrow drawn from graphLayout's precomputed path, with its amount on
// a solid pill so lines never run through the text.
type MoneyEdgeData = { path: string; labelAt: Pt; text: string; settled?: boolean };
function MoneyEdge({ id, data, markerEnd, style }: EdgeProps) {
  const d = data as MoneyEdgeData;
  return (
    <>
      <BaseEdge id={id} path={d.path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div className={`edge-label${d.settled ? ' settled' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${d.labelAt.x}px, ${d.labelAt.y}px)` }}>
          {d.text}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
const EDGE_TYPES = { money: MoneyEdge };

function buildGraph(
  members: readonly LedgerMember[], balances: readonly LedgerBalance[], pulse: Pulse | undefined,
  names: Map<string, string>
): { nodes: Node[]; edges: Edge[] } {
  const spots = centers(members.length).centers;
  const at = new Map<string, Person>(members.map((member, i) => [member.ledgerMemberId, { center: spots[i]!, name: names.get(member.ledgerMemberId) ?? 'Unnamed' }]));
  const nodes: Node[] = members.map(member => {
    const { center: c, name } = at.get(member.ledgerMemberId)!;
    const w = pillWidth(name);
    return {
      id: member.ledgerMemberId,
      position: { x: c.x - w / 2, y: c.y - PILL_H / 2 },
      style: { width: w, height: PILL_H },
      data: { label: <div className="person-node">{name}</div> },
      className: pulse && (pulse.from === member.ledgerMemberId || pulse.to === member.ledgerMemberId) ? 'graph-node pulse' : 'graph-node',
    };
  });
  const debts = balances
    .filter(balance => at.has(balance.fromLedgerMemberId) && at.has(balance.toLedgerMemberId))
    .map(balance => ({
      id: balance.edgeId, from: at.get(balance.fromLedgerMemberId)!, to: at.get(balance.toLedgerMemberId)!,
      label: formatMoney(balance.amountCents), balance,
    }));
  const settled = pulse && at.has(pulse.from) && at.has(pulse.to)
    ? [{ id: `settled-${pulse.transferId}`, from: at.get(pulse.from)!, to: at.get(pulse.to)!, label: `Paid ${formatMoney(pulse.amount)}` }]
    : [];
  const placed = layoutEdges([...debts, ...settled], [...at.values()]);
  // Two invisible corners around every arrow and label: fitView only sees nodes.
  const { min, max } = extent([...at.values()], placed);
  for (const [id, p] of [['bounds-min', min], ['bounds-max', max]] as const)
    nodes.push({ id, position: p, data: { label: null }, className: 'bounds-node', style: { width: 1, height: 1 }, selectable: false, focusable: false });
  const edges: Edge[] = debts.map((debt, i) => ({
    id: debt.id, type: 'money', source: debt.balance.fromLedgerMemberId, target: debt.balance.toLedgerMemberId,
    data: { path: placed[i]!.path, labelAt: placed[i]!.label, text: debt.label },
    ariaLabel: `${names.get(debt.balance.fromLedgerMemberId)} owes ${names.get(debt.balance.toLedgerMemberId)} ${debt.label}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#ee5d3f' },
    style: { stroke: '#ee5d3f', strokeWidth: 2.5 },
  }));
  if (pulse && settled.length) {
    const p = placed[debts.length]!;
    edges.push({
      id: settled[0]!.id, type: 'money', source: pulse.from, target: pulse.to, animated: true, className: 'settled-edge',
      data: { path: p.path, labelAt: p.label, text: settled[0]!.label, settled: true },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#2ba879' }, style: { stroke: '#2ba879', strokeWidth: 4 },
    });
  }
  return { nodes, edges };
}
