export const SETTLING_SECONDS = 14;
export function settlingGain(elapsed, seconds = SETTLING_SECONDS) {
  const t = Math.max(0, Math.min(1, elapsed / Math.max(.1, seconds)));
  return 1 - t * t * (3 - 2 * t);
}
