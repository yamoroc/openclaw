import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { validateConfigObjectWithPlugins } from "./config.js";

async function writePluginFixture(params: {
  dir: string;
  id: string;
  schema: Record<string, unknown>;
  channels?: string[];
}) {
  await fs.mkdir(params.dir, { recursive: true });
  await fs.writeFile(
    path.join(params.dir, "index.js"),
    `export default { id: "${params.id}", register() {} };`,
    "utf-8",
  );
  const manifest: Record<string, unknown> = {
    id: params.id,
    configSchema: params.schema,
  };
  if (params.channels) {
    manifest.channels = params.channels;
  }
  await fs.writeFile(
    path.join(params.dir, "openclaw.plugin.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

describe("config plugin validation", () => {
  const fixtureRoot = path.join(os.tmpdir(), "openclaw-config-plugin-validation");
  let caseIndex = 0;

  function createCaseHome() {
    const home = path.join(fixtureRoot, `case-${caseIndex++}`);
    return fs.mkdir(home, { recursive: true }).then(() => home);
  }

  const validateInHome = (home: string, raw: unknown) => {
    process.env.OPENCLAW_STATE_DIR = path.join(home, ".openclaw");
    return validateConfigObjectWithPlugins(raw);
  };

  afterAll(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  it("rejects missing plugin load paths", async () => {
    const home = await createCaseHome();
    const missingPath = path.join(home, "missing-plugin");
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: { enabled: false, load: { paths: [missingPath] } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const hasIssue = res.issues.some(
        (issue) =>
          issue.path === "plugins.load.paths" && issue.message.includes("plugin path not found"),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it("warns for missing plugin ids in entries instead of failing validation", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: { enabled: false, entries: { "missing-plugin": { enabled: true } } },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings).toContainEqual({
        path: "plugins.entries.missing-plugin",
        message:
          "plugin not found: missing-plugin (stale config entry ignored; remove it from plugins config)",
      });
    }
  });

  it("warns for missing plugin ids in allow/deny/slots instead of failing validation", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        allow: ["missing-allow"],
        deny: ["missing-deny"],
        slots: { memory: "missing-slot" },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings).toEqual(
        expect.arrayContaining([
          {
            path: "plugins.allow",
            message:
              "plugin not found: missing-allow (stale config entry ignored; remove it from plugins config)",
          },
          {
            path: "plugins.deny",
            message:
              "plugin not found: missing-deny (stale config entry ignored; remove it from plugins config)",
          },
          {
            path: "plugins.slots.memory",
            message:
              "plugin not found: missing-slot (stale config entry ignored; remove it from plugins config)",
          },
        ]),
      );
      // Verify sanitization: unknown IDs are filtered out
      expect(res.config.plugins?.allow).toEqual([]);
      expect(res.config.plugins?.deny).toEqual([]);
      expect(res.config.plugins?.slots?.memory).toBeUndefined();
    }
  });

  it("preserves memory slot 'none' value without warning or sanitization", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        slots: { memory: "none" },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Should NOT warn for "none" - it's a valid disable value
      const memoryWarning = res.warnings.find((w) => w.path === "plugins.slots.memory");
      expect(memoryWarning).toBeUndefined();
      // Should preserve "none" value
      expect(res.config.plugins?.slots?.memory).toBe("none");
    }
  });

  it("preserves memory slot 'none' case-insensitively (e.g., 'NONE', ' None ')", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        slots: { memory: " NONE " },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Should NOT warn for "none" variant - case-insensitive
      const memoryWarning = res.warnings.find((w) => w.path === "plugins.slots.memory");
      expect(memoryWarning).toBeUndefined();
      // Should preserve original value (not sanitized away)
      expect(res.config.plugins?.slots?.memory).toBe(" NONE ");
    }
  });

  it("warns for removed legacy plugin ids instead of failing validation", async () => {
    const home = await createCaseHome();
    const removedId = "google-antigravity-auth";
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        entries: { [removedId]: { enabled: true } },
        allow: [removedId],
        deny: [removedId],
        slots: { memory: removedId },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings).toEqual(
        expect.arrayContaining([
          {
            path: `plugins.entries.${removedId}`,
            message:
              "plugin removed: google-antigravity-auth (stale config entry ignored; remove it from plugins config)",
          },
          {
            path: "plugins.allow",
            message:
              "plugin removed: google-antigravity-auth (stale config entry ignored; remove it from plugins config)",
          },
          {
            path: "plugins.deny",
            message:
              "plugin removed: google-antigravity-auth (stale config entry ignored; remove it from plugins config)",
          },
          {
            path: "plugins.slots.memory",
            message:
              "plugin removed: google-antigravity-auth (stale config entry ignored; remove it from plugins config)",
          },
        ]),
      );
    }
  });

  it("surfaces plugin config diagnostics", async () => {
    const home = await createCaseHome();
    const pluginDir = path.join(home, "bad-plugin");
    await writePluginFixture({
      dir: pluginDir,
      id: "bad-plugin",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          value: { type: "boolean" },
        },
        required: ["value"],
      },
    });

    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: true,
        load: { paths: [pluginDir] },
        entries: { "bad-plugin": { config: { value: "nope" } } },
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const hasIssue = res.issues.some(
        (issue) =>
          issue.path === "plugins.entries.bad-plugin.config" &&
          issue.message.includes("invalid config"),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it("accepts known plugin ids", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: { enabled: false, entries: { discord: { enabled: true } } },
    });
    expect(res.ok).toBe(true);
  });

  it("sanitizes mixed known/unknown plugin ids in allow/deny/slots", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        allow: ["discord", "unknown-plugin-1", "telegram"],
        deny: ["unknown-plugin-2", "slack", "unknown-plugin-3"],
        slots: { memory: "discord" },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Known plugins preserved, unknown filtered
      expect(res.config.plugins?.allow).toEqual(["discord", "telegram"]);
      expect(res.config.plugins?.deny).toEqual(["slack"]);
      expect(res.config.plugins?.slots?.memory).toBe("discord");
      // Warnings for unknown
      expect(res.warnings).toContainEqual({
        path: "plugins.allow",
        message: expect.stringContaining("unknown-plugin-1"),
      });
      expect(res.warnings).toContainEqual({
        path: "plugins.deny",
        message: expect.stringContaining("unknown-plugin-2"),
      });
      expect(res.warnings).toContainEqual({
        path: "plugins.deny",
        message: expect.stringContaining("unknown-plugin-3"),
      });
    }
  });

  it("accepts channels.modelByChannel", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { list: [{ id: "pi" }] },
      channels: {
        modelByChannel: {
          openai: {
            whatsapp: "openai/gpt-5.2",
          },
        },
      },
    });
    expect(res.ok).toBe(true);
  });

  it("accepts plugin heartbeat targets", async () => {
    const home = await createCaseHome();
    const pluginDir = path.join(home, "bluebubbles-plugin");
    await writePluginFixture({
      dir: pluginDir,
      id: "bluebubbles-plugin",
      channels: ["bluebubbles"],
      schema: { type: "object" },
    });

    const res = validateInHome(home, {
      agents: { defaults: { heartbeat: { target: "bluebubbles" } }, list: [{ id: "pi" }] },
      plugins: { enabled: false, load: { paths: [pluginDir] } },
    });
    expect(res.ok).toBe(true);
  });

  it("rejects unknown heartbeat targets", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: { defaults: { heartbeat: { target: "not-a-channel" } }, list: [{ id: "pi" }] },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues).toContainEqual({
        path: "agents.defaults.heartbeat.target",
        message: "unknown heartbeat target: not-a-channel",
      });
    }
  });

  it("accepts heartbeat directPolicy enum values", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: {
        defaults: { heartbeat: { target: "last", directPolicy: "block" } },
        list: [{ id: "pi", heartbeat: { directPolicy: "allow" } }],
      },
    });
    expect(res.ok).toBe(true);
  });

  it("rejects invalid heartbeat directPolicy values", async () => {
    const home = await createCaseHome();
    const res = validateInHome(home, {
      agents: {
        defaults: { heartbeat: { directPolicy: "maybe" } },
        list: [{ id: "pi" }],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const hasIssue = res.issues.some(
        (issue) => issue.path === "agents.defaults.heartbeat.directPolicy",
      );
      expect(hasIssue).toBe(true);
    }
  });
});
