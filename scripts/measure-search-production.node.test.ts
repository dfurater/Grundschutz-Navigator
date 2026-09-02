// @vitest-environment node
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGroupAlive, stopPreview } from './measure-search-production.mjs';

/** Wartet, bis der Enkelprozess seinen SIGTERM-Handler registriert hat, oder wirft nach timeoutMs. */
async function waitForReadyFile(path: string, timeoutMs: number) {
  const start = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Enkelprozess hat READY_FILE nicht innerhalb von ${timeoutMs}ms geschrieben.`);
    }
    await delay(20);
  }
}

describe('stopPreview', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it(
    'eskaliert auf SIGKILL, wenn ein Enkelprozess in der Gruppe SIGTERM ignoriert, obwohl der Leader bereits beendet ist',
    async () => {
      // Reproduziert den Cross-Review-Befund (GSPP-218, Head cbd36ef): der npx-Leader
      // kann sich beenden, während ein von ihm gestarteter Enkelprozess in derselben
      // Prozessgruppe SIGTERM ignoriert und weiterläuft. Warten auf das exit-Event des
      // Leader-Handles allein übersieht das — deshalb prüft stopPreview die Gruppe direkt.
      //
      // Drittes Cross-Review (Codex): eine frühere Fassung ohne Readiness-Handshake war
      // race-anfällig — stopPreview konnte SIGTERM senden, bevor der Enkel seinen
      // SIGTERM-Handler überhaupt registriert hatte, wodurch der Test auch gegen die
      // alte, fehlerhafte Implementierung zufällig grün wurde (belegt: Testlaufzeit
      // 108ms bei termTimeoutMs=300ms, SIGKILL-Eskalation nie erreicht). Der Enkel
      // schreibt seine Bereitschaft jetzt erst NACH `process.on("SIGTERM", ...)` in eine
      // Datei; der Test wartet auf diese Datei, bevor er stopPreview aufruft, und prüft
      // zusätzlich, dass die Gruppe erst durch die SIGKILL-Eskalation verschwindet
      // (nicht durch das anfängliche SIGTERM).
      tmpDir = mkdtempSync(join(tmpdir(), 'gspp-218-stop-preview-'));
      const readyFile = join(tmpDir, 'ready');

      const child = spawn(
        'bash',
        [
          '-c',
          'node -e \'process.on("SIGTERM", () => {}); require("fs").writeFileSync(process.env.READY_FILE, "1"); setTimeout(() => {}, 5000);\' & exit 0',
        ],
        { detached: true, stdio: 'ignore', env: { ...process.env, READY_FILE: readyFile } },
      );

      await new Promise((resolvePromise) => child.once('exit', resolvePromise));
      await waitForReadyFile(readyFile, 5000);
      expect(isGroupAlive(child.pid!)).toBe(true);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const termTimeoutMs = 300;
      const start = Date.now();

      await stopPreview(child, { termTimeoutMs, killTimeoutMs: 2000 });
      const elapsedMs = Date.now() - start;

      // Beweist, dass die Gruppe nicht schon durch das anfängliche SIGTERM verschwunden
      // ist, sondern erst nach Ablauf des Terminierungsfensters durch SIGKILL — sonst
      // hätte der Enkel das SIGTERM entgegen seinem Handler doch verarbeitet (oder der
      // Handshake nicht gegriffen), und der Test würde die Eskalation gar nicht prüfen.
      expect(elapsedMs).toBeGreaterThanOrEqual(termTimeoutMs);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sende SIGKILL'));
      warnSpy.mockRestore();

      expect(isGroupAlive(child.pid!)).toBe(false);
    },
    10_000,
  );
});
