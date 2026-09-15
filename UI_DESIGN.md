# Stitch Up Media UI design system

## Direction

Stitch Up Media uses **80s Compute** as its default theme: a restrained terminal-inspired interface built on navy panels, phosphor typography, sharp borders, bracketed keyboard actions, and compact information-dense controls. The visual language is intentionally minimal rather than decorative so media content remains the focus during long encoding sessions.

## Themes

The token file at `src/styles/design-tokens.css` defines two swappable token sets. The default theme uses navy ramp surfaces, near-white phosphor text, amber as the primary action accent, and distinct semantic colors for done, encoding, paused, error, and pending states. The optional Modern theme remaps the same semantic names to neutral charcoal surfaces, blue actions, small radii, and soft elevation.

Themes are selected with the `data-theme` attribute on the application root. Components should consume semantic tokens rather than hard-coding theme-specific values.

## Layout

The app shell has five persistent layers: macOS window header, three-region workbench, modal surfaces, status/progress area, and bottom command bar. The workbench is divided into a queue rail, a task-detail workspace, and an optional settings rail. The settings rail is part of the flex layout, so it pushes the task detail inward instead of obscuring it.

## Interaction language

Keyboard-oriented actions use bracketed labels such as `[O] OPEN`, `[C] CONVERT`, and `[A] ADVANCED`. Rows with a trailing `>` indicate progressive disclosure. Output settings are output-driven: the selected container determines which controls are available, while unsupported controls remain visible but disabled with an explanatory reason.

## Accessibility

The retro treatment does not replace normal interaction semantics. Controls remain native buttons, inputs, and selects; focus receives a visible phosphor outline; color is paired with text labels; text uses a readable mono size; and motion is limited to short transitions. The scanline overlay is pointer-transparent and can be disabled or reduced with the system motion preference.
