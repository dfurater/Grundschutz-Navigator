import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const EMPTY_ROOT = '<div id="root"></div>';

/**
 * Rendert die Startseite serverseitig aus `src/features/home/startPagePrerender.tsx`. Ein
 * Vite-Server im Middleware-Modus lädt das Modul mit derselben Konfiguration,
 * demselben Projektalias und demselben Modus wie der Build.
 */
export async function renderStartPageMarkup(projectRoot: string, deploymentBase: string): Promise<string> {
  const server = await createServer({
    root: projectRoot,
    configFile: resolve(projectRoot, 'vite.config.ts'),
    mode: 'production',
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  try {
    const { renderStartPage } = await server.ssrLoadModule('/src/features/home/startPagePrerender.tsx') as {
      renderStartPage: (basename: string) => Promise<string>;
    };
    // Wie `src/main.tsx`: Die Router-Basis ist die Deployment-Basis ohne abschließenden Slash.
    return await renderStartPage(deploymentBase === '/' ? '/' : deploymentBase.replace(/\/$/, ''));
  } finally {
    await server.close();
  }
}

/** Setzt das vorgerenderte Markup in den leeren App-Root einer HTML-Datei ein. */
export function injectStartPageMarkup(html: string, markup: string): string {
  if (html.split(EMPTY_ROOT).length !== 2) throw new Error('Expected exactly one empty #root');
  if (markup.trim() === '') throw new Error('Prerendered start page is empty');
  if (/<script\b/i.test(markup)) throw new Error('Prerendered start page must not contain scripts');
  return html.replace(EMPTY_ROOT, () => `<div id="root">${markup}</div>`);
}

export function writeStartPageMarkup(outDir: string, markup: string): void {
  const indexHtmlPath = resolve(outDir, 'index.html');
  writeFileSync(indexHtmlPath, injectStartPageMarkup(readFileSync(indexHtmlPath, 'utf8'), markup), 'utf8');
}
