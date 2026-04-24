import type { Control } from '@/domain/models';
import { getControlLinkTargetsByRelation } from '@/domain/controlRelationships';

/**
 * Escape a field value for CSV output.
 * - Wraps in double quotes if value contains semicolons, quotes, or newlines
 * - Escapes internal double quotes by doubling them
 */
export function escapeCSVField(value: string): string {
  if (
    value.includes(';') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV header row.
 */
const CSV_HEADERS = [
  'ID',
  'parent_id',
  'Praktik',
  'Thema',
  'Titel',
  'statement',
  'guidance',
  'modal_verb',
  'sec_level',
  'effort_level',
  'tags',
  'target_object_categories',
  'result',
  'result_specification',
  'action_word',
  'documentation',
  'links',
  'required_links',
  'related_links',
];

/**
 * Convert a single control to a CSV row (semicolon-delimited).
 */
export function controlToCSVRow(control: Control): string {
  const relationTargets = getControlLinkTargetsByRelation(control.links);
  const fields = [
    control.id,
    control.parentId ?? '',
    control.practiceId,
    control.groupId,
    control.title,
    control.statement,
    control.guidance,
    control.modalverb ?? '',
    control.securityLevel ?? '',
    control.effortLevel ?? '',
    control.tags.join(', '),
    control.statementProps.zielobjektKategorien.join(', '),
    control.statementProps.ergebnis ?? '',
    control.statementProps.praezisierung ?? '',
    control.statementProps.handlungsworte ?? '',
    control.statementProps.dokumentation ?? '',
    control.links.map((l) => `${l.targetId} (${l.relation})`).join(', '),
    relationTargets.required.join(', '),
    relationTargets.related.join(', '),
  ];

  return fields.map(escapeCSVField).join(';');
}

/**
 * Convert an array of controls to a complete CSV string.
 * Uses semicolon delimiter (safe for German text containing commas).
 * Includes UTF-8 BOM for Excel compatibility.
 */
export function controlsToCSV(controls: Control[]): string {
  const headerRow = CSV_HEADERS.map(escapeCSVField).join(';');
  const dataRows = controls.map(controlToCSVRow);
  return [headerRow, ...dataRows].join('\n');
}

/** UTF-8 BOM for Excel auto-detection */
const UTF8_BOM = '\uFEFF';

/**
 * Trigger a CSV file download in the browser.
 *
 * @param controls - Controls to export
 * @param filename - Download filename (default: "grundschutz-katalog.csv")
 */
export function downloadCSV(
  controls: Control[],
  filename = 'grundschutz-katalog.csv',
): void {
  const csv = UTF8_BOM + controlsToCSV(controls);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
