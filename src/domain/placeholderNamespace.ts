/**
 * Erkennt einen Platzhalter-Namensraum einer OSCAL-Prop.
 *
 * Das BSI kennzeichnet die WLAN-Taxonomie (`Taxonomy-L1` bis `-L4`) derzeit mit
 * `https://bsi.bund.de/ns/sdt/custom-properties/placeholder`: Die Adresse
 * trägt keine Information, sondern hält die Stelle frei. Die Oberfläche blendet
 * sie deshalb aus (Owner 26.09.2026). Maßgeblich ist allein der letzte
 * Pfadteil `placeholder`, nicht die vollständige Adresse: Tauscht das BSI den
 * Platzhalter gegen einen echten Namensraum aus, erscheint dieser ohne
 * Codeänderung wieder. Eine nicht als URL lesbare Angabe gilt nicht als
 * Platzhalter und bleibt sichtbar.
 */
export function isPlaceholderNamespace(ns: string | undefined): boolean {
  if (!ns) return false;
  let url: URL;
  try {
    url = new URL(ns);
  } catch {
    return false;
  }
  const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
  return lastSegment?.toLowerCase() === 'placeholder';
}
