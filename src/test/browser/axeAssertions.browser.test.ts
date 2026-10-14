import { afterEach, expect, test } from 'vitest';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';

let fixture: HTMLElement | undefined;

afterEach(() => {
  fixture?.remove();
  fixture = undefined;
});

test('ein echter Axe-Verstoß lehnt mit Zustand, Regel und betroffenem Element ab', async () => {
  fixture = document.createElement('main');
  const button = document.createElement('button');
  button.id = 'axe-unnamed-button';
  fixture.append(button);
  document.body.append(fixture);

  await expect(assertNoAxeViolations(fixture, 'Fehlerfixture')).rejects.toThrow(
    /Fehlerfixture[\s\S]*button-name[\s\S]*#axe-unnamed-button/,
  );
});
