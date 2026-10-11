import { createElement, type ReactElement } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';

/** Die Shell mit der echten Routentabelle im Speicher-Router, Einstieg `route` (GSPP-506). */
export function appShellAt(route: string): ReactElement {
  const router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [route] });
  return createElement(RouterProvider, { router });
}
