import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tokensCss = readFileSync(join(process.cwd(), "src/styles/tokens.css"), "utf8");

function tokensFor(selector: string): string[] {
  const start = tokensCss.indexOf(`${selector} {`);
  if (start === -1) return [];
  const block = tokensCss.slice(start, tokensCss.indexOf("}", start));
  return [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => `${m[1]}: ${m[2].trim()}`);
}

describe("design tokens (L2 snapshot)", () => {
  it("keeps gray text and its default accent readable on every surface", () => {
    const gray = Object.fromEntries(
      tokensFor('[data-theme="gray"]').map((token) => token.split(": ")),
    );
    function luminance(hex: string): number {
      const channels = hex
        .slice(1)
        .match(/../g)!
        .map((channel) => {
          const value = parseInt(channel, 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }
    for (const foreground of [
      "--fg-primary",
      "--fg-secondary",
      "--fg-faint",
      "--accent",
      "--success",
      "--warning",
      "--danger",
    ]) {
      for (const background of ["--bg-base", "--bg-elevated", "--bg-sunken"]) {
        const light = luminance(gray[background]);
        const dark = luminance(gray[foreground]);
        expect(
          (light + 0.05) / (dark + 0.05),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("matches the token snapshot for dark and light themes", () => {
    expect({
      dark: tokensFor(":root"),
      light: tokensFor('[data-theme="light"]'),
    }).toMatchSnapshot();
  });

  it("defines the required token families", () => {
    const names = [...tokensCss.matchAll(/(--[\w-]+):/g)].map((m) => m[1]);
    const required = [
      "--bg-base",
      "--bg-elevated",
      "--bg-sunken",
      "--fg-primary",
      "--fg-secondary",
      "--fg-faint",
      "--accent",
      "--accent-soft",
      "--success",
      "--warning",
      "--danger",
      "--glass-bg",
      "--glass-border",
      "--glass-blur",
      "--text-xs",
      "--text-sm",
      "--text-md",
      "--text-lg",
      "--r-sm",
      "--r-md",
      "--r-lg",
      "--r-xl",
      "--ease-spring",
      "--dur-fast",
      "--dur-med",
      "--density",
    ];
    for (const name of required) {
      expect(names).toContain(name);
    }
  });

  it("overrides theme-dependent tokens in the light theme", () => {
    const lightNames = new Set(tokensFor('[data-theme="light"]').map((line) => line.split(":")[0]));
    const themeDependent = [
      "--bg-base",
      "--bg-elevated",
      "--bg-sunken",
      "--fg-primary",
      "--fg-secondary",
      "--fg-faint",
      "--accent",
      "--accent-soft",
      "--success",
      "--warning",
      "--danger",
      "--glass-bg",
      "--glass-border",
      "--glass-blur",
    ];
    for (const name of themeDependent) {
      expect(lightNames.has(name), name).toBe(true);
    }
  });

  it("does not duplicate theme-independent tokens in the light theme", () => {
    const lightNames = new Set(tokensFor('[data-theme="light"]').map((line) => line.split(":")[0]));
    const themeIndependent = [
      "--text-xs",
      "--text-sm",
      "--text-md",
      "--text-lg",
      "--r-sm",
      "--r-md",
      "--r-lg",
      "--r-xl",
      "--ease-spring",
      "--dur-fast",
      "--dur-med",
      "--density",
      "--font-ui",
      "--font-code",
    ];
    for (const name of themeIndependent) {
      expect(lightNames.has(name), name).toBe(false);
    }
  });
});
