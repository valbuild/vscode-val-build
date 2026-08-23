import type { ProjectServerSession } from "./projectLanguageServers";

/**
 * The report behind `val.showLanguageServerInfo`.
 *
 * This is what makes the resolution mechanism debuggable in the field: which
 * path was resolved, through which anchor, at which version, whether an override
 * supplied it, and what the server said it can do. An override that is never
 * visible is an override that wastes an afternoon.
 *
 * A pure string builder so the whole report can be asserted in tests.
 */
export function formatLanguageServerInfo({
  enabled,
  sessions,
  workspaceRoots,
}: {
  /** `valBuild.useProjectLanguageServer`. */
  enabled: boolean;
  sessions: ProjectServerSession[];
  /** Val roots found in the workspace, whether or not a server started. */
  workspaceRoots: string[];
}): string {
  const lines: string[] = [];
  lines.push("Val language server");
  lines.push("===================");
  lines.push("");
  lines.push(`valBuild.useProjectLanguageServer: ${enabled}`);
  if (!enabled) {
    lines.push(
      "  The bundled language server is handling everything. Set this to true to",
      "  use the server that ships with the Val in your project.",
    );
  }
  lines.push(
    `Val roots in workspace: ${workspaceRoots.length ? workspaceRoots.join(", ") : "none"}`,
  );
  lines.push("");

  if (sessions.length === 0) {
    lines.push("No project language servers.");
    return lines.join("\n");
  }

  for (const session of sessions) {
    lines.push(`--- ${session.valRoot} ---`);
    lines.push(`  state:            ${session.state}`);
    lines.push(
      `  Val version:      ${
        session.valVersion
          ? `${session.valVersion.version} (from ${session.valVersion.packageName})`
          : "not detected"
      }`,
    );
    if (session.state !== "failed") {
      lines.push(`  server entry:     ${session.resolved.entry}`);
      lines.push(
        `  server version:   ${session.resolved.version ?? "unknown"}`,
      );
      lines.push(`  resolved via:     ${session.resolved.via}`);
      lines.push(
        `  override:         ${
          session.resolved.override
            ? `${session.resolved.override.source} = ${session.resolved.override.path}`
            : "none"
        }`,
      );
    }
    const capabilities = session.capabilities;
    if (capabilities) {
      lines.push(`  protocol version: ${capabilities.protocolVersion}`);
      lines.push(
        `  @valbuild/core:   ${capabilities.versions.core ?? "unknown"}`,
      );
      lines.push(
        `  features:         ${capabilities.features.join(", ") || "none"}`,
      );
      lines.push(
        `  commands:         ${capabilities.commands.join(", ") || "none"}`,
      );
    }
    if (session.detail) {
      lines.push(`  detail:           ${session.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
