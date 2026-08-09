import { describe, expect, it } from 'vitest';
import {
  BROWSER_EGRESS_ORACLE_HEADER,
  BROWSER_EGRESS_ORACLE_VALUE,
  isBrowserEgressOracleRequest,
} from './egressOracleSignal';

const rejectedHeaderCases: ReadonlyArray<{
  description: string;
  headers: Record<string, string | undefined>;
}> = [
  { description: 'fehlendem Header', headers: {} },
  {
    description: 'abweichendem Headerwert',
    headers: { [BROWSER_EGRESS_ORACLE_HEADER]: 'allow' },
  },
];

describe('isBrowserEgressOracleRequest', () => {
  it('erkennt ausschließlich den expliziten Canary-Header', () => {
    expect(
      isBrowserEgressOracleRequest({
        [BROWSER_EGRESS_ORACLE_HEADER]: BROWSER_EGRESS_ORACLE_VALUE,
      }),
    ).toBe(true);
  });

  it.each(rejectedHeaderCases)('ist bei $description fail-closed', ({ headers }) => {
    expect(isBrowserEgressOracleRequest(headers)).toBe(false);
  });
});
