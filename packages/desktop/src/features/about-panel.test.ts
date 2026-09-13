import { describe, expect, it } from "vitest";
import { buildAboutPanelOptions } from "./about-panel";

describe("buildAboutPanelOptions", () => {
  it("uses the fork version as both the application and build version", () => {
    expect(buildAboutPanelOptions("0.8.0-personal.3")).toEqual({
      applicationVersion: "0.8.0-personal.3",
      version: "0.8.0-personal.3",
    });
  });
});
