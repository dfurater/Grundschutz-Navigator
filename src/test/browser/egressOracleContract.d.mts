export type NegativeEgressCase = {
  id: 'fetch' | 'sendBeacon';
  testName: string;
  expectedMethod: 'GET' | 'POST';
};

export declare const NEGATIVE_EGRESS_CASES: readonly NegativeEgressCase[];
export declare const NEGATIVE_EGRESS_TEST_NAME: string;
