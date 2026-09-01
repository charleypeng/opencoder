import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import schema from "../../../docs/schemas/pet-pack-v1.schema.json";
import invalidAssetPath from "../../../tests/fixtures/pet-packs/invalid-asset-path.json";
import invalidId from "../../../tests/fixtures/pet-packs/invalid-id.json";
import invalidRiveInputs from "../../../tests/fixtures/pet-packs/invalid-rive-inputs.json";
import invalidSchemaVersion from "../../../tests/fixtures/pet-packs/invalid-schema-version.json";
import validRive from "../../../tests/fixtures/pet-packs/valid-rive/manifest.json";
import validSprite from "../../../tests/fixtures/pet-packs/valid-sprite/manifest.json";

const validate = new Ajv({ allErrors: true }).compile(schema);

describe("pet pack v1 schema", () => {
  it.each([
    ["sprite", validSprite],
    ["rive", validRive],
  ])("accepts the valid %s fixture", (_renderer, manifest) => {
    expect(validate(manifest)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it.each([
    ["unknown schema version", invalidSchemaVersion],
    ["non-namespaced id", invalidId],
    ["path traversal", invalidAssetPath],
    ["Rive inputs without intensity", invalidRiveInputs],
  ])("rejects %s", (_caseName, manifest) => {
    expect(validate(manifest)).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  it("does not allow executable or markup asset paths", () => {
    const withExecutablePreview = {
      ...validSprite,
      preview: "assets/preview.js",
    };
    const withSvgState = {
      ...validSprite,
      renderer: {
        ...validSprite.renderer,
        states: {
          ...validSprite.renderer.states,
          idle: { ...validSprite.renderer.states.idle, asset: "assets/idle.svg" },
        },
      },
    };

    expect(validate(withExecutablePreview)).toBe(false);
    expect(validate(withSvgState)).toBe(false);
  });
});
