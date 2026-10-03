import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from './module_bindings';
import { App } from './App';
import './styles.css';
import '@xyflow/react/dist/style.css';

const host = import.meta.env.VITE_SPACETIME_HOST ?? 'ws://127.0.0.1:3000';
const database = import.meta.env.VITE_SPACETIME_DB ?? 'tab-local';
const tokenKey = `tab:${host}/${database}:identity`;
const savedToken = localStorage.getItem(tokenKey);

let connectionBuilder = DbConnection.builder()
  .withUri(host)
  .withDatabaseName(database)
  .onConnect((_connection, _identity, token) => {
    if (token) localStorage.setItem(tokenKey, token);
  });
if (savedToken) connectionBuilder = connectionBuilder.withToken(savedToken);

const secret = decodeURIComponent(location.pathname.match(/^\/g\/([^/]+)/)?.[1] ?? '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App secret={secret} />
    </SpacetimeDBProvider>
  </StrictMode>
);
