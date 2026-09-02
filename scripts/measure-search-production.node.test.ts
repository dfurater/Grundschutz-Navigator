// @vitest-environment node
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isGroupAlive, stopPreview } from './measure-search-production.mjs';

describe('stopPreview', () => {
  it(
    'beendet auch einen Enkelprozess, der SIGTERM ignoriert, nachdem der Leader bereits beendet ist',
    async () => {
      // Reproduziert den Cross-Review-Befund (GSPP-218, Head cbd36ef): der npx-Leader
      // kann sich beenden, während ein von ihm gestarteter Enkelprozess in derselben
      // Prozessgruppe SIGTERM ignoriert und weiterläuft. Warten auf das exit-Event des
      // Leader-Handles allein übersieht das — deshalb prüft stopPreview die Gruppe direkt.
      const child = spawn(
        'bash',
        ['-c', 'node -e \'process.on("SIGTERM", () => {}); setTimeout(() => {}, 5000);\' & exit 0'],
        { detached: true, stdio: 'ignore' },
      );

      await new Promise((resolvePromise) => child.once('exit', resolvePromise));
      expect(isGroupAlive(child.pid!)).toBe(true);

      await stopPreview(child, { termTimeoutMs: 300, killTimeoutMs: 2000 });

      expect(isGroupAlive(child.pid!)).toBe(false);
    },
    10_000,
  );
});
