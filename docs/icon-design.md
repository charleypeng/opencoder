# App icon design

Source: `docs/opencoder-icon.svg` (1024×1024, the single source of truth).

## Concept

opencoder is a desktop client for OpenCode, so the mark keeps the OpenCode
brand's cloud while stating the client's own identity: a terminal prompt
(`>_`) rendered inside the cloud.

- **Background**: rounded-square app tile with a dark radial gradient
  (`#2b3350 → #171c2e → #0e1018`), matching the client's `bg-base` /
  `bg-sunken` design tokens (docs/ui-design.md) so the icon reads as the
  app itself even at small sizes.
- **Halo**: a soft accent (`#7c8cff`, the app's `accent` token) radial glow
  behind the cloud for depth on dark surfaces.
- **Cloud**: the OpenCode mark's silhouette (MIT), re-drawn with an accent
  gradient (`#9aa8ff → #7c8cff → #4a5be8`) plus two-tone underside shading
  (`#3d4bc7 → #2b3596`) mirroring the official mark's folded look.
- **Prompt**: a bold rounded `>_` in near-white (`#f2f4ff`) centered in the
  cloud — the terminal identity, legible at 16 px and at 1024 px.

## Regeneration

```bash
pnpm tauri icon docs/opencoder-icon.svg
```

regenerates `src-tauri/icons/` (icns / ico / all png sizes). The icon list
in `src-tauri/tauri.conf.json` (`bundle.icon`) points at the generated
files, so no config change is needed after regeneration.
