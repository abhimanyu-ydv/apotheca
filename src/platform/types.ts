/**
 * Platform contracts.
 *
 * These four interfaces are the entire boundary between the app and the device
 * it runs on. Porting Apotheca to another platform means writing new
 * implementations of these — nothing above `src/platform` should need edits.
 *
 *   Web      → localStorage      + crypto.subtle   + Blob download
 *   iOS/RN   → AsyncStorage/MMKV + expo-crypto     + expo-sharing
 *   Android  → same as iOS
 *   Electron → fs / SQLite       + node:crypto     + dialog.showSaveDialog
 *   Server   → Postgres          + argon2          + HTTP response
 */

/** Async key/value store. Deliberately the narrowest useful interface. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<readonly string[]>;
  /** True when writes survive a restart. False means in-memory fallback. */
  readonly durable: boolean;
  /** Short human-readable name, shown in the admin screen. */
  readonly name: string;
}

/** Password hashing. Web uses SHA-256 + salt; a server must use Argon2/bcrypt. */
export interface CryptoAdapter {
  randomSalt(): string;
  hash(text: string, salt: string): Promise<string>;
  /** False when the platform can't hash (insecure origin) — surface this to the user. */
  readonly available: boolean;
  readonly algorithm: string;
}

/** Handing a generated file to the user. */
export interface FileAdapter {
  save(filename: string, contents: string, mime: string): Promise<void>;
  /** Prompt for a file and return its text. `null` if the user cancelled. */
  open(accept: string): Promise<string | null>;
  readonly canOpen: boolean;
}

/** Printing an invoice. */
export interface PrintAdapter {
  print(): void;
  readonly available: boolean;
}

export interface Platform {
  readonly store: KeyValueStore;
  readonly crypto: CryptoAdapter;
  readonly files: FileAdapter;
  readonly printer: PrintAdapter;
  /** Identifier for diagnostics: "web", "ios", "electron", … */
  readonly id: string;
}
