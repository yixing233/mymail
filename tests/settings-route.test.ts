import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { POST } from "@/app/api/settings/route";

describe("settings backup actions", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
    db.prepare("DELETE FROM app_settings").run();
  });

  it("returns a backup payload for exportBackup", async () => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "exportBackup" }),
    }) as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.version).toBe(1);
    expect(Array.isArray(payload.providers)).toBe(true);
  });

  it("imports a backup payload for importBackup", async () => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "importBackup",
        mode: "replace",
        payload: {
          version: 1,
          exportedAt: "2026-06-11T10:00:00.000Z",
          appSettings: [],
          providers: [],
          messages: [],
        },
      }),
    }) as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, mode: "replace" });
  });

  it("rejects invalid import modes", async () => {
    const response = await POST(new Request("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "importBackup",
        mode: "invalid",
        payload: {
          version: 1,
          exportedAt: "2026-06-11T10:00:00.000Z",
          appSettings: [],
          providers: [],
          messages: [],
        },
      }),
    }) as never);

    expect(response.status).toBe(400);
  });
});
