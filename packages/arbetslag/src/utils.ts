import type { Result } from "neverthrow";

/**
 * Unwrap a Result, throwing on failure. The framework only throws to crash
 * on configuration errors — runtime data-flow failures travel as Result
 * errors and surface at the app boundary.
 */
export function unwrap<T>(result: Result<T, string>): T {
  return result.match(
    (v) => v,
    (e) => {
      throw new Error(e);
    },
  );
}
