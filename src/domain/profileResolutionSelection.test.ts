import { describe, expect, it } from 'vitest';
import { parseClass2OscalInput } from './oscalImportProcessing';
import {
  indexCatalogControls,
  PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES,
  resolveSelectionIds,
  type ImportSelectionRequest,
} from './profileResolutionSelection';

function control(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, class: 'SP800-53', title: id.toUpperCase(), ...extra };
}

function group(
  id: string,
  members: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, class: 'family', title: id.toUpperCase(), ...extra, ...splitMembers(members) };
}

function splitMembers(members: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const subgroups = members.filter((m) => m['class'] === 'family');
  const plainControls = members.filter((m) => m['class'] !== 'family');
  if (plainControls.length > 0) result['controls'] = plainControls;
  if (subgroups.length > 0) result['groups'] = subgroups;
  return result;
}

function catalog(body: Record<string, unknown>): Record<string, unknown> {
  return { catalog: body };
}

const baseCatalog = catalog({
  metadata: { 'oscal-version': '1.1.3' },
  groups: [
    group('ac', [
      control('ac-1'),
      control('ac-2', {
        controls: [control('ac-2.1'), control('ac-2.2')],
      }),
    ]),
    group('bc', [
      group('bc-sub', [control('bc-1.1')]),
      control('bc-1'),
    ]),
  ],
  controls: [control('zz-9')],
});

function idsOf(
  index: ReturnType<typeof indexCatalogControls>,
  request: ImportSelectionRequest,
): string[] {
  const result = resolveSelectionIds(index, request);
  if (!result.ok) throw new Error(`unerwartete Ablehnung: ${result.diagnostic.code}`);
  return [...result.ids].sort();
}

describe('Selektion Phase 1 — Inklusion', () => {
  it('include-all wählt jede Control inklusive verschachtelter, in Originalordnung', () => {
    const index = indexCatalogControls(baseCatalog);
    const result = resolveSelectionIds(
      index,
      { selection: { kind: 'include-all' }, excludeControls: [] },
    );
    if (!result.ok) throw new Error(`unerwartete Ablehnung: ${result.diagnostic.code}`);

    expect([...result.ids]).toEqual([
      'ac-1',
      'ac-2',
      'ac-2.1',
      'ac-2.2',
      'bc-1',
      'bc-1.1',
      'zz-9',
    ]);
  });

  it('with-ids trifft genau die genannten Controls', () => {
    const index = indexCatalogControls(baseCatalog);
    expect(
      idsOf(index, {
        selection: {
          kind: 'include-controls',
          includeControls: [{ withIds: ['ac-1', 'bc-1'], matching: [], path: '/imports/0' }],
        },
        excludeControls: [],
      }),
    ).toEqual(['ac-1', 'bc-1']);
  });

  it('with-child-controls yes zieht alle Nachfahren, no nur den Selbsttreffer', () => {
    const index = indexCatalogControls(baseCatalog);
    const request = (yes: string): ImportSelectionRequest => ({
      selection: {
        kind: 'include-controls',
        includeControls: [{ withIds: ['ac-2'], matching: [], withChildControls: yes, path: '/imports/0' }],
      },
      excludeControls: [],
    });

    expect(idsOf(index, request('yes'))).toEqual(['ac-2', 'ac-2.1', 'ac-2.2']);
    expect(idsOf(index, request('no'))).toEqual(['ac-2']);
  });

  it('ohne with-child-controls gilt no — und Vorfahren werden NICHT automatisch mitgezogen', () => {
    // Orakelbefund BSI-Korpus (GSPP-291): Gezogene Ahnen würden als leere
    // Schalen materialisieren; die Auflösung zieht sie deshalb bewusst
    // nicht nach.
    const index = indexCatalogControls(baseCatalog);
    expect(
      idsOf(index, {
        selection: {
          kind: 'include-controls',
          includeControls: [{ withIds: ['ac-2.1'], matching: [], path: '/imports/0' }],
        },
        excludeControls: [],
      }),
    ).toEqual(['ac-2.1']);
  });

  it('matching wertet Glob-Muster gegen die Control-ID aus', () => {
    const index = indexCatalogControls(baseCatalog);
    expect(
      idsOf(index, {
        selection: {
          kind: 'include-controls',
          includeControls: [{ withIds: [], matching: [{ pattern: 'ac-*' }], path: '/imports/0' }],
        },
        excludeControls: [],
      }),
    ).toEqual(['ac-1', 'ac-2', 'ac-2.1', 'ac-2.2']);
  });

  it('ein leeres Matching-Muster trifft nichts', () => {
    const index = indexCatalogControls(baseCatalog);
    expect(
      idsOf(index, {
        selection: {
          kind: 'include-controls',
          includeControls: [{ withIds: [], matching: [{}], path: '/imports/0' }],
        },
        excludeControls: [],
      }),
    ).toEqual([]);
  });
});

