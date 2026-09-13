import {
  getDesktopSandboxDiagnostics,
  type DesktopSandboxDiagnostics,
  getDesktopAppLogs,
  getDesktopDaemonLogs,
  getDesktopDaemonStatus,
  getDesktopUpdateDiagnostics,
  type DesktopAppLogs,
  type DesktopDaemonLogs,
  type DesktopDaemonStatus,
  type DesktopUpdateDiagnosticFile,
  type DesktopUpdateDiagnostics,
} from "@/desktop/daemon/desktop-daemon";
import { formatDiagnosticSection } from "./app-diagnostic-report";

type DesktopDiagnosticStatus = "done" | "failed";

export interface DesktopDiagnosticCollectionResult {
  sections: string[];
  status: DesktopDiagnosticStatus;
}

export interface DesktopDiagnosticSources {
  getSandboxDiagnostics: () => Promise<DesktopSandboxDiagnostics>;
  getStatus: () => Promise<DesktopDaemonStatus>;
  getDaemonLogs: () => Promise<DesktopDaemonLogs>;
  getAppLogs: () => Promise<DesktopAppLogs>;
  getUpdateDiagnostics: () => Promise<DesktopUpdateDiagnostics>;
}

const DEFAULT_DESKTOP_DIAGNOSTIC_SOURCES: DesktopDiagnosticSources = {
  getSandboxDiagnostics: getDesktopSandboxDiagnostics,
  getStatus: getDesktopDaemonStatus,
  getDaemonLogs: getDesktopDaemonLogs,
  getAppLogs: getDesktopAppLogs,
  getUpdateDiagnostics: getDesktopUpdateDiagnostics,
};

export async function collectDesktopDiagnosticSections(
  sources: DesktopDiagnosticSources = DEFAULT_DESKTOP_DIAGNOSTIC_SOURCES,
): Promise<DesktopDiagnosticCollectionResult> {
  const sections: string[] = [];
  let failed = false;

  const [daemonResult, appLogsResult, updateResult, sandboxResult] = await Promise.allSettled([
    Promise.all([sources.getStatus(), sources.getDaemonLogs()]),
    sources.getAppLogs(),
    sources.getUpdateDiagnostics(),
    sources.getSandboxDiagnostics(),
  ]);

  if (sandboxResult.status === "fulfilled") {
    const sandbox = sandboxResult.value;
    sections.push(
      formatDiagnosticSection("Chromium sandbox", [
        {
          label: "State",
          value: sandbox.enabled ? "Enabled" : "Disabled",
        },
        { label: "Reason", value: sandbox.reason },
      ]),
    );
  } else {
    failed = true;
    sections.push(
      formatDiagnosticSection("Chromium sandbox", [
        { label: "Error", value: toMessage(sandboxResult.reason) },
      ]),
    );
  }

  if (daemonResult.status === "fulfilled") {
    const [status, daemonLogs] = daemonResult.value;
    const appLogs = appLogsResult.status === "fulfilled" ? appLogsResult.value : null;
    sections.unshift(...formatDesktopDaemonSections({ status, daemonLogs, appLogs }));
  } else {
    failed = true;
    sections.unshift(
      formatDiagnosticSection("Desktop", [
        { label: "Error", value: toMessage(daemonResult.reason) },
      ]),
    );
  }

  if (appLogsResult.status === "fulfilled") {
    sections.push(formatLogTailSection("Desktop app log tail", appLogsResult.value.contents));
  } else {
    failed = true;
    sections.push(
      formatDiagnosticSection("Desktop app log tail", [
        { label: "Error", value: toMessage(appLogsResult.reason) },
      ]),
    );
  }

  if (updateResult.status === "fulfilled") {
    sections.push(...formatDesktopUpdateSections(updateResult.value));
  } else {
    failed = true;
    sections.push(
      formatDiagnosticSection("Local updates", [
        { label: "Error", value: toMessage(updateResult.reason) },
      ]),
    );
  }

  return {
    status: failed ? "failed" : "done",
    sections,
  };
}

function formatDesktopUpdateSections(diagnostics: DesktopUpdateDiagnostics): string[] {
  const sections = [
    formatDiagnosticSection("Local updates", [
      { label: "Platform", value: diagnostics.platform },
      { label: "Base directory", value: diagnostics.home },
      { label: "Builds directory", value: diagnostics.buildsDir },
      { label: "Running build", value: diagnostics.runningBuildSha ?? "stock build" },
      { label: "Built at", value: diagnostics.builtAt ?? "unknown" },
      {
        label: "App link",
        value: diagnostics.appLink.isSymlink
          ? (diagnostics.appLink.target ?? "unknown")
          : (diagnostics.appLink.error ?? "not a symlink"),
      },
    ]),
    formatUpdateFileSection("Update state file", diagnostics.stateFile),
  ];

  if (diagnostics.github) {
    const github = diagnostics.github;
    sections.push(
      formatDiagnosticSection("GitHub updates", [
        { label: "Repository", value: github.repo || "unknown" },
        { label: "Last checked", value: github.lastCheckedAt ?? "never" },
        { label: "Latest release", value: github.latestTag ?? "none" },
        { label: "Latest commit", value: github.latestCommit ?? "none" },
        { label: "Last error", value: github.lastError ?? "none" },
        { label: "ETag cached", value: github.hasEtag ? "yes" : "no" },
      ]),
    );
  }

  return sections;
}

function formatUpdateFileSection(title: string, file: DesktopUpdateDiagnosticFile | null): string {
  if (!file) {
    return formatDiagnosticSection(title, [{ label: "Status", value: "unavailable" }]);
  }

  const header = formatDiagnosticSection(title, [{ label: "Path", value: file.path || "unknown" }]);
  if (file.error) return `${header}\n  Error: ${file.error}`;
  if (!file.contents) return `${header}\n  No contents found`;
  return `${header}\n${indentBlock(file.contents)}`;
}

function formatDesktopDaemonSections(input: {
  status: DesktopDaemonStatus;
  daemonLogs: DesktopDaemonLogs;
  appLogs: DesktopAppLogs | null;
}): string[] {
  const { status, daemonLogs, appLogs } = input;
  return [
    formatDiagnosticSection("Desktop", [
      { label: "Daemon status", value: status.status },
      { label: "Desktop managed", value: String(status.desktopManaged) },
      { label: "Daemon PID", value: status.pid === null ? "none" : String(status.pid) },
      { label: "Daemon version", value: status.version ?? "unknown" },
      { label: "Daemon home", value: status.home || "unknown" },
      { label: "Log path", value: daemonLogs.logPath || "unknown" },
      { label: "App log path", value: appLogs?.logPath || "unavailable" },
      { label: "Error", value: status.error ?? "none" },
    ]),
    formatLogTailSection("Desktop daemon log tail", daemonLogs.contents),
  ];
}

function formatLogTailSection(title: string, contents: string): string {
  return [title, contents ? indentBlock(contents) : "  No log lines found"].join("\n");
}

function indentBlock(value: string): string {
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join("\n");
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
