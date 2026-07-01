import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync as nodeExistsSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

type SpawnFn = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore" },
) => Pick<ChildProcess, "unref">;

type ChromeEnv = Record<string, string | undefined>;

interface ChromeLauncherDeps {
  env?: ChromeEnv;
  existsSync?: (filePath: string) => boolean;
  spawn?: SpawnFn;
  profileDirectory?: string;
}

export interface ChromeLaunchResult {
  opened: boolean;
  error?: string;
}

export interface ChromeProfile {
  directory: string;
  name: string;
  email: string;
  label: string;
  isLastUsed: boolean;
}

interface ChromeLocalStateProfileEntry {
  name?: unknown;
  user_name?: unknown;
  shortcut_name?: unknown;
  gaia_name?: unknown;
}

function getChromeCandidates(env: ChromeEnv) {
  return [
    env.PROGRAMFILES,
    env["PROGRAMFILES(X86)"],
    env.LOCALAPPDATA,
  ]
    .filter((value): value is string => Boolean(value))
    .map((basePath) => path.join(basePath, "Google", "Chrome", "Application", "chrome.exe"));
}

function getChromeUserDataPath(env: ChromeEnv) {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Google", "Chrome", "User Data") : null;
}

function toOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildProfileLabel(name: string, email: string, directory: string) {
  const displayName = name || directory;
  return email ? `${displayName} <${email}>` : displayName;
}

function isSafeOAuthUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com";
  } catch {
    return false;
  }
}

export function parseChromeProfiles(localStateJson: string): ChromeProfile[] {
  const localState = JSON.parse(localStateJson) as {
    profile?: {
      info_cache?: Record<string, ChromeLocalStateProfileEntry>;
      last_used?: string;
      profiles_order?: string[];
    };
  };
  const infoCache = localState.profile?.info_cache ?? {};
  const lastUsed = localState.profile?.last_used ?? "";
  const orderedDirectories = localState.profile?.profiles_order?.length
    ? localState.profile.profiles_order
    : Object.keys(infoCache);

  return orderedDirectories
    .filter((directory) => infoCache[directory])
    .map((directory) => {
      const entry = infoCache[directory];
      const name =
        toOptionalString(entry.name) ||
        toOptionalString(entry.shortcut_name) ||
        toOptionalString(entry.gaia_name) ||
        directory;
      const email = toOptionalString(entry.user_name);
      return {
        directory,
        name,
        email,
        label: buildProfileLabel(name, email, directory),
        isLastUsed: directory === lastUsed,
      };
    });
}

export function listChromeProfiles(env: ChromeEnv = process.env as ChromeEnv): ChromeProfile[] {
  const userDataPath = getChromeUserDataPath(env);
  if (!userDataPath) return [];

  const localStatePath = path.join(userDataPath, "Local State");
  if (!nodeExistsSync(localStatePath)) return [];

  try {
    return parseChromeProfiles(readFileSync(localStatePath, "utf8"));
  } catch {
    return [];
  }
}

export function openUrlInChrome(url: string, deps: ChromeLauncherDeps = {}): ChromeLaunchResult {
  if (!isSafeOAuthUrl(url)) {
    return { opened: false, error: "Invalid Gmail OAuth URL" };
  }

  const env = deps.env ?? (process.env as ChromeEnv);
  const existsSync = deps.existsSync ?? nodeExistsSync;
  const spawn = deps.spawn ?? nodeSpawn;
  const chromePath = getChromeCandidates(env).find((candidate) => existsSync(candidate)) ?? "chrome";
  const args = deps.profileDirectory
    ? [`--profile-directory=${deps.profileDirectory}`, url]
    : [url];

  try {
    const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
    child.unref();
    return { opened: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Chrome launch error";
    return { opened: false, error: `Chrome launch failed: ${message}` };
  }
}