describe('Selektion Phase 1 — Exclusion und Kumulation', () => {
  it('Ausschluss gewinnt unabhängig von der Inklusionsspezifität', () => {
    const index = indexCatalogControls(baseCatalog);
    const result = resolveSelectionIds(index, {
      selection: {
        kind: 'include-controls',
        includeControls: [
          { withIds: ['ac-1', 'ac-2'], matching: [], path: '/imports/0' },
        ],
      },
      excludeControls: [{ withIds: [], matching: [{ pattern: 'ac-*' }], path: '/x' }],
    });
    if (!result.ok) throw new Error(`unerwartete Ablehnung: ${result.diagnostic.code}`);

    expect([...result.ids]).toEqual([]);
  });

  it('mehrere Inklusionen sind kumulativ, Duplikate bleiben einmalig', () => {
    const index = indexCatalogControls(baseCatalog);
    const selection = {
      kind: 'include-controls' as const,
      includeControls: [
        { withIds: ['ac-1'], matching: [], path: '/imports/0' },
        { withIds: ['ac-1', 'ac-2'], matching: [], path: '/imports/0' },
      ],
      path: '/imports/0',
    };

    expect(idsOf(index, { selection, excludeControls: [] })).toEqual(['ac-1', 'ac-2']);
  });

  it('mit-child-controls yes im Ausschluss entfernt den ganzen Zweig', () => {
    const index = indexCatalogControls(baseCatalog);
    const result = resolveSelectionIds(index, {
      selection: { kind: 'include-all' },
      excludeControls: [
        { withIds: ['ac-2'], matching: [], withChildControls: 'yes', path: '/x' },
      ],
    });
    if (!result.ok) throw new Error(`unerwartete Ablehnung: ${result.diagnostic.code}`);

    expect(result.ids).toContain('ac-1');
    expect(result.ids).not.toContain('ac-2');
    expect(result.ids).not.toContain('ac-2.1');
  });
});

