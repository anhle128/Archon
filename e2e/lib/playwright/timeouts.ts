/**
 * Reusable timeout budgets, scaled up on CI where machines are slower.
 * Mirrors the open-design e2e `T` constants.
 */
const scale = process.env.CI ? 2.0 : 1.0;

export const T = {
  short: Math.ceil(3_000 * scale), // 3s local / 6s CI
  medium: Math.ceil(10_000 * scale), // 10s local / 20s CI
  long: Math.ceil(30_000 * scale), // 30s local / 60s CI
  xlong: Math.ceil(60_000 * scale), // 60s local / 120s CI
};
