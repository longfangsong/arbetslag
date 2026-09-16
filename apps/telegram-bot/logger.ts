// Thin wrappers around console.* — the app's single place to route logs.
export const log = (...args: unknown[]): void => console.log(...args);
export const warn = (...args: unknown[]): void => console.warn(...args);
export const error = (...args: unknown[]): void => console.error(...args);
