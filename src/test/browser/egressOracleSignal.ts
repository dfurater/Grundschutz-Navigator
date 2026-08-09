export const BROWSER_EGRESS_ORACLE_HEADER = 'x-gspp-browser-egress-oracle';
export const BROWSER_EGRESS_ORACLE_VALUE = 'block';

export function isBrowserEgressOracleRequest(
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  return headers[BROWSER_EGRESS_ORACLE_HEADER] === BROWSER_EGRESS_ORACLE_VALUE;
}
