import type { State } from "./state.ts";

/**
 * Tab runs on a personal iMessage account, so chat.db holds every one of the
 * owner's conversations. The gate decides what Tab may see and where it may
 * speak:
 *
 * - Group chats: only ones switched on with "/tab on" (or TAB_GROUP_IDS).
 * - DMs: only from members of an enabled group, and only when the bridge DMed
 *   them within the reply window or the message starts with "tab"/"@tab".
 *   READ_DMS=off turns DM reading off entirely (sending DMs still works).
 */
export class Gate {
  constructor(
    private readonly state: State,
    private readonly dmReplyWindowMs: number,
    /** When false, no DM is ever read; Tab only sees enabled groups. */
    private readonly readDms = true,
  ) {}

  groupEnabled(chatGuid: string): boolean {
    return this.state.data.enabledGroups.includes(chatGuid);
  }

  enabledGroups(): string[] {
    return [...this.state.data.enabledGroups];
  }

  /** Returns false if the group was already enabled. */
  enable(chatGuid: string): boolean {
    if (this.groupEnabled(chatGuid)) return false;
    this.state.data.enabledGroups.push(chatGuid);
    this.state.save();
    return true;
  }

  /** Returns false if the group wasn't enabled. */
  disable(chatGuid: string): boolean {
    if (!this.groupEnabled(chatGuid)) return false;
    this.state.data.enabledGroups = this.state.data.enabledGroups.filter((g) => g !== chatGuid);
    delete this.state.data.rosters[chatGuid];
    this.state.save();
    return true;
  }

  roster(chatGuid: string): string[] {
    return this.state.data.rosters[chatGuid] ?? [];
  }

  setRoster(chatGuid: string, handles: string[]): void {
    this.state.data.rosters[chatGuid] = handles;
    this.state.save();
  }

  isMember(handle: string): boolean {
    return this.enabledGroups().some((g) => this.roster(g).includes(handle));
  }

  noteBridgeDm(handle: string, at: number): void {
    this.state.data.lastBridgeDmAt[handle] = at;
    this.state.save();
  }

  /** False when READ_DMS is off: then no DM is decoded at all. */
  readsDms(): boolean {
    return this.readDms;
  }

  allowDm(handle: string, text: string, now: number): boolean {
    if (!this.readDms) return false;
    if (!this.isMember(handle)) return false;
    const last = this.state.data.lastBridgeDmAt[handle];
    if (last != null && now - last <= this.dmReplyWindowMs) return true;
    return /^\s*@?tab\b/i.test(text);
  }
}

export type GroupCommand = "on" | "off";

/** "/tab on" and "/tab off", typed from Tab's own phone into a group. */
export function parseCommand(text: string, prefix: string): GroupCommand | null {
  const match = text.trim().toLowerCase().match(/^(\S+)\s+(on|off)$/);
  return match && match[1] === prefix.toLowerCase() ? (match[2] as GroupCommand) : null;
}
