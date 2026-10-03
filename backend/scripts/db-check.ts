// Checks that the backend can reach SpacetimeDB and holds the backend role.
//   npm run db:check
// Calls set_group_status on a group that doesn't exist: "Unknown group" means
// the role is granted, and nothing is written either way.
import { connectBackend } from "../src/db/connection.js";
import { createReducers, ReducerError } from "../src/db/reducers.js";

const { conn, identity, token } = await connectBackend();
console.log(`connected as ${identity}`);
if (!process.env.BACKEND_SPACETIME_TOKEN) {
  console.log(
    `\nNo BACKEND_SPACETIME_TOKEN yet. Save this in backend/.env to keep this identity:\nBACKEND_SPACETIME_TOKEN=${token}`,
  );
}

const db = createReducers(conn.reducers);
try {
  await db.set_group_status({ group_id: "__db_check__", status: "active" });
  console.error("unexpected: the probe group exists");
  process.exitCode = 1;
} catch (err) {
  if (!(err instanceof ReducerError)) throw err;
  if (err.message.includes("Unknown group")) {
    console.log("backend role: granted ✓");
  } else if (err.message.includes("Requires service role")) {
    console.log(
      `backend role: NOT granted. The module owner must run grant_service_role for ${identity} with role "backend".`,
    );
    process.exitCode = 1;
  } else {
    console.error(err.message);
    process.exitCode = 1;
  }
} finally {
  conn.disconnect();
}
