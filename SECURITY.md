# Sicherheitsrichtlinie

## Sicherheitslücke melden

Bitte melde Sicherheitslücken vertraulich über GitHubs private Meldefunktion: im Reiter [Security](https://github.com/dfurater/Grundschutz-Navigator/security) auf „Report a vulnerability“ klicken oder direkt ein [neues Advisory anlegen](https://github.com/dfurater/Grundschutz-Navigator/security/advisories/new). Die Meldung ist nur für dich und den Maintainer sichtbar.

Bitte melde Sicherheitslücken nicht als öffentliches Issue, Pull Request oder Diskussionsbeitrag, solange es keine Lösung gibt.

Hilfreich sind:

- eine kurze Beschreibung der Schwachstelle und ihrer Auswirkung,
- die betroffene Stelle (Datei, Workflow oder URL der Live-Seite),
- Schritte, mit denen sich das Problem nachvollziehen lässt.

## Unterstützte Version

Unterstützt wird nur der aktuelle Stand von `main`, also die Version, die unter [dfurater.github.io/Grundschutz-Navigator](https://dfurater.github.io/Grundschutz-Navigator/) ausgeliefert wird. Ältere Stände erhalten keine Korrekturen.

## Geltungsbereich

Gemeldet werden können Schwachstellen im Code der App, in den GitHub-Actions-Workflows und in der Lieferkette des Builds, zum Beispiel eine Umgehung der Integritätsprüfung der Katalogdaten oder der Content Security Policy.

Fachliche Fehler in den Inhalten der BSI-Kataloge gehören nicht hierher, sondern an das BSI über die [Stand-der-Technik-Bibliothek](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek). Welche Schutzmaßnahmen die App hat und wo ihre bekannten Grenzen liegen, beschreibt der Abschnitt [Sicherheit](README.md#sicherheit) in der README.
