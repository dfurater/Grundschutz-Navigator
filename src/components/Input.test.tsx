import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Input } from '@/components/Input';
import { IconSearch } from '@/components/icons';

test('macht eine beschriftete Suche erreichbar und leitet Texteingaben an den Aufrufer weiter', async () => {
  const user = userEvent.setup();
  const values: string[] = [];
  render(<Input
    id="query"
    label="Suchbegriff"
    icon={IconSearch}
    type="search"
    onChange={(event) => values.push(event.target.value)}
  />);

  const input = screen.getByRole('searchbox', { name: 'Suchbegriff' });
  await user.click(screen.getByText('Suchbegriff'));
  expect(input).toHaveFocus();
  await user.type(input, 'Test');
  expect(input).toHaveValue('Test');
  expect(values.at(-1)).toBe('Test');
});

test('respektiert bei einem direkt benannten Feld die native Eingabesperre', async () => {
  const user = userEvent.setup();
  render(<Input aria-label="Gesperrte Eingabe" disabled defaultValue="Unverändert" />);

  const input = screen.getByRole('textbox', { name: 'Gesperrte Eingabe' });
  expect(input).toBeDisabled();
  await user.type(input, 'Zusatz');
  expect(input).toHaveValue('Unverändert');
});
