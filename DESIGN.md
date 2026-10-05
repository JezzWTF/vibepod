---
name: VibePod Studio
colors:
  background: "#17191d"
  panel: "#1d2025"
  line: "#34373e"
  text: "#e8e9eb"
  muted: "#a0a4ac"
  accent: "#aed5bf"
  danger: "#e5a79c"
typography:
  fontFamily: 'Geist, "Segoe UI", sans-serif'
  fontSize: 14px
  lineHeight: "1.5"
rounded:
  control: 5px
  dialog: 8px
---

The source of truth is `web/app/studio.css` (tokens on `.studio-app`).

## Style

A quiet, dark, flat workspace for writing and auditioning. Surfaces are separated by 1px lines (`line`) and small shifts between `background` and `panel`; there are no gradients, glows or drop shadows on surfaces. One soft green `accent` marks the active tab, focus ring, links and primary actions. Destructive actions use `danger` text, never a filled red button.

## Layout

- Top bar with brand and breadcrumb; left workspace navigation (Studio, Library); the script is the main column, with the take inspector and transport anchored around it. The transport height is the `--studio-transport-height` token.
- Library: tabs (Episodes / All takes), an episode status tab row (Active, Archived, Trash, each with a count), search, and a table of rows with a trailing action area.
- Narrow widths collapse the navigation and tables; no horizontal page scroll.

## Components

- **Buttons:** 1px bordered, 5px radius, transparent; hover lifts to a slightly lighter panel. Disabled is 40% opacity.
- **Menus and dialogs:** raised panel with a 1px border; dialogs are 8px radius, close on Escape and backdrop, and focus the safe choice first.
- **Toasts:** bottom-centered status with an Undo for reversible actions.
- **Focus:** a 2px `accent` outline with offset on every interactive element.
- **Take signal:** the synthesis animation resolves into the completed take's real waveform.

## Copy

Explanatory prose belongs in docs. The interface carries only labels, state and short confirmations.
