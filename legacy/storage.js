/**
 * Storage adapter.
 *
 * The app talks to `window.storage` with four async methods. In the Claude artifact
 * sandbox those are provided for you; here they're backed by localStorage so the
 * pharmacy's records survive a browser restart.
 *
 * When you move to a real server, this is the only file that changes — swap each
 * body for a fetch() call and the rest of the app carries on unchanged. There's a
 * worked example at the bottom.
 */

const PREFIX = "apotheca:";

function available() {
  try {
    const k = "__probe__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

// Fallback for private-browsing modes that block localStorage. Data lasts for
// the tab's lifetime only — the app still works, it just won't persist.
const memory = new Map();
const HAS_LS = available();

const read = (k) => (HAS_LS ? localStorage.getItem(PREFIX + k) : memory.get(PREFIX + k) ?? null);
const write = (k, v) => (HAS_LS ? localStorage.setItem(PREFIX + k, v) : memory.set(PREFIX + k, v));
const drop = (k) => (HAS_LS ? localStorage.removeItem(PREFIX + k) : memory.delete(PREFIX + k));
const allKeys = () => (HAS_LS ? Object.keys(localStorage) : [...memory.keys()]);

window.storage = {
  async get(key) {
    const value = read(key);
    return value === null ? null : { key, value, shared: false };
  },

  async set(key, value) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    write(key, str);
    return { key, value: str, shared: false };
  },

  async delete(key) {
    drop(key);
    return { key, deleted: true, shared: false };
  },

  async list(prefix = "") {
    const keys = allKeys()
      .filter((k) => k.startsWith(PREFIX + prefix))
      .map((k) => k.slice(PREFIX.length));
    return { keys, prefix, shared: false };
  },
};

if (!HAS_LS) {
  console.warn(
    "[apotheca] localStorage is blocked in this browser context. " +
      "Records will not survive a page reload."
  );
}

/* ---------------------------------------------------------------------------
   Moving to a server later? Replace the object above with this shape:

   const API = "http://localhost:3000";

   window.storage = {
     async get(key) {
       const r = await fetch(`${API}/store/${encodeURIComponent(key)}`, {
         credentials: "include",
       });
       return r.status === 404 ? null : r.json();
     },
     async set(key, value) {
       const r = await fetch(`${API}/store/${encodeURIComponent(key)}`, {
         method: "PUT",
         headers: { "Content-Type": "application/json" },
         credentials: "include",
         body: JSON.stringify({ value }),
       });
       return r.json();
     },
     ...
   };

   That gets you shared data across machines quickly, but it is a stopgap — a real
   deployment wants proper /batches and /bills endpoints with transactions, not a
   key-value store. See production-notes.md.
   --------------------------------------------------------------------------- */
