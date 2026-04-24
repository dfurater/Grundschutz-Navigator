import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SecurityLevelBadge } from './StatusMeta';

describe('StatusMeta', () => {
  it('keeps namespace and classification security level appearances distinct', () => {
    render(
      <>
        <SecurityLevelBadge value="normal-SdT" />
        <SecurityLevelBadge value="normal-SdT" appearance="namespace" />
      </>,
    );

    const [classificationBadge, namespaceBadge] = screen.getAllByText('normal-SdT');
    expect(classificationBadge).toHaveClass('bg-transparent');
    expect(namespaceBadge).toHaveClass('bg-status-sec-bg');
  });
});
