import { describe, expect, it } from "vitest";
import { buildOutlookRefreshParams, getOutlookImapScopes, shouldUseOutlookRefreshScopes } from "@/lib/provider-sync";

describe("Outlook refresh params", () => {
  it("omits client_secret when no secret is available", () => {
    const params = buildOutlookRefreshParams({
      clientId: "client-id",
      refreshToken: "refresh-token",
    });

    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("refresh_token")).toBe("refresh-token");
    expect(params.get("client_secret")).toBeNull();
    expect(params.get("scope")).toBeNull();
  });

  it("includes client_secret when a real secret value is provided", () => {
    const params = buildOutlookRefreshParams({
      clientId: "client-id",
      clientSecret: "secret-value",
      refreshToken: "refresh-token",
      scopes: ["openid", "offline_access", "https://graph.microsoft.com/Mail.Read"],
    });

    expect(params.get("client_secret")).toBe("secret-value");
  });

  it("includes scope only when explicitly provided", () => {
    const params = buildOutlookRefreshParams({
      clientId: "client-id",
      refreshToken: "refresh-token",
      scopes: ["https://graph.microsoft.com/Mail.Read"],
    });

    expect(params.get("scope")).toBe("https://graph.microsoft.com/Mail.Read");
  });

  it("keeps scopes for imported Outlook accounts using their own client id when scopes are stored", () => {
    expect(
      shouldUseOutlookRefreshScopes({
        payloadClientId: "imported-client-id",
        builtinClientId: "builtin-client-id",
        payloadScopes: ["openid", "offline_access", "https://graph.microsoft.com/Mail.Read"],
      }),
    ).toBe(true);
  });

  it("skips scopes only when imported Outlook account has no stored scopes", () => {
    expect(
      shouldUseOutlookRefreshScopes({
        payloadClientId: "imported-client-id",
        builtinClientId: "builtin-client-id",
        payloadScopes: undefined,
      }),
    ).toBe(false);
  });

  it("keeps scopes for builtin Outlook OAuth accounts", () => {
    expect(
      shouldUseOutlookRefreshScopes({
        payloadClientId: "builtin-client-id",
        builtinClientId: "builtin-client-id",
      }),
    ).toBe(true);
  });

  it("uses IMAP OAuth scopes for imported Outlook IMAP accounts", () => {
    expect(getOutlookImapScopes()).toEqual([
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "offline_access",
    ]);
  });
});
