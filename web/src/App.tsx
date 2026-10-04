import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
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

  const names = useMemo(
    () => new Map(members.map(member => [member.ledgerMemberId, member.name ?? 'Unnamed member'])),
    [members]
  );
  const [graphBox, setGraphBox] = useState<Size>({ width: 0, height: 0 });
  const [graphElement, setGraphElement] = useState<HTMLDivElement | null>(null);
  const graph = useMemo(
    () => buildGraph(members, balances, pulse, names, graphBox),
    [members, balances, pulse, names, graphBox]
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
        <Metric label="Housemates" value={String(members.length)} />
      </section>

      <section className="dashboard-grid">
        <article className="panel graph-panel">
          <div className="panel-heading"><div><p className="eyebrow">Money flow</p><h2>Who owes whom</h2></div><span className="hint">Live</span></div>
          <div className="graph-wrap" ref={setGraphElement}>
            {balances.length === 0 && !pulse ? (
              <div className="empty-state"><span>✓</span><strong>Everyone is square</strong><small>No outstanding balances</small></div>
            ) : (
              <ReactFlow
                nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={FIT_VIEW}
                minZoom={0.2} maxZoom={1.4} nodesDraggable={false} nodesConnectable={false}
              >
                <FitOnResize box={graphBox} nodeCount={graph.nodes.length} />
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

const FIT_VIEW = { padding: 0.08, maxZoom: 1.2 };
const NARROW_GRAPH = 520;

/** Fits the whole graph whenever its box or node count changes, not only on first render. */
function FitOnResize({ box, nodeCount }: { box: Size; nodeCount: number }) {
  const { fitView } = useReactFlow();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized || !box.width) return;
    const frame = requestAnimationFrame(() => { void fitView(FIT_VIEW); });
    return () => cancelAnimationFrame(frame);
  }, [initialized, box.width, box.height, nodeCount, fitView]);
  return null;
}

function buildGraph(
  members: readonly LedgerMember[], balances: readonly LedgerBalance[], pulse: Pulse | undefined,
  names: Map<string, string>, box: Size
): { nodes: Node[]; edges: Edge[] } {
  // A circle sized to the container, so fitView barely has to zoom on narrow screens.
  const width = box.width || 440;
  const height = box.height || 400;
  const narrow = width < NARROW_GRAPH;
  const nodeSize = { width: 96, height: 80 };
  const radiusX = Math.max(60, width / 2 - nodeSize.width / 2 - 12);
  const radiusY = Math.max(60, height / 2 - nodeSize.height / 2 - 12);
  // Two people read best side by side; more go round from the top.
  const start = members.length === 2 ? Math.PI : -Math.PI / 2;
  const nodes: Node[] = members.map((member, index) => {
    const angle = start + (Math.PI * 2 * index) / Math.max(members.length, 1);
    return {
      id: member.ledgerMemberId,
      position: {
        x: width / 2 + Math.cos(angle) * radiusX - nodeSize.width / 2,
        y: height / 2 + Math.sin(angle) * radiusY - nodeSize.height / 2,
      },
      style: { width: nodeSize.width },
      data: { label: <div className="person-node"><span>{(member.name ?? '?').slice(0, 1).toUpperCase()}</span><strong>{member.name ?? 'Unnamed'}</strong></div> },
      className: pulse && (pulse.from === member.ledgerMemberId || pulse.to === member.ledgerMemberId) ? 'graph-node pulse' : 'graph-node',
    };
  });
  const edges: Edge[] = balances.map(balance => ({
    id: balance.edgeId, source: balance.fromLedgerMemberId, target: balance.toLedgerMemberId,
    // The arrow already says who owes whom; on narrow screens the full sentence covers the nodes.
    label: narrow ? formatMoney(balance.amountCents) : `${names.get(balance.fromLedgerMemberId)} owes ${formatMoney(balance.amountCents)}`,
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
