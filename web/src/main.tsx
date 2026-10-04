import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings';
import { App } from './App';
import './styles.css';
import '@xyflow/react/dist/style.css';

const host = import.meta.env.VITE_SPACETIME_HOST ?? 'wss://maincloud.spacetimedb.com';
const database = import.meta.env.VITE_SPACETIME_DB ?? 'tabmhacks2026-268xk';

// Strip the deploy base (e.g. /Tab_MHacks26/ on GitHub Pages) before matching /g/<secret>.
const path = location.pathname.slice(import.meta.env.BASE_URL.length - 1);
const secret = decodeURIComponent(path.match(/^\/g\/([^/]+)/)?.[1] ?? '');

/**
 * The ledger_* views return every group the connection's identity has redeemed,
 * so one shared browser identity would mix groups once a second link is opened.
 * Each link gets its own identity instead: it only ever redeems its own secret,
 * so the views can only contain that one group.
 */
async function identityKey(): Promise<string> {
  const base = `tab:${host}/${database}:identity`;
  // The old shared identity holds grants for every link opened in this browser.
  try { localStorage.removeItem(base); } catch { /* storage unavailable */ }
  if (!secret) return base;
  return `${base}:${await linkId(secret)}`;
}

/** A short stable id for the link, so the secret itself is not a storage key. */
async function linkId(value: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // crypto.subtle needs a secure context; fall back to the link itself.
    return value;
  }
}

function readToken(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

async function start() {
  const tokenKey = await identityKey();
  const savedToken = readToken(tokenKey);
  let connectionBuilder = DbConnection.builder()
    .withUri(host)
    .withDatabaseName(database)
    .onConnect((_connection, _identity, token) => {
      try { if (token) localStorage.setItem(tokenKey, token); } catch { /* storage unavailable */ }
    });
  if (savedToken) connectionBuilder = connectionBuilder.withToken(savedToken);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
        <App secret={secret} />
      </SpacetimeDBProvider>
    </StrictMode>
  );
}

void start();
