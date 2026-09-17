import type { KeyValueStore } from "../types";

const PREFIX = "apotheca:";

function localStorageWorks(): boolean {
  try {
    const probe = `${PREFIX}__probe__`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Private-browsing fallback. Works for the tab's lifetime only. */
function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    name: "In-memory (not saved)",
    durable: false,
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async keys(prefix = "") {
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

function browserStore(): KeyValueStore {
  return {
    name: "Browser localStorage",
    durable: true,
    async get(key) {
      return localStorage.getItem(PREFIX + key);
    },
    async set(key, value) {
      try {
        localStorage.setItem(PREFIX + key, value);
      } catch (err) {
        // QuotaExceededError is the realistic failure here — a long audit log or
        // years of bills. Surface it rather than silently dropping the write.
        throw new Error(
          `Could not save data — browser storage is full. Export a backup and clear old records. (${String(err)})`,
        );
      }
    },
    async delete(key) {
      localStorage.removeItem(PREFIX + key);
    },
    async keys(prefix = "") {
      const head = PREFIX + prefix;
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k?.startsWith(head)) out.push(k.slice(PREFIX.length));
      }
      return out;
    },
  };
}

export const webStore: KeyValueStore = localStorageWorks()
  ? browserStore()
  : memoryStore();
