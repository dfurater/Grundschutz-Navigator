# Menu Focusability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two existing ARIA menu containers programmatically focusable while preserving their current opening, first-item focus, Escape, and outside-click behavior.

**Architecture:** The change is confined to the `role="menu"` containers in the catalog switcher and export menu. Each container receives `tabIndex={-1}`; the existing effects continue to put keyboard focus directly on the first `menuitem`, so no navigation model or visual treatment changes.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Tailwind CSS v4.

## Global Constraints

- Change only the two existing menu containers and their colocated component tests.
- Use `tabIndex={-1}`; do not introduce roving tabindex, keyboard-arrow handling, dependencies, or new design tokens.
- Preserve German UI copy and the established BSI-blue/slate visual system.
- Do not make Linear changes.
- Run tests from this linked worktree with `--exclude='.worktrees/**'`, but do not exclude `.claude/worktrees/**`, because that pattern contains this checkout.

---

### Task 1: Capture the focusability regression

**Files:**
- Modify: `src/components/CatalogSwitcher.test.tsx:96-107`
- Modify: `src/features/catalog/CatalogExportMenu.test.tsx:78-101`

**Interfaces:**
- Consumes: the existing accessible `role="menu"` containers exposed by both components.
- Produces: regression assertions for `tabindex="-1"` on each opened menu.

- [x] **Step 1: Add the failing assertions**

Immediately after opening each menu in its existing autofocus test, add:

```tsx
expect(screen.getByRole('menu')).toHaveAttribute('tabindex', '-1');
```

Keep the existing assertions that the first `menuitem` has focus and that Escape/outside click closes the menu.

- [x] **Step 2: Run the two component tests and verify the expected failure**

Run:

```bash
npm test -- src/components/CatalogSwitcher.test.tsx src/features/catalog/CatalogExportMenu.test.tsx --exclude='.worktrees/**'
```

Expected: both autofocus tests fail because the rendered `role="menu"` elements do not yet have `tabindex="-1"`.

### Task 2: Make the existing menu containers programmatically focusable

**Files:**
- Modify: `src/components/CatalogSwitcher.tsx:74-87`
- Modify: `src/features/catalog/CatalogExportMenu.tsx:72-85`

**Interfaces:**
- Consumes: the React `tabIndex` property on an existing `HTMLDivElement` with `role="menu"`.
- Produces: a `tabindex="-1"` attribute in both menu render paths.

- [x] **Step 1: Add the minimal implementation**

In both existing opening menu elements, add the property between `role="menu"` and the accessible label:

```tsx
<div
  role="menu"
  tabIndex={-1}
  aria-label="…"
>
```

Do not move the `onKeyDown` handler or alter the existing `useEffect` that focuses the first menu entry.

- [x] **Step 2: Run the focused regression suite**

Run:

```bash
npm test -- src/components/CatalogSwitcher.test.tsx src/features/catalog/CatalogExportMenu.test.tsx --exclude='.worktrees/**'
```

Expected: both test files pass, including the new focusability assertions.

### Task 3: Validate the PR surface and commit it

**Files:**
- Create: `docs/superpowers/plans/2026-08-21-menu-focusability.md`
- Modify: `src/components/CatalogSwitcher.tsx`
- Modify: `src/components/CatalogSwitcher.test.tsx`
- Modify: `src/features/catalog/CatalogExportMenu.tsx`
- Modify: `src/features/catalog/CatalogExportMenu.test.tsx`

**Interfaces:**
- Consumes: the two passing component tests and repository-wide validation scripts.
- Produces: a single focused PR branch commit suitable for SonarQube Cloud analysis.

- [x] **Step 1: Run quality checks**

Run:

```bash
npm run lint
npm test -- --exclude='.worktrees/**'
npm run build
```

Expected: lint, the full unit suite, and the production build exit with status 0.

- [x] **Step 2: Inspect the exact staged diff**

Run:

```bash
git diff --check
git diff -- src/components/CatalogSwitcher.tsx src/components/CatalogSwitcher.test.tsx src/features/catalog/CatalogExportMenu.tsx src/features/catalog/CatalogExportMenu.test.tsx
```

Expected: no whitespace errors; only the two `tabIndex={-1}` attributes and their regression assertions alter production/test behavior.

- [ ] **Step 3: Commit the planned files**

Run:

```bash
git add docs/superpowers/plans/2026-08-21-menu-focusability.md src/components/CatalogSwitcher.tsx src/components/CatalogSwitcher.test.tsx src/features/catalog/CatalogExportMenu.tsx src/features/catalog/CatalogExportMenu.test.tsx
git commit -m "fix(a11y): make menu containers focusable"
```

Expected: the branch contains a focused implementation commit after the already committed design specification.
