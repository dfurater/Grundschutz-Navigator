export const NEGATIVE_EGRESS_CASES = [
  {
    id: 'fetch',
    testName: 'meldet einen nicht abgewarteten fetch als Browser-Egress',
    expectedMethod: 'GET',
  },
  {
    id: 'sendBeacon',
    testName: 'meldet einen nicht abgewarteten sendBeacon als Browser-Egress',
    expectedMethod: 'POST',
  },
];

export const NEGATIVE_EGRESS_TEST_NAME = NEGATIVE_EGRESS_CASES[0].testName;
