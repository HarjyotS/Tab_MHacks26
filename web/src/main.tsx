import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings';
import { App } from './App';
import './styles.css';
import '@xyflow/react/dist/style.css';

const host = import.meta.env.VITE_SPACETIME_HOST ?? 'wss://maincloud.spacetimedb.com';
const database = import.meta.env.VITE_SPACETIME_DB ?? 'tabmhacks2026-268xk';
const tokenKey = `tab:${host}/${database}:identity`;
const savedToken = localStorage.getItem(tokenKey);

let connectionBuilder = DbConnection.builder()
  .withUri(host)
  .withDatabaseName(database)
  .onConnect((_connection, _identity, token) => {
    if (token) localStorage.setItem(tokenKey, token);
  });
if (savedToken) connectionBuilder = connectionBuilder.withToken(savedToken);

// Strip the deploy base (e.g. /Tab_MHacks26/ on GitHub Pages) before matching /g/<secret>.
const path = location.pathname.slice(import.meta.env.BASE_URL.length - 1);
const secret = decodeURIComponent(path.match(/^\/g\/([^/]+)/)?.[1] ?? '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App secret={secret} />
    </SpacetimeDBProvider>
  </StrictMode>
);
