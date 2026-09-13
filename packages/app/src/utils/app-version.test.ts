import { afterEach, describe, expect, it, vi } from "vitest";
import appPackage from "../../package.json";
import { resolveAppVersion } from "./app-version";

vi.mock("expo-constants", () => ({ default: {} }));

const ORIGINAL = process.env.EXPO_PUBLIC_PASEO_APP_VERSION;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.EXPO_PUBLIC_PASEO_APP_VERSION;
  } else {
    process.env.EXPO_PUBLIC_PASEO_APP_VERSION = ORIGINAL;
  }
});

describe("resolveAppVersion", () => {
  it("prefers the build-injected fork version", () => {
    process.env.EXPO_PUBLIC_PASEO_APP_VERSION = "0.8.0-personal.3";
    expect(resolveAppVersion()).toBe("0.8.0-personal.3");
  });

  it("falls back to the bundled package version", () => {
    delete process.env.EXPO_PUBLIC_PASEO_APP_VERSION;
    expect(resolveAppVersion()).toBe(appPackage.version);
  });
});
