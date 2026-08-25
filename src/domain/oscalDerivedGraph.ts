// =============================================================================
// Kontrollierter Builder des Ableitungswegs (ADR-8 Festlegung 3)
//
// Der Ableitungsweg erzeugt seinen Graphen ausschließlich über diesen
// Builder: Er allein erschafft Container, nimmt keine fremden Objekt- oder
// Arraywerte entgegen, bewahrt ein eigenes __proto__-Feld als voll
// schreibbare Data-Property und gibt unfertige Graphen nicht heraus.
// Freigegeben wird ausschließlich ein opakes Handle für die fertiggestellte
// Wurzel; die Herkunftsfrage der Prüfkette liest das modulprivate Register
// dieses Moduls. Ein nachgebauter Handle-Kandidat scheitert an der
// WeakSet-Identität, ein Proxy um ein echtes Handle an anderer
// Containeridentität.
//
// Das Register ist bewusst NICHT exportiert; exportiert wird allein die
// nur-lesende Identitätsfrage — dasselbe geschlossene Muster wie am
// Byte-Eintrittspunkt.
// =============================================================================

declare const derivedObjectBrand: unique symbol;
declare const derivedArrayBrand: unique symbol;
declare const derivedRootBrand: unique symbol;

/** Opakes Handle eines vom Builder erschaffenen Objektcontainers. */
export interface DerivedObjectHandle {
  readonly [derivedObjectBrand]: 'object';
}

/** Opakes Handle eines vom Builder erschaffenen Arraycontainers. */
export interface DerivedArrayHandle {
  readonly [derivedArrayBrand]: 'array';
}

/**
 * Opak ausgeliefertes Wurzelhandle eines fertiggestellten Builder-Graphen.
 * Zur Laufzeit ist es der registrierte Wurzelcontainer selbst; die Marke ist
 * eine reine Phantomtypisierung und existiert nicht als Property.
 */
export type DerivedJsonTree = object & {
  readonly [derivedRootBrand]: 'finished-root';
};

/** Werte, die der Builder als Mitglieder und Elemente akzeptiert. */
export type DerivedGraphValue =
  | string
  | number
  | boolean
  | null
  | DerivedObjectHandle
  | DerivedArrayHandle;

/**
 * Modulprivates Register aller vom Builder erschaffenen Container. Einziger
 * Schreibpfad ist die Containererzeugung unten; nicht exportiert.
 */
const derivedContainers = new WeakSet<object>();

const containerByHandle = new WeakMap<
  DerivedObjectHandle | DerivedArrayHandle,
  object
>();

function internalContainer(handle: DerivedObjectHandle | DerivedArrayHandle): object {
  const container = containerByHandle.get(handle);
  if (container === undefined) {
    throw new TypeError('Unbekanntes Builder-Handle');
  }
  return container;
}

/**
 * Nur-lesende Identitätsfrage über das Register des kontrollierten Builders;
 * sein einziger Export neben den opaken Handle-Typen und der Builderfabrik.
 */
export function isDerivedProducedContainer(source: object): boolean {
  return derivedContainers.has(source);
}

/** Setzt ein Mitglied als voll schreibbare, aufzählbare Data-Property. */
function defineDataMember(container: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(container, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** Löst einen Builder-Wert auf oder weist fremde Objekt-/Arraywerte ab. */
function resolveGraphValue(value: DerivedGraphValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  return internalContainer(value);
}

/**
 * Fabrik des kontrollierten Builders. Jeder Aufruf liefert eine unabhängige
 * Builder-Sicht; Container entstehen ausschließlich hier und landen sofort
 * im Herkunftsregister dieses Moduls.
 */
export function createOscalDerivedGraph(): {
  object(): DerivedObjectHandle;
  array(): DerivedArrayHandle;
  setObjectMember(
    handle: DerivedObjectHandle,
    key: string,
    value: DerivedGraphValue,
  ): void;
  pushArrayItem(handle: DerivedArrayHandle, value: DerivedGraphValue): void;
  finishRoot(handle: DerivedObjectHandle | DerivedArrayHandle): DerivedJsonTree;
} {
  function object(): DerivedObjectHandle {
    const handle = {} as DerivedObjectHandle;
    const container: Record<string, unknown> = {};
    containerByHandle.set(handle, container);
    derivedContainers.add(container);
    return handle;
  }

  function array(): DerivedArrayHandle {
    const handle = [] as unknown as DerivedArrayHandle;
    const container: unknown[] = [];
    containerByHandle.set(handle, container);
    derivedContainers.add(container);
    return handle;
  }

  function setObjectMember(
    handle: DerivedObjectHandle,
    key: string,
    value: DerivedGraphValue,
  ): void {
    if (typeof key !== 'string') throw new TypeError('Mitgliederschlüssel muss ein String sein');
    const container = internalContainer(handle) as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(container, key)) {
      throw new TypeError(`Doppeltes Mitglied: ${key.length > 0 ? 'Schlüssel bereits vorhanden' : 'leerer Schlüssel'}`);
    }
    // Eigene __proto__-Felder bleiben Data-Property statt Prototypwechsel.
    defineDataMember(container, key, resolveGraphValue(value));
  }

  function pushArrayItem(handle: DerivedArrayHandle, value: DerivedGraphValue): void {
    const container = internalContainer(handle) as unknown[];
    container.push(resolveGraphValue(value));
  }

  function finishRoot(handle: DerivedObjectHandle | DerivedArrayHandle): DerivedJsonTree {
    // Freigegeben wird der registrierte Container selbst — nie ein
    // unverknüpftes Handle-Objekt, sonst trüge die Wurzel keinen Beleg.
    return internalContainer(handle) as DerivedJsonTree;
  }

  return { object, array, setObjectMember, pushArrayItem, finishRoot };
}
