import { invoke } from "@tauri-apps/api/core";
import {
  testPetPacks,
  type PetPackDiagnostic,
  type PetPackInstallResult,
  type PetPackSummary,
} from "../features/pet/packTypes.js";

export class PetPackError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
  }
}

const assetUrls = new Map<string, string>();

function inTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

function toPetPackError(error: unknown): PetPackError {
  const text = error instanceof Error ? error.message : String(error);
  const separator = text.indexOf(": ");
  if (separator === -1) return new PetPackError("petPackFailed", text);
  return new PetPackError(text.slice(0, separator), text.slice(separator + 2));
}

function binaryBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Uint8Array.from(value);
  }
  throw new PetPackError("invalidAssetResponse", "pet asset response was not binary");
}

export async function listPetPacks(): Promise<readonly PetPackSummary[]> {
  if (!inTauri()) return testPetPacks;
  try {
    return await invoke<PetPackSummary[]>("pet_pack_list");
  } catch (error) {
    throw toPetPackError(error);
  }
}

export async function installPetPack(
  path: string,
  allowDowngrade = false,
): Promise<PetPackInstallResult> {
  if (!inTauri()) throw new PetPackError("desktopRequired", "pet packs require the desktop app");
  try {
    return await invoke<PetPackInstallResult>("pet_pack_install", { path, allowDowngrade });
  } catch (error) {
    throw toPetPackError(error);
  }
}

export async function removePetPack(id: string, selectedPackId?: string): Promise<void> {
  if (!inTauri()) throw new PetPackError("desktopRequired", "pet packs require the desktop app");
  try {
    await invoke("pet_pack_remove", { id, selectedPackId });
  } catch (error) {
    throw toPetPackError(error);
  }
}

export async function getPetPackDiagnostics(): Promise<readonly PetPackDiagnostic[]> {
  if (!inTauri()) return [];
  try {
    return await invoke<PetPackDiagnostic[]>("pet_pack_diagnostics");
  } catch (error) {
    throw toPetPackError(error);
  }
}

export async function getPetPackAssetUrl(id: string, relativePath: string): Promise<string> {
  const key = `${id}\u0000${relativePath}`;
  const cached = assetUrls.get(key);
  if (cached !== undefined) return cached;
  if (!inTauri()) throw new PetPackError("desktopRequired", "pet assets require the desktop app");
  try {
    const payload = await invoke<unknown>("pet_pack_read_asset", { id, relativePath });
    const url = URL.createObjectURL(new Blob([binaryBytes(payload)]));
    assetUrls.set(key, url);
    return url;
  } catch (error) {
    if (error instanceof PetPackError) throw error;
    throw toPetPackError(error);
  }
}

export function revokePetPackAssetUrls(id?: string): void {
  for (const [key, url] of assetUrls) {
    if (id !== undefined && !key.startsWith(`${id}\u0000`)) continue;
    URL.revokeObjectURL(url);
    assetUrls.delete(key);
  }
}
