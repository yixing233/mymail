import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function resetDbModule() {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.MYMAIL_DB_PATH;
  delete process.env.MYMAIL_DATA_DIR;
  delete process.env.VITEST;
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
}

async function loadDbModule() {
  return import("@/lib/db");
}

describe("database path resolution", () => {
  afterEach(() => {
    resetDbModule();
  });

  it("prefers MYMAIL_DB_PATH when provided", async () => {
    process.env.MYMAIL_DB_PATH = "/tmp/custom/location.sqlite";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe("/tmp/custom/location.sqlite");
  });

  it("uses MYMAIL_DATA_DIR when MYMAIL_DB_PATH is absent", async () => {
    process.env.MYMAIL_DATA_DIR = "/var/lib/mymail";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe(path.join("/var/lib/mymail", "mymail.db"));
  });

  it("uses in-memory storage in test mode when no explicit path is configured", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe(":memory:");
  });

  it("falls back to the repository data directory outside test mode", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const { resolveDbPath } = await loadDbModule();

    expect(resolveDbPath()).toBe(path.join(process.cwd(), "data", "mymail.db"));
  });
});
