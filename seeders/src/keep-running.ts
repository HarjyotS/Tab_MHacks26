// Restarts a script whenever it exits, waiting longer after each quick crash
// (the Nessie mirror exits on purpose when it loses SpacetimeDB).
//   tsx src/keep-running.ts src/nessie-worker.ts
import { spawn } from 'node:child_process';

const script = process.argv[2];
if (!script) throw new Error('Usage: tsx src/keep-running.ts <script>');
let stopping = false;
let delay = 1_000;

function start(): void {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [...process.execArgv, script], { stdio: 'inherit', env: process.env });
  const stop = () => { stopping = true; child.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.on('exit', code => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    if (stopping) return;
    // A run that lasted a minute was healthy: start over from a short wait.
    delay = Date.now() - startedAt > 60_000 ? 1_000 : Math.min(delay * 2, 60_000);
    console.error(`${new Date().toISOString()} ${script} exited (${code}); restarting in ${delay / 1000}s`);
    setTimeout(start, delay);
  });
}
start();
