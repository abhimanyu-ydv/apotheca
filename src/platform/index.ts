/**
 * Platform selection.
 *
 * Today there is exactly one implementation. When you add a second, this file
 * is where the branch goes — either a build-time alias in the bundler config
 * (`platform/index.native.ts`, resolved by Metro for React Native) or a runtime
 * check. Everything above this layer imports `platform` and stays unchanged.
 */

import type { Platform } from "./types";
import { webStore } from "./web/store";
import { webCrypto } from "./web/crypto";
import { webFiles, webPrinter } from "./web/files";

export const platform: Platform = {
  id: "web",
  store: webStore,
  crypto: webCrypto,
  files: webFiles,
  printer: webPrinter,
};

export type {
  CryptoAdapter,
  FileAdapter,
  KeyValueStore,
  Platform,
  PrintAdapter,
} from "./types";
