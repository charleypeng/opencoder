# Pet pack format v1

An opencoder pet pack is a local, data-only `.opet` archive. It supplies a companion's artwork and declarative animation mapping; it does not run code and receives no application permissions.

The machine-readable contract is [pet-pack-v1.schema.json](schemas/pet-pack-v1.schema.json). The Rust installer is the final security authority: passing the JSON Schema check never bypasses archive, media, size, or path validation.

## Compatibility

| Field | v1 rule |
|---|---|
| Archive | ZIP file with a `.opet` extension |
| Manifest | UTF-8 `manifest.json` at archive root |
| Renderers | `sprite` or `rive` |
| Preview | PNG or WebP |
| Runtime media | PNG, WebP, or Rive `.riv` only |
| Executable content | Forbidden: HTML, JavaScript, CSS, Wasm, SVG, fonts, and nested archives |

Unknown `schemaVersion` values are rejected. A later version must use a new schema rather than overload v1 fields.

## Package layout

The archive root has no wrapper directory:

```text
my-pet.opet
├── manifest.json
├── preview.webp
└── assets/
    ├── idle.webp
    ├── working.webp
    ├── waiting.webp
    ├── success.webp
    ├── error.webp
    ├── attention.webp
    └── reactions.webp
```

Rive packages replace the image sequence with one `.riv` file:

```text
my-rive-pet.opet
├── manifest.json
├── preview.png
└── assets/
    └── pet.riv
```

Do not put an enclosing folder around `manifest.json`. Paths in the manifest are relative to this root, use `/` separators, and cannot begin with `/`, contain `..`, or contain backslashes.

## Manifest

Every manifest contains these fields:

```json
{
  "$schema": "https://opencoder.dev/schemas/pet-pack-v1.schema.json",
  "schemaVersion": 1,
  "id": "dev.example.nova",
  "name": "Nova",
  "version": "1.2.3",
  "author": "Example Creator",
  "license": "CC-BY-4.0",
  "description": "A small pixel coding companion.",
  "preview": "preview.webp",
  "renderer": {}
}
```

`id` is a lower-case reverse-domain name such as `dev.example.nova`. It identifies upgrades, so never reuse it for an unrelated character. `version` is SemVer. `name`, `author`, `license`, and `description` are plain text displayed by the settings list; they are never interpreted as HTML.

`preview` is a required PNG or WebP image used for the settings ListView. It must accurately represent the installed character.

## Sprite renderer

A Sprite pack uses horizontal image strips. All states share one logical canvas size; the image width is the per-frame width multiplied by `frames`.

```json
{
  "type": "sprite",
  "pixelated": true,
  "canvas": { "width": 256, "height": 256 },
  "states": {
    "idle": { "asset": "assets/idle.webp", "frames": 8, "fps": 8, "loop": true },
    "working": { "asset": "assets/working.webp", "frames": 8, "fps": 12, "loop": true },
    "waiting": { "asset": "assets/waiting.webp", "frames": 6, "fps": 8, "loop": true },
    "success": { "asset": "assets/success.webp", "frames": 8, "fps": 12, "loop": false },
    "error": { "asset": "assets/error.webp", "frames": 6, "fps": 6, "loop": true },
    "attention": { "asset": "assets/attention.webp", "frames": 8, "fps": 12, "loop": false }
  },
  "reactions": {
    "tap": { "asset": "assets/reactions.webp", "startFrame": 0, "frames": 6, "fps": 12 },
    "hover": { "state": "attention" },
    "dragStart": { "state": "attention" },
    "drop": { "asset": "assets/reactions.webp", "startFrame": 6, "frames": 4, "fps": 10 }
  }
}
```

Only `idle` is required. A missing coding state falls back to `idle`; a missing reaction uses the host's subtle fallback feedback. `fps` is restricted to 1–30 and each Sprite sequence is restricted to 1–120 frames. `pixelated: true` asks the host to use integer, nearest-neighbour scaling.

## Rive renderer

Rive is suitable for vector character rigs. The asset is still data-only: it must not depend on network resources, scripts, or external files.

```json
{
  "type": "rive",
  "asset": "assets/fox.riv",
  "artboard": "Pet",
  "stateMachine": "PetMachine",
  "inputs": {
    "state": "state",
    "intensity": "intensity",
    "tap": "tap",
    "hovered": "hovered",
    "dragging": "dragging"
  }
}
```

`state` and `intensity` are required. The host writes the following fixed values to the `state` number input:

| State | Value |
|---|---:|
| `idle` | 0 |
| `working` | 1 |
| `waiting` | 2 |
| `success` | 3 |
| `error` | 4 |
| `attention` | 5 |

`intensity` is a number from 0 to 100. `tap` is a trigger; `hovered` and `dragging` are booleans. A pack may omit these three optional interaction inputs.

## Interaction

An optional normalized hitbox prevents a tiny character from making its entire transparent window feel clickable:

```json
{
  "interaction": {
    "hitbox": { "x": 0.16, "y": 0.08, "width": 0.68, "height": 0.86 },
    "tapRevertsAfterMs": 1800
  }
}
```

All values are fractions of the logical canvas. The host owns double-click collapse/restore and the context menu; a pack cannot replace either escape path. Coding `error` and `waiting` states remain higher priority than cosmetic pointer reactions.

## Installer limits

The following limits are enforced at import time:

- Archive: 20 MiB maximum.
- Expanded data: 50 MiB maximum.
- Files: 256 maximum; one file: 16 MiB maximum.
- Paths: no absolute path, traversal, symlink, hard link, device file, or nested archive.
- Media: extension and magic bytes must both match the declared allowed type.
- Integrity: every manifest reference must exist within the package root; the installed registry stores manifest and content hashes.

The installer extracts to a private staging directory and only atomically moves a fully validated package into the application data directory. If validation fails, the original `.opet` file remains untouched and the staging directory is removed.

## Author checklist

1. Draw original artwork or include assets you are licensed to distribute.
2. Export `preview.png` or `preview.webp` and the renderer assets.
3. Write `manifest.json` according to the linked schema.
4. Zip the contents, not their enclosing directory, and rename the archive to `.opet`.
5. Import it through Settings → Pet → Add pet. The confirmation dialog shows the parsed metadata before installation.

The app does not copy, trace, or redistribute artwork from Codex or any other product. Use a clear license in `license` so people know what they may do with your character.
