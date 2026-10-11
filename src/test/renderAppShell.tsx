import { act, render } from '@testing-library/react';
import { createContext, createRef, useContext, useImperativeHandle, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';

const RenderTick = createContext(0);

/** Ruft `renderShell` bei jedem Neu-Render auf, damit die Shell neue Hook-Werte liest. */
function ShellHost({ renderShell }: Readonly<{ renderShell: () => ReactNode }>) {
  useContext(RenderTick);
  return renderShell();
}

interface RootHandle { readonly bump: () => void }

function Root({ router, ref }: Readonly<{ router: ReturnType<typeof createMemoryRouter>; ref: Ref<RootHandle> }>) {
  const [tick, setTick] = useState(0);
  useImperativeHandle(ref, () => ({ bump: () => setTick((value) => value + 1) }), []);
  return (
    <RenderTick.Provider value={tick}>
      <RouterProvider router={router} />
    </RenderTick.Provider>
  );
}

/**
 * Rendert die Shell mit der echten Routentabelle in einem Speicher-Router, wie
 * `main.tsx` im Browser (GSPP-506). `shell` liefert das Element der Layoutroute,
 * etwa um Prüfhilfen neben der Shell zu rendern.
 *
 * `rerenderApp()` rendert die Shell erneut, etwa nach einer geänderten
 * Medienabfrage. Ein `rerender` mit demselben `RouterProvider` reicht dafür
 * nicht: Der Router hält die Elemente seiner Routen fest.
 */
export function renderAppShell(
  initialEntries: string[] = ['/'],
  { shell = () => <AppShell />, initialIndex }: {
    readonly shell?: () => ReactNode;
    readonly initialIndex?: number;
  } = {},
) {
  const router = createMemoryRouter(
    createAppRoutes(<ShellHost renderShell={shell} />),
    { initialEntries, initialIndex },
  );
  const root = createRef<RootHandle>();
  const view = render(<Root router={router} ref={root} />);
  return {
    ...view,
    router,
    rerenderApp: () => act(() => root.current?.bump()),
  };
}
