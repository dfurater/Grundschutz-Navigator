#!/usr/bin/env node

/*
 * Entscheidet, ob die SonarQube-Analyse in diesem Lauf ausgeführt werden kann.
 *
 * Läuft bewusst vor jedem teuren Schritt: Ohne diesen Guard liefe erst der
 * gesamte Testlauf, bevor der Scanner mit einem Authentifizierungsfehler
 * abbricht.
 *
 * Zwei Fälle ohne Token, die auseinandergehalten werden müssen. Bei Beiträgen
 * aus einem Fork stellt GitHub Repository-Secrets grundsätzlich nicht bereit —
 * das ist kein Konfigurationsfehler, und ein harter Fehlschlag würde jeden
 * externen Beitrag blockieren. Die Analyse wird dort sichtbar übersprungen und
 * holt den Stand nach dem Merge auf `develop` nach. Fehlt das Token dagegen im
 * eigenen Repository, ist die Konfiguration defekt und der Lauf schlägt fehl;
 * bei Dependabot-Läufen ist die Ursache in aller Regel ein fehlendes
 * Dependabot-Secret.
 *
 * Der Guard liegt als Skript statt als Shell-Block im Workflow, weil ihn seit
 * GSPP-416 zwei Workflows brauchen: `sonar.yml` für den Push-Pfad auf `main`
 * und `develop`, `validate.yml` für den Pull-Request-Pfad. Eine zweite Kopie
 * der Fallunterscheidung wäre die Stelle, an der die beiden Pfade auseinander
 * laufen.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MISSING_TOKEN_MESSAGE =
  'Secret SONAR_CI ist in diesem Lauf nicht verfuegbar. Bei Dependabot-Laeufen muss das Token zusaetzlich unter Settings > Secrets and variables > Dependabot hinterlegt sein.';

export const FORK_SKIP_MESSAGE =
  'Fork-Beitrag: GitHub stellt Repository-Secrets hier nicht bereit. Die SonarQube-Analyse wird uebersprungen; der Stand wird nach dem Merge auf develop gemessen.';

export class SonarTokenGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SonarTokenGuardError';
  }
}

/**
 * @param {{ sonarToken?: string, isFork?: string }} input
 * @returns {{ available: boolean, notice?: string }}
 */
export function resolveAnalysisAvailability({ sonarToken, isFork }) {
  if (sonarToken) {
    return { available: true };
  }

  // Nur die ausdrückliche Zeichenkette `true` gilt als Fork-Lauf. Jeder andere
  // Wert — auch ein leerer oder fehlender — führt in den harten Fehlschlag.
  if (isFork === 'true') {
    return { available: false, notice: FORK_SKIP_MESSAGE };
  }

  throw new SonarTokenGuardError(MISSING_TOKEN_MESSAGE);
}

function main() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new SonarTokenGuardError(
      'GITHUB_OUTPUT ist nicht gesetzt; der Guard kann sein Ergebnis nicht weitergeben.',
    );
  }

  const result = resolveAnalysisAvailability({
    sonarToken: process.env.SONAR_TOKEN,
    isFork: process.env.IS_FORK,
  });

  appendFileSync(outputPath, `available=${result.available}\n`, 'utf8');
  if (result.notice) {
    console.log(`::notice::${result.notice}`);
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : MISSING_TOKEN_MESSAGE}`);
    process.exitCode = 1;
  }
}
