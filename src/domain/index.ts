/**
 * Public surface of the domain layer.
 *
 * This barrel is the contract a future React Native / Electron / server build
 * consumes. If something here starts needing `window`, it belongs in
 * `src/platform` instead.
 */

export * from "./types";
export * from "./roles";
export * from "./accounts";
export * from "./catalog";
export * from "./money";
export * from "./expiry";
export * from "./ids";
export * from "./inventory";
export * from "./billing";
export * from "./prescriptions";
export * from "./search";
export * from "./audit";
export * from "./seed";
export * from "./csv";
