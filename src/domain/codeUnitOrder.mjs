/** Locale-unabhängige UTF-16-Code-Unit-Ordnung. */
export function compareStringsByCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
