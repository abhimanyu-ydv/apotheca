import type { CryptoAdapter } from "../types";

/**
 * `crypto.subtle` only exists in a secure context — https:// or localhost.
 * Opening the app over plain http://192.168.x.x from another machine makes it
 * `undefined`, which used to throw an unexplained error on the login screen.
 * We now report `available: false` so the UI can say what's wrong.
 */
const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const webCrypto: CryptoAdapter = {
  available: Boolean(subtle),
  algorithm: "SHA-256 + per-user salt",

  randomSalt(): string {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return toHex(bytes);
  },

  async hash(text: string, salt: string): Promise<string> {
    if (!subtle) {
      throw new Error(
        "Password hashing needs a secure context. Open the app on http://localhost or over HTTPS.",
      );
    }
    const data = new TextEncoder().encode(`${salt}::${text}`);
    const digest = await subtle.digest("SHA-256", data);
    return toHex(new Uint8Array(digest));
  },
};
