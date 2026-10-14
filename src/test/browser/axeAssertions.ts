import axe from 'axe-core';

/** WCAG 2.0/2.1/2.2 A/AA am gerenderten Zustand; keine Ausnahmen für einzelne Regeln. */
export async function assertNoAxeViolations(context: Element, state: string, scope: 'wcag' | 'all' = 'wcag'): Promise<void> {
  const { violations } = await axe.run(context, {
    ...(scope === 'wcag' ? {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    } : {}),
    resultTypes: ['violations'],
  });
  if (violations.length === 0) return;

  const diagnostics = violations.flatMap(({ id, help, nodes }) =>
    nodes.map(({ target, html, failureSummary }) =>
      `${id}: ${help}\n  Element: ${JSON.stringify(target)}\n  HTML: ${html}\n  ${failureSummary ?? 'Axe-Verstoß'}`,
    ),
  );
  throw new Error(`Axe-Verstöße im Zustand „${state}“:\n${diagnostics.join('\n')}`);
}
