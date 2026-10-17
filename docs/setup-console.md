# The setup console (`/setup/`)

`https://app8298297292.tgcloud.ai/setup/` is the protected cooperation and admin
surface. It is served from the same deployment as the public student app but
keeps its own path, and the role comes from platform-verified init data — never
from the page.

## Files

| File | Purpose |
| --- | --- |
| `setup/index.html` | Semantic shell: skip link, header, labelled tablist, four panels, confirm dialog. |
| `setup/setup.js` | Plain script (no imports, no bundler): panels, forms, confirmations, live status. |
| `setup/setup.css` | Console layout only. Colours, controls and focus styles come from `web/app.css`, the shared design system. |

`scripts/build-frontend.mjs` copies all six front-end files into `dist/`; `push`
uploads that folder as-is, so run `npm run build` (or `npm run deploy`) first.

## Panels

1. **نمای کلی** — four KPI tiles (healthy connections, covered courses, notices
   sent, last check with its freshness tone), per-account health, the group
   destination and pending digests, and the explicit "what is read" statement.
2. **اتصال‌ها** — one card per connection with mode, course count, last check,
   health badge and credential presence; actions are renew, enable/disable and a
   confirmed delete. The form accepts only a `MoodleSession` value and never shows
   one back. A contributor sees only their own connections; the owner sees all.
3. **درس‌ها و کلاس‌ها** (owner) — searchable course list with editable class number
   and weekly time, a site re-check per course, and a read-only professor list.
   Professors always come from Participants rows with the استاد role; the server
   refuses a manual professor write, and the console does not offer one.
4. **گفت‌وگوی هوشمند** (owner) — service probe, enabled switch, provider, model,
   daily limits, the five persona traits as sliders with visible values, media
   count with a clear action, and the exact disclosure students read.

## Endpoints behind it

| Panel | Calls |
| --- | --- |
| overview | `accounts` (`list`), `directory` (`list`), `check` |
| connections | `accounts` (`list`/`enable`/`disable`/`delete`), `setup` (connect or renew) |
| directory | `directory` (`list`/`set`/`clear`/`detect`) |
| smart chat | `aiAdmin` (`state`/`save`/`persona`/`media`), `aiStatus` (`probe`) |

`endpoints/aiAdmin` is owner-only and validates every value with
`lib/ai-policy.js`, the same module the student endpoint and the chat commands
read. No model key is stored in this project: it lives in the shared Worker's
Cloudflare secret, so the console can tune behaviour but never holds a
credential.

## Accessibility contract

- Landmarks (`banner`, `navigation`, `main`), a skip link, and one `h1`.
- The panel switcher is a real tablist: `aria-selected`, roving `tabindex`,
  Up/Down (and Left/Right) navigation, Home/End, and `aria-controls` on each tab.
- Every input has a `<label for>`; hints and errors are wired with
  `aria-describedby` and `role="alert"`, and an invalid field gets
  `aria-invalid` plus focus.
- Destructive actions use a native `<dialog>`: focus is trapped, Escape cancels,
  and the answer is read from `returnValue`.
- Range sliders expose their value both visually (`#trait-value-*`) and through
  `aria-describedby`.
- Status changes go through a polite live region; a re-render restores focus to
  the control the user was on instead of dropping it to the page body.
- Targets are at least 40px, focus rings are never removed, `prefers-reduced-motion`
  and `prefers-contrast: more` are honoured, and layout is single-column with no
  horizontal overflow at 360px.

## Checking it without Telegram

```
npm run build && npm run preview
# http://127.0.0.1:5199/setup/  — mock client, owner role, three example connections
```

Change `scripts/preview-mock.mjs` to reproduce a contributor view (set
`accounts.owner = false` and drop the directory) or an expired session.
