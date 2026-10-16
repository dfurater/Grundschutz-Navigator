/** Kodiert Segmente einzeln; Slash-Normalisierung ist eine explizite Option. */
export function encodeRepositoryPath(path, { omitEmptySegments = false } = {}) {
  const segments = path.split('/');
  return (omitEmptySegments ? segments.filter(Boolean) : segments)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
