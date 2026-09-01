export type PetPackSource = "bundled" | "installed";
export type PetRendererKind = "sprite" | "rive";

export interface PetPackSummary {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  source: PetPackSource;
  renderer: PetRendererKind;
  preview: string;
  removable: boolean;
  contentHash: string;
}

export interface PetPackDiagnostic {
  id?: string;
  code: string;
  detail: string;
}

export interface PetPackInstallResult {
  pack: PetPackSummary;
  installed: boolean;
}

export const DEFAULT_PET_PACK_ID = "dev.opencoder.byte";
export const BOX_CAT_PET_PACK_ID = "dev.opencoder.box-cat";

/** Stable web-test inventory. Desktop builds always ask the Rust registry. */
export const testPetPacks: readonly PetPackSummary[] = [
  {
    id: DEFAULT_PET_PACK_ID,
    name: "Byte",
    version: "1.0.0",
    author: "OpenCoder",
    source: "bundled",
    renderer: "sprite",
    preview: "preview.webp",
    removable: false,
    contentHash: "test-byte",
  },
  {
    id: BOX_CAT_PET_PACK_ID,
    name: "Box Cat",
    version: "1.0.0",
    author: "OpenCoder",
    source: "bundled",
    renderer: "sprite",
    preview: "preview.webp",
    removable: false,
    contentHash: "test-box-cat",
  },
];
