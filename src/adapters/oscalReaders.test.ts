import { describe, expect, it } from 'vitest';
import { createStructureReaders } from './oscalReaders';

interface State {
  readonly paths: string[];
}

function setup() {
  const state: State = { paths: [] };
  const readers = createStructureReaders<State>((current, path) => {
    current.paths.push(path);
  });
  return { state, ...readers };
}

describe('createStructureReaders', () => {
  it('readArrayField behandelt undefined und null als abwesend', () => {
    const { state, readArrayField } = setup();

    expect(readArrayField({}, 'props', '/root', state)).toEqual([]);
    expect(readArrayField({ props: null }, 'props', '/root', state)).toEqual([]);
    expect(state.paths).toEqual([]);
  });

  it('readArrayField liefert ein vorhandenes Array unverändert', () => {
    const { state, readArrayField } = setup();
    const props = [{ name: 'a' }, 'b'];

    expect(readArrayField({ props }, 'props', '/root', state)).toBe(props);
    expect(state.paths).toEqual([]);
  });

  it('readArrayField diagnostiziert einen vorhandenen Nicht-Array-Wert am Feldpfad', () => {
    const { state, readArrayField } = setup();

    expect(readArrayField({ links: { href: '#x' } }, 'links', '/root/0', state)).toEqual([]);
    expect(state.paths).toEqual(['/root/0/links']);
  });

  it('readObjectArrayField liefert Objekteinträge mit Pfad und diagnostiziert den Rest', () => {
    const { state, readObjectArrayField } = setup();
    const first = { name: 'a' };
    const third = { name: 'c' };

    expect(readObjectArrayField({ props: [first, 'b', third, []] }, 'props', '/p', state)).toEqual([
      { node: first, path: '/p/props/0' },
      { node: third, path: '/p/props/2' },
    ]);
    expect(state.paths).toEqual(['/p/props/1', '/p/props/3']);
  });

  it('readObjectArrayField diagnostiziert die Feldform vor den Einträgen', () => {
    const { state, readObjectArrayField } = setup();

    expect(readObjectArrayField({ props: 'x' }, 'props', '/p', state)).toEqual([]);
    expect(state.paths).toEqual(['/p/props']);
  });

  it('readStringArrayField liefert Strings und diagnostiziert jeden anderen Eintrag', () => {
    const { state, readStringArrayField } = setup();

    expect(readStringArrayField({ ids: ['a', 1, 'b', null] }, 'ids', '/s', state)).toEqual(['a', 'b']);
    expect(state.paths).toEqual(['/s/ids/1', '/s/ids/3']);
  });

  it('readStringArrayField diagnostiziert die Feldform', () => {
    const { state, readStringArrayField } = setup();

    expect(readStringArrayField({ ids: 'a' }, 'ids', '/s', state)).toEqual([]);
    expect(state.paths).toEqual(['/s/ids']);
  });
});
