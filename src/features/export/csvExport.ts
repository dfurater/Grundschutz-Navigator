import type { Control } from '@/domain/models';
import { getControlLinkTargetsByRelation } from '@/domain/controlRelationships';
import { downloadBlob } from '@/adapters/browserDownload';

/**
 * Escape a field value for CSV output.
 * - Prefixes Excel/LibreOffice formula-looking values with an apostrophe
 * - Wraps in double quotes if value contains semicolons, quotes, or newlines
 * - Escapes internal double quotes by doubling them
 */
const FORMULA_PREFIX = /^[=+\-@\t\r\n]/u;

export function escapeCSVField(value: string): string {
  const safeValue = FORMULA_PREFIX.test(value) ? `'${value}` : value;

  if (
    safeValue.includes(';') ||
    safeValue.includes('"') ||
    safeValue.includes('\n') ||
    safeValue.includes('\r')
  ) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
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
  'taxonomy_l1',
  'taxonomy_l1_ns',
  'taxonomy_l2',
  'taxonomy_l2_ns',
  'taxonomy_l3',
  'taxonomy_l3_ns',
  'taxonomy_l4',
  'taxonomy_l4_ns',
  'target_object_categories',
  'result',
  'result_specification',
  'action_word',
  'documentation',
  'links',
  'required_links',
  'related_links',
  'confidentiality',
  'integrity',
  'availability',
  'authenticity',
  'threats',
  'control_alt_identifier',
];

const TAXONOMY_LEVELS = [
  'Taxonomy-L1',
  'Taxonomy-L2',
  'Taxonomy-L3',
  'Taxonomy-L4',
] as const;

function taxonomyCSVFields(control: Control): string[] {
  return TAXONOMY_LEVELS.flatMap((name) => {
    const props = control.taxonomy.filter((prop) => prop.name === name);
    return [
      props.map((prop) => prop.value).join(', '),
      props.map((prop) => prop.ns ?? '').join(', '),
    ];
  });
}

/**
 * Convert a single control to a CSV row (semicolon-delimited).
 */
export function controlToCSVRow(control: Control): string {
  const relationTargets = getControlLinkTargetsByRelation(control.links);
  const fields = [
    control.id,
    control.parentId ?? '',
    control.practiceId ?? '',
    control.groupId ?? '',
    control.title,
    control.statement,
    control.guidance,
    control.modalverb ?? '',
    control.securityLevel ?? '',
    control.effortLevel ?? '',
    control.tags.join(', '),
    ...taxonomyCSVFields(control),
    control.statementProps.zielobjektKategorien.join(', '),
    control.statementProps.ergebnis ?? '',
    control.statementProps.praezisierung ?? '',
    control.statementProps.handlungsworte ?? '',
    control.statementProps.dokumentation ?? '',
    control.links.map((l) => `${l.targetId} (${l.rel ?? 'ohne Relation'})`).join(', '),
    relationTargets.required.join(', '),
    relationTargets.related.join(', '),
    control.confidentiality ?? '',
    control.integrity ?? '',
    control.availability ?? '',
    control.authenticity ?? '',
    control.threats.join(', '),
    control.altIdentifier ?? '',
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
  return `${[headerRow, ...dataRows].join('\r\n')}\r\n`;
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
  downloadBlob(blob, filename);
}
