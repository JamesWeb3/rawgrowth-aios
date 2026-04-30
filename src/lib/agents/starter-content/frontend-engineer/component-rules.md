# Component Rules

Frontend ships fast because the rules are tight. Composition over configuration. Brand tokens always. Server-first by default.

## Brand tokens only

No raw Tailwind colors. Ever. The brand-voice ESLint rule (`rawclaw/brand-tokens`) catches `bg-blue-500`, `text-indigo-600`, and friends at lint time. CI fails on violation.

Allowed:

```tsx
<button className="bg-brand-primary text-on-primary">
```

Banned:

```tsx
<button className="bg-blue-500 text-white">  // ESLint error
<button className="bg-indigo-600">           // ESLint error
```

Tokens live in `tailwind.config.ts` under `theme.extend.colors.brand.*`. If a designer asks for a color that's not a token, the answer is "let's add a token," not "let me hardcode it."

## No flat shadows

Flat shadows look like a 2015 Material Design starter kit. Use the layered shadow scale:

```tsx
className="shadow-soft"  // softer, blurred
className="shadow-pop"   // for floating elements
```

Banned: `shadow-md`, `shadow-lg` (too crisp, too generic).

## Server components by default

Default export is a server component. Add `"use client"` only when the component needs:

- `useState` / `useReducer`
- `useEffect`
- Browser-only APIs (`window`, `localStorage`)
- Event handlers (`onClick`, `onChange`) on interactive elements
- Third-party libs that aren't SSR-safe

If you find yourself adding `"use client"` to a wrapper just to pass props down, refactor: keep the leaf client, the parent server.

## useMemo for derived data

Any computation in render that touches a list or runs a filter/sort/map chain gets `useMemo`:

```tsx
const sortedAgents = useMemo(
  () => agents.filter((a) => a.active).sort(byName),
  [agents],
);
```

Rule of thumb: if the computation would show up in a profiler trace, memoize it. If it's a string concat, don't.

## Composition rules

- One component, one job. If the file is over 200 lines, split.
- Props interface lives in the same file, not in a `types.ts` 4 levels up.
- Compound components (`<Card.Header>`, `<Card.Body>`) preferred over giant prop bags.
- No prop drilling more than 2 levels. Use context or refactor.

## Accessibility (non-negotiable)

- Every interactive element is a `<button>` or `<a>`, never a `<div onClick>`
- `aria-label` on icon-only buttons
- Focus ring visible (don't `outline-none` without replacement)
- Color contrast tested with the built-in token system (passes WCAG AA)
- Keyboard nav works (Tab, Enter, Escape on dialogs)

## What gets rejected in review

- Tailwind colors not from the token set
- `"use client"` at the page level "just in case"
- Inline styles (`style={{...}}`) outside of dynamic positioning
- Components over 200 lines without split-up plan
- New external UI lib without RFC
