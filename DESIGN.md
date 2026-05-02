---
name: VibePod Dark Developer
colors:
  background: "#0d1117"
  foreground: "#e2e8f0"
  card-bg: "#161b22"
  border: "#21262d"
  accent-teal: "#2dd4bf"
  accent-violet: "#a78bfa"
  accent-teal-dim: "#0d9488"
  accent-violet-dim: "#7c3aed"
  muted: "#64748b"
  success: "#22c55e"
  error: "#ef4444"
  status-checking: "#eab308"
  status-loading: "#60a5fa"
  status-downloading: "#38bdf8"
  status-online: "#22c55e"
  status-error: "#f97316"
  status-offline: "#ef4444"
  gradient-primary: "linear-gradient(135deg, #2dd4bf, #a78bfa)"
  gradient-primary-dim: "linear-gradient(135deg, #0d9488, #7c3aed)"
  gradient-progress: "linear-gradient(90deg, #2dd4bf, #a78bfa)"
  gradient-download: "linear-gradient(90deg, #60a5fa, #2dd4bf)"
  gradient-loading: "linear-gradient(90deg, #fbbf24, #2dd4bf)"
typography:
  display:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 20px
    fontWeight: "700"
    letterSpacing: "-0.015em"
  headline:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 14px
    fontWeight: "600"
    letterSpacing: "0.05em"
    textTransform: "uppercase"
  body:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 14px
    fontWeight: "400"
    lineHeight: "1.625"
  label:
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    fontSize: 12px
    fontWeight: "500"
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: 12px
    fontWeight: "400"
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  container: 1152px
shadows:
  glow-teal: "0 0 6px rgba(45, 212, 191, 0.4)"
  glow-teal-strong: "0 0 10px rgba(45, 212, 191, 0.7)"
  glow-teal-button: "0 4px 15px rgba(45, 212, 191, 0.2)"
  glow-teal-player: "0 4px 12px rgba(45, 212, 191, 0.3)"
components:
  card:
    backgroundColor: "{colors.card-bg}"
    borderColor: "{colors.border}"
    borderWidth: "1px"
    rounded: "{rounded.xl}"
    padding: "{spacing.xl}"
  button-primary:
    background: "{colors.gradient-primary-dim}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "{spacing.md}"
    boxShadow: "{shadows.glow-teal-button}"
    fontWeight: "600"
    fontSize: 14px
  button-ghost:
    backgroundColor: "transparent"
    borderColor: "{colors.border}"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xs} {spacing.md}"
    fontSize: 12px
  input-textarea:
    backgroundColor: "{colors.background}"
    borderColor: "{colors.border}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    fontSize: 14px
  badge-status:
    backgroundColor: "{colors.background}"
    borderColor: "{colors.border}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs} {spacing.md}"
    fontSize: 12px
  log-panel:
    backgroundColor: "{colors.background}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
    typography: "{typography.mono}"
  progress-bar-track:
    backgroundColor: "{colors.border}"
    height: "6px"
    rounded: "{rounded.full}"
  slider-thumb:
    backgroundColor: "{colors.accent-teal}"
    width: "16px"
    height: "16px"
    rounded: "{rounded.full}"
    boxShadow: "{shadows.glow-teal}"
---

## Brand & Style

The VibePod design system embraces a **Cyber-Dark / Developer-First** aesthetic. The visual language is engineered for focused creation, prioritizing high contrast, clear data hierarchy, and technical precision. The UI evokes the feel of a modern IDE or a pro-audio software tool, rather than a consumer social app.

The emotional tone is powerful, precise, and cutting-edge. It utilizes deeply saturated background tones to reduce eye strain during long sessions, punctuated by vibrant, synthetic neon accents that guide the user's attention and signal system status.

## Colors

The color palette is strictly dark-mode-first, relying on nuanced grays with subtle cool undertones to create depth, contrasted against highly saturated "cyber" accents.

