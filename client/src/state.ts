import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Everything the bridge must remember across restarts. */
export interface StateData {
  /** Highest chat.db ROWID fully handled. Null until the first run picks a starting point. */
  cursor: number | null;
  /** Group chat guids Tab is active in. */
  enabledGroups: string[];
  /** Last participant list seen per enabled group, used to detect joins and leaves. */
  rosters: Record<string, string[]>;
  /** When the bridge last DMed each member (ms since epoch), for the DM reply window. */
  lastBridgeDmAt: Record<string, number>;
}

const EMPTY: StateData = { cursor: null, enabledGroups: [], rosters: {}, lastBridgeDmAt: {} };

export class State {
  data: StateData;

  constructor(private readonly path: string | null) {
    this.data = structuredClone(EMPTY);
    if (!path) return;
    try {
      this.data = { ...this.data, ...JSON.parse(readFileSync(path, "utf8")) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }
}
