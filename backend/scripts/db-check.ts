// Checks that the backend can reach SpacetimeDB and holds the backend role.
//   npm run db:check -w backend
// Kian's backend_* views return rows only to the backend role (and the
// owner), so counting visible rows tells us whether the grant is in place.
// Nothing is written. (Maincloud reports every reducer error as a generic
// "fatal error", so a reducer probe can't tell us this.)
import { connectBackend } from "../src/db/connection.js";
import { BACKEND_VIEWS, spacetimeStore } from "../src/store/spacetime.js";

const { conn, identity, token } = await connectBackend();
console.log(`connected as ${identity}`);
if (!process.env.BACKEND_SPACETIME_TOKEN) {
  console.log(
    `\nNo BACKEND_SPACETIME_TOKEN yet. Save this in backend/.env to keep this identity:\nBACKEND_SPACETIME_TOKEN=${token}`,
  );
}

try {
  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) =>
        reject(new Error(`subscription failed: ${String(ctx.event)}`)),
      )
      .subscribe(BACKEND_VIEWS);
  });
  const store = spacetimeStore(conn.db);
  const groups = store.groups().length;
  const messages = store.messages().length;
  console.log(
    `visible: ${groups} groups, ${messages} messages, ${store.expenses().length} expenses`,
  );
  if (groups === 0 && messages === 0) {
    console.log(
      `backend role: probably NOT granted (views are empty). The owner runs:\n  spacetime call ${process.env.SPACETIME_DB} grant_service_role ${identity} backend --server maincloud`,
    );
    process.exitCode = 1;
  } else {
    console.log("backend role: granted ✓");
  }
} finally {
  conn.disconnect();
}