describe('Selektion Phase 1 — Fail-closed', () => {
  it('indexiert ohne Dokument-Accessoren auszuführen — werfender Root-Getter bleibt strukturell', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'catalog', {
      get() {
        throw new Error('Getter wurde ausgeführt');
      },
      enumerable: true,
      configurable: true,
    });

    expect(() => indexCatalogControls(hostile)).not.toThrow();
    const index = indexCatalogControls(hostile);
    expect(index.order).toEqual([]);
  });

  it('behandelt Array-Geschwister am Root nicht als Body — die Body-Erkennung bleibt präzise', () => {
    const malformed = {
      catalog: { controls: [control('ac-1')] },
      sibling: [control('zz-0')],
    };

    const index = indexCatalogControls(malformed);

    // Arrays zählen nicht als Body-Kandidaten: Das einzige Objekt-Body
    // (`catalog`) wird eindeutig erkannt und indexiert, statt in einen
    // stillen Leerlauf zu fallen.
    expect(index.order).toEqual(['ac-1']);
  });

  it('indexiert eine 12.000 Ebenen tiefe Gruppenhierarchie ohne Stapelüberlauf', () => {
    // Greptile-Befund zu 0034765: Die rekursive Gruppentraversierung warf bei
    // tiefen Hierarchien einen RangeError; der Index trägt sie iterativ.
    let wrapped: Record<string, unknown> = {
      id: 'lvl-0',
      class: 'family',
      title: '',
      controls: [control('deep-leaf')],
    };
    for (let level = 1; level < 12_000; level += 1) {
      wrapped = {
        id: `lvl-${level}`,
        class: 'family',
        title: '',
        groups: [wrapped],
      };
    }
    const deepCatalog = catalog({ metadata: {}, groups: [wrapped] });

    expect(() => indexCatalogControls(deepCatalog)).not.toThrow();
    const index = indexCatalogControls(deepCatalog);
    expect(index.byId.has('deep-leaf')).toBe(true);
  });

  it('führt keine Accessoren an Arrayindizes aus — werfender Slot bleibt strukturell', () => {
    const controls: Record<string, unknown>[] = [];
    Object.defineProperty(controls, '0', {
      get() {
        throw new Error('Getter wurde ausgeführt');
      },
      enumerable: true,
      configurable: true,
    });
    const hostile = catalog({ metadata: {}, controls });

    const index = indexCatalogControls(hostile);

    // Der Accessor erscheint als abwesender Slot; nichts wird ausgeführt.
    expect(index.order).toEqual([]);
  });

  it('behandelt Schlüssel außerhalb des Array-Indexbereichs nicht als Controls', () => {
    // Greptile-Befund zu bce6b68: "4294967295" ist kein ECMAScript-Array-
    // Index (Grenze 2**32-1) und erscheint nie in der Serialisierung —
    // ein Slot mit diesem Schlüssel darf nicht als Control einfließen.
    const controls: Record<string, unknown>[] = [];
    Object.defineProperty(controls, '4294967295', {
      value: control('ghost'),
      enumerable: true,
      configurable: true,
    });
    controls.push(control('real'));
    const hostile = catalog({ metadata: {}, controls });

    const index = indexCatalogControls(hostile);

    expect(index.order).toEqual(['real']);
  });

  it('führt keine Accessoren an Gruppen-Arrayslots aus', () => {
    const groups: Record<string, unknown>[] = [];
    Object.defineProperty(groups, '0', {
      get() {
        throw new Error('Getter wurde ausgeführt');
      },
      enumerable: true,
      configurable: true,
    });
    const hostile = catalog({ metadata: {}, groups });

    expect(() => indexCatalogControls(hostile)).not.toThrow();
    expect(indexCatalogControls(hostile).order).toEqual([]);
  });

  it('terminiert bei einer zyklischen Control-Selbstreferenz und trägt die Control einmal', async () => {
    // Greptile-Befund zu fe06afb: Bereits registrierte Controls durften
    // erneut Kindaufgaben erhalten — eine Selbstreferenz blockierte die
    // Indexierung endlos.
    const input = await parseClass2OscalInput(
      new TextEncoder().encode('{"catalog":{"controls":[{"id":"a"}]}}'),
    );
    if (!input.ok) throw new Error('Fixture muss parsen');

    const controlNode = (
      (input.source as { catalog: { controls: Record<string, unknown>[] } }).catalog
        .controls[0]!
    );
    controlNode['controls'] = [controlNode];

    const index = indexCatalogControls(input.source);

    expect(index.order).toEqual(['a']);
  });

  it('terminiert bei einem Gruppenzyklus, der sich selbst als Untergruppe trägt', async () => {
    const input = await parseClass2OscalInput(
      new TextEncoder().encode('{"catalog":{"groups":[{"id":"g"}]}}'),
    );
    if (!input.ok) throw new Error('Fixture muss parsen');

    const groupNode = (
      (input.source as { catalog: { groups: Record<string, unknown>[] } }).catalog.groups[0]!
    );
    groupNode['groups'] = [groupNode];

    const index = indexCatalogControls(input.source);

    expect(index.order).toEqual([]);
  });

  it('ambiguous und none liefern eine strukturelle Ablehnung', () => {
    const index = indexCatalogControls(baseCatalog);
    const diagnostic = { code: 'X', stage: 'domain' } as never;

    const ambiguous = resolveSelectionIds(index, {
      selection: { kind: 'ambiguous', includeControls: [], diagnostic },
      excludeControls: [],
    });
    const none = resolveSelectionIds(index, {
      selection: { kind: 'none', diagnostic },
      excludeControls: [],
    });

    expect(ambiguous.ok).toBe(false);
    expect(none.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.diagnostic.code).toBe(
        PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.SELECTION_INVALID,
      );
    }
  });

  it('unbekannte with-child-controls-Werte werden fail-closed abgelehnt', () => {
    const index = indexCatalogControls(baseCatalog);
    const result = resolveSelectionIds(index, {
      selection: {
        kind: 'include-controls',
        includeControls: [{ withIds: ['ac-1'], matching: [], withChildControls: 'complete', path: '/imports/0' }],
      },
      excludeControls: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe(
        PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.WITH_CHILD_CONTROLS_INVALID,
      );
    }
  });
});
