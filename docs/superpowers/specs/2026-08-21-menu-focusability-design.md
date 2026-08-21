# Focusability der Header- und Exportmenüs

## Ziel

Die beiden vorhandenen ARIA-Menücontainer sind programmatisch fokussierbar, ohne den bestehenden Fokusfluss oder die sichtbare Oberfläche zu verändern.

## Umfang

- `src/components/CatalogSwitcher.tsx` erhält am geöffneten `role="menu"`-Container `tabIndex={-1}`.
- `src/features/catalog/CatalogExportMenu.tsx` erhält dieselbe Ergänzung.
- Die bestehenden Tests prüfen für beide Menüs den Attributwert `tabindex="-1"` sowie weiterhin den Fokus auf dem ersten Menüeintrag und das Schließen per Escape und Außenklick.

## Nicht im Umfang

- Kein Roving-Tabindex, keine Pfeiltasten-Navigation und kein Umbau auf eine andere Menüstruktur.
- Keine Änderung an Text, Design-Tokens, Navigation, Exportlogik oder Datenverarbeitung.
- Keine Linear-Änderung.

## Architektur und Verhalten

Die Menüs bleiben zusammengesetzte ARIA-Widgets. Beim Öffnen fokussiert der existierende Effekt weiterhin den ersten `menuitem`; `tabIndex={-1}` macht ausschließlich den Container selbst programmatisch fokussierbar. Dadurch bleibt die aktuelle Tastaturbedienung erhalten und die durch SonarQube Cloud beanstandete fehlende Fokusfähigkeit wird behoben.

## Sicherheit und Datenschutz

Die Änderung verarbeitet keine Daten und erweitert keine Berechtigungen oder Netzwerkzugriffe. Sie ist auf ARIA-Metadaten der lokalen Benutzeroberfläche begrenzt.

## Validierung

Der Durchlauf beginnt mit je einem fehlschlagenden Komponenten-Test, führt danach die beiden Testdateien, den Linter, den vollständigen Testlauf und den Produktions-Build aus. Vor dem Pull Request werden Diff und SonarQube-PR-Analyse geprüft.
