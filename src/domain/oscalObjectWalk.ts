// =============================================================================
// Gemeinsamer Containerdurchlauf der Klasse-2-Herkunftskette
//
// Registrierung (oscalImportProcessing.ts) und Herkunftsprüfung
// (oscalObjectPipeline.ts) müssen denselben Baum in derselben Weise laufen,
// sonst kann ein Container registriert, aber nie geprüft werden — oder
// umgekehrt. Dieser Helper ist die einzige Kopie des Durchlaufs: iterativ mit
// explizitem Stack (tiefe Dokumente dürfen keinen Stapelüberlauf auslösen),
// Visited-Menge über den ganzen Lauf (nachträglich verkettable registrierte
// Container terminieren kontrolliert) und ausschließlich über Property-
// Deskriptoren (Accessor-Getter werden niemals ausgeführt).
//
// Das Blattmodul importiert nichts; beide Konsumenten hängen sich hieran,
// ohne Zyklen zu erzeugen.
// =============================================================================

/**
 * Läuft jeden Container unterhalb `root` genau einmal durch. Der Besucher
 * kehrt mit `false` zurück, um den Lauf sofort zu beenden (früher Abbruch
 * bei fehlendem Beleg); alles andere setzt den Lauf fort.
 */
export function walkOwnContainers(
  root: unknown,
  visit: (container: object) => boolean,
): void {
  if (root === null || typeof root !== 'object') return;

  const visited = new Set<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;

    const container = value as object;
    if (visited.has(container)) continue;
    visited.add(container);

    if (!visit(container)) return;

    for (const key of Reflect.ownKeys(container) as string[]) {
      // Der Deskriptorzugriff liest den Wert nicht aus und kann daher keinen
      // Accessor ausführen; nur Data-Properties werden hinabgestiegen.
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (descriptor !== undefined && 'value' in descriptor) {
        pending.push(descriptor.value);
      }
    }
  }
}
