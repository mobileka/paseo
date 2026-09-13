import { app } from "electron";

export interface AboutPanelVersionOptions {
  applicationVersion: string;
  version: string;
}

export function buildAboutPanelOptions(version: string): AboutPanelVersionOptions {
  return { applicationVersion: version, version };
}

export function applyAboutPanelOptions(): void {
  app.setAboutPanelOptions(buildAboutPanelOptions(app.getVersion()));
}