- **Background Layers:** The base background is a deep, near-black slate (`#0d1117`), while interactive cards and panels float slightly higher with a marginally lighter, cool-tinted gray (`#161b22`).
- **Accents:** The primary brand colors are Teal (`#2dd4bf`) and Violet (`#a78bfa`). These are used sparingly as solid colors for small interactive elements (like range thumbs) but frequently combined into dynamic linear gradients for primary actions and active states.
- **Typography:** Text relies on high-contrast silver/white (`#e2e8f0`) for primary readability, stepping down to a cool, slate-gray muted tone (`#64748b`) for secondary metadata and unselected states.
- **System Status:** A robust set of semantic colors communicates the complex state of the generative AI model, utilizing recognizable traffic-light paradigms (Green for online, Red for offline) alongside descriptive states like Sky Blue for downloading.

## Typography

The typographic system is built entirely on native system fonts, ensuring zero latency, maximum crispness on any display, and an immediate sense of familiarity across operating systems.

- **Hierarchy:** Headers utilize uppercase styling with generous letter spacing to act as clear section dividers without requiring massive font sizes.
- **Utility:** A monospace stack is rigorously applied to technical data, including timestamps, duration markers, server status logs, and numerical readouts, reinforcing the "pro-tool" aesthetic.
- **Reading Comfort:** The primary script input utilizes a relaxed line height (`1.625`) to ensure long-form text remains highly legible during the editing and recording process.

## Layout & Spacing

The layout is highly structured, utilizing a modular, dashboard-like grid that keeps all controls immediately accessible without scrolling.

- **Grid System:** A responsive 3-column grid serves as the foundation. The primary creative space (script input and audio playback) commands 2/3 of the width, while the technical controls and system logs are confined to a 1/3 sidebar column.
- **Containment:** Elements are strictly containerized within defined cards. This strong bordering approach (`1px solid var(--border)`) clearly delineates different functional areas of the application.
- **Rhythm:** Spacing follows a tight 4px baseline grid. Padding within cards is generous (`20px`), while the gaps between related structural elements are kept relatively tight to maintain a cohesive control-panel feel.

## Elevation, Depth & Glow

Traditional drop shadows are abandoned in favor of **Neon Glow** to create depth and indicate interactivity.

- **Flat Surfaces:** Cards and panels do not use shadows to lift off the background; they rely solely on subtle background color shifts and crisp 1px borders.
- **Interactive Glow:** Key interactive elements, such as the primary generation button and the audio playback controls, utilize a colored, diffused box-shadow (e.g., `rgba(45, 212, 191, 0.2)`) that matches their gradient background, making them appear to emit light.
- **Range Sliders:** Custom range input thumbs feature a concentrated teal glow that intensifies on hover, providing tactile visual feedback reminiscent of physical mixing consoles.

## Shapes

The shape language is a hybrid of structural precision and tactile softness.

- **Containers:** Large structural elements like cards and the main text area use a moderate `0.75rem` (12px) radius, softening the rigid grid.
- **Interactive Elements:** Primary action buttons are fully rounded (`rounded-xl` or `rounded-full` for play buttons), creating a clear visual distinction between "containers of information" and "things you click."
- **Progress:** All progress bars, slider tracks, and status indicator dots utilize fully rounded pill shapes (`9999px`) to maintain a fluid, continuous feel during generation and playback.

## Components

### Card Containers

The fundamental building block of the UI. Every distinct section (Script, Player, Controls, Logs) is housed in a card featuring the `card-bg`, a 1px `border`, and `rounded-xl` corners. The internal layout always features an uppercase teal header for immediate section identification.

### Primary Action Buttons

Used for high-leverage actions like "Generate Audio" and "Play/Pause." These buttons utilize the `gradient-primary-dim` background, bold white text, and emit a soft teal glow to draw the eye and signify their importance.

### Range Sliders

Custom-styled input ranges replace default browser styles. The tracks are muted and slim, while the thumbs are bright teal, fully rounded, and emit a glow that intensifies on hover, providing a premium, tactile scrubbing experience.

### Status Indicators & Logs

A critical component of the application. Status badges utilize a minimalist pill shape with a pulsing ring animation to indicate active server processing. The log panel explicitly uses monospace typography and color-codes messages (green for success, red for error, white for neutral) to provide a terminal-like readout of the backend systems.

### Gradients

Gradients are used purposefully to indicate progress, activity, or brand presence. The primary gradient (`135deg` from teal to violet) is used for branding (the logo icon and text) and primary buttons. Horizontal gradients (`90deg`) are used dynamically in progress bars to represent the flow of data over time (e.g., loading, downloading, and audio generation).
