import { describe, expect, it } from 'vitest';
import { renderStartPage } from './startPagePrerender';

describe('renderStartPage', () => {
  it('rendert Shell und Einführung der Startseite ohne Titel und Skript', async () => {
    const html = await renderStartPage('/');
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelector('main h2')?.textContent).toBe('Was ist Grundschutz++?');
    expect(root.querySelector('main a[href="/about"]')).not.toBeNull();
    expect(root.querySelector('title, script')).toBeNull();
  });
});
