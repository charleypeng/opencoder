// L1 tests for the connect-URL codec (TASK-M7-08): the desktop side encodes
// `opencode://connect?url=...&name=...` (never credentials) and the mobile
// side parses it back — valid payloads, encoded characters, malformed text,
// wrong schemes/hosts, missing or invalid fields and token passthrough.

import { describe, expect, it } from "vitest";
import { encodeConnectUrl, parseConnectUrl } from "./qrConnect";

describe("encodeConnectUrl", () => {
  it("builds an opencode://connect URL with url and name", () => {
    expect(encodeConnectUrl({ url: "http://192.168.1.5:14096", name: "My Server" })).toBe(
      "opencode://connect?url=http%3A%2F%2F192.168.1.5%3A14096&name=My+Server",
    );
  });

  it("never emits credential fields", () => {
    const encoded = encodeConnectUrl({ url: "http://host:1", name: "S" });
    expect(encoded).not.toMatch(/password|username|secret/i);
  });

  it("round-trips through parseConnectUrl", () => {
    const payload = { url: "https://opencode.example.com", name: "Office", token: "tok-123" };
    expect(parseConnectUrl(encodeConnectUrl(payload))).toEqual(payload);
  });
});

describe("parseConnectUrl", () => {
  it("parses a valid connect URL", () => {
    expect(parseConnectUrl("opencode://connect?url=http://192.168.1.5:14096&name=Home")).toEqual({
      url: "http://192.168.1.5:14096",
      name: "Home",
    });
  });

  it("URL-decodes encoded characters", () => {
    expect(
      parseConnectUrl(
        "opencode://connect?url=http%3A%2F%2F192.168.1.5%3A14096%2F&name=My%20%2B%20Server",
      ),
    ).toEqual({ url: "http://192.168.1.5:14096", name: "My + Server" });
  });

  it("normalizes a scheme-less url like the form does", () => {
    expect(parseConnectUrl("opencode://connect?url=192.168.1.5:14096&name=Home")).toEqual({
      url: "http://192.168.1.5:14096",
      name: "Home",
    });
  });

  it("keeps an optional token", () => {
    expect(parseConnectUrl("opencode://connect?url=http://host:14096&name=S&token=abc123")).toEqual(
      { url: "http://host:14096", name: "S", token: "abc123" },
    );
  });

  it("drops a blank token", () => {
    expect(parseConnectUrl("opencode://connect?url=http://host:14096&name=S&token=%20")).toEqual({
      url: "http://host:14096",
      name: "S",
    });
  });

  it("trims surrounding whitespace from the scanned text", () => {
    expect(parseConnectUrl("  opencode://connect?url=http://host:14096&name=S  ")).toEqual({
      url: "http://host:14096",
      name: "S",
    });
  });

  it("rejects random text and other schemes", () => {
    expect(parseConnectUrl("just some text")).toBeNull();
    expect(parseConnectUrl("https://connect?url=http://host:14096&name=S")).toBeNull();
    expect(parseConnectUrl("opencode://other?url=http://host:14096&name=S")).toBeNull();
  });

  it("rejects missing fields", () => {
    expect(parseConnectUrl("opencode://connect")).toBeNull();
    expect(parseConnectUrl("opencode://connect?url=http://host:14096")).toBeNull();
    expect(parseConnectUrl("opencode://connect?name=S")).toBeNull();
  });

  it("rejects invalid urls and blank names", () => {
    expect(parseConnectUrl("opencode://connect?url=ftp://host:21&name=S")).toBeNull();
    expect(parseConnectUrl("opencode://connect?url=not%20a%20url&name=S")).toBeNull();
    expect(parseConnectUrl("opencode://connect?url=http://host:14096&name=%20%20")).toBeNull();
  });
});
