import "dotenv/config";
import { DbConnection } from "../module_bindings/index.js";

export type BackendConnection = {
  conn: DbConnection;
  identity: string;
  token: string;
};

// Connects as the backend's own identity. The token in BACKEND_SPACETIME_TOKEN
// is that identity; the module owner grants it the `backend` role once.
export function connectBackend(): Promise<BackendConnection> {
  // `||`, not `??`: an empty value in .env means "use the default".
  const uri = process.env.SPACETIME_HOST || "http://127.0.0.1:3000";
  const database = process.env.SPACETIME_DB || "tab-local";
  const token = process.env.BACKEND_SPACETIME_TOKEN || undefined;
  if (!URL.canParse(uri)) {
    return Promise.reject(
      new Error(`SPACETIME_HOST is not a valid URL: ${uri}`),
    );
  }

  return new Promise((resolve, reject) => {
    let builder = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((conn, identity, newToken) =>
        resolve({ conn, identity: identity.toHexString(), token: newToken }),
      )
      .onConnectError((_ctx, error) =>
        reject(
          new Error(
            `SpacetimeDB connect to ${uri}/${database} failed: ${error.message}`,
            { cause: error },
          ),
        ),
      );
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}
