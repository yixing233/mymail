import { describe, expect, it, vi } from "vitest";
import { openUrlInChrome, parseChromeProfiles } from "@/lib/chrome";

describe("openUrlInChrome", () => {
  it("launches Chrome as a detached process with the OAuth URL", () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    const result = openUrlInChrome("https://accounts.google.com/o/oauth2/v2/auth?client_id=demo", {
      existsSync: () => true,
      spawn,
      env: {
        PROGRAMFILES: "C:\\Program Files",
      },
    });

    expect(result.opened).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      ["https://accounts.google.com/o/oauth2/v2/auth?client_id=demo"],
      { detached: true, stdio: "ignore" },
    );
    expect(unref).toHaveBeenCalledOnce();
  });

  it("returns a fallback result when Chrome cannot be launched", () => {
    const result = openUrlInChrome("https://accounts.google.com/o/oauth2/v2/auth?client_id=demo", {
      existsSync: () => false,
      spawn: vi.fn(() => {
        throw new Error("not found");
      }),
      env: {},
    });

    expect(result.opened).toBe(false);
    expect(result.error).toContain("Chrome");
  });

  it("falls back to the chrome command when no known executable path exists", () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    const result = openUrlInChrome("https://accounts.google.com/o/oauth2/v2/auth?client_id=demo", {
      existsSync: () => false,
      spawn,
      env: {},
    });

    expect(result.opened).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "chrome",
      ["https://accounts.google.com/o/oauth2/v2/auth?client_id=demo"],
      { detached: true, stdio: "ignore" },
    );
  });

  it("launches Chrome with the selected profile directory", () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));

    const result = openUrlInChrome("https://accounts.google.com/o/oauth2/v2/auth?client_id=demo", {
      existsSync: () => true,
      spawn,
      env: {
        PROGRAMFILES: "C:\\Program Files",
      },
      profileDirectory: "Profile 1",
    });

    expect(result.opened).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      ["--profile-directory=Profile 1", "https://accounts.google.com/o/oauth2/v2/auth?client_id=demo"],
      { detached: true, stdio: "ignore" },
    );
  });
});

describe("parseChromeProfiles", () => {
  it("reads Chrome profile labels, emails, order, and last used profile", () => {
    const profiles = parseChromeProfiles(JSON.stringify({
      profile: {
        last_used: "Profile 1",
        profiles_order: ["Default", "Profile 1"],
        info_cache: {
          Default: {
            name: "Default User",
            user_name: "default@example.com",
            shortcut_name: "Default",
          },
          "Profile 1": {
            name: "Work",
            user_name: "work@example.com",
            gaia_name: "Work Account",
            shortcut_name: "Work",
          },
        },
      },
    }));

    expect(profiles).toEqual([
      {
        directory: "Default",
        name: "Default User",
        email: "default@example.com",
        label: "Default User <default@example.com>",
        isLastUsed: false,
      },
      {
        directory: "Profile 1",
        name: "Work",
        email: "work@example.com",
        label: "Work <work@example.com>",
        isLastUsed: true,
      },
    ]);
  });
});
