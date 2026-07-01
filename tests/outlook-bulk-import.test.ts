import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { parseOutlookBulkImport, saveOutlookBulkImport } from "@/lib/outlook-bulk-import";
import { getMailboxConfig, getProviderPayload, getProviderSecrets, listProviderMailboxes } from "@/lib/provider-store";

describe("Outlook bulk import", () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM providers").run();
  });

  it("parses seller formatted lines into Outlook import rows", () => {
    const rows = parseOutlookBulkImport(`
user1@outlook.com----pass-one----client-one----refresh-one
user2@outlook.com--pass-two--client-two--refresh-two
    `);

    expect(rows).toEqual([
      {
        account: "user1@outlook.com",
        password: "pass-one",
        clientId: "client-one",
        refreshToken: "refresh-one",
      },
      {
        account: "user2@outlook.com",
        password: "pass-two",
        clientId: "client-two",
        refreshToken: "refresh-two",
      },
    ]);
  });

  it("stores imported Outlook rows as IMAP mailboxes with per-mailbox credentials", () => {
    const result = saveOutlookBulkImport(`
user1@outlook.com----pass-one----client-one----refresh-one
user2@outlook.com----pass-two----client-two----refresh-two
    `);

    expect(result.imported).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.mailboxes).toHaveLength(2);

    const firstMailbox = result.mailboxes.find((mailbox) => mailbox.account === "user1@outlook.com");
    expect(firstMailbox).toBeDefined();
    const config = getMailboxConfig("outlook", firstMailbox!.id);
    const payload = getProviderPayload("outlook", firstMailbox!.id);
    const secrets = getProviderSecrets("outlook", firstMailbox!.id);

    expect(config.mode).toBe("imap");
    expect(payload.clientId).toBe("client-one");
    expect(secrets.refreshToken).toBe("refresh-one");
    expect(secrets.password).toBe("pass-one");
  });

  it("updates existing Outlook mailbox tokens when account is re-imported", () => {
    saveOutlookBulkImport("user1@outlook.com----pass-one----client-one----refresh-one");

    const result = saveOutlookBulkImport("user1@outlook.com----pass-next----client-next----refresh-next");

    expect(result.imported).toBe(0);
    expect(result.updated).toBe(1);
    expect(listProviderMailboxes("outlook")).toHaveLength(1);

    const mailbox = listProviderMailboxes("outlook")[0];
    const payload = getProviderPayload("outlook", mailbox.id);
    const secrets = getProviderSecrets("outlook", mailbox.id);

    expect(payload.clientId).toBe("client-next");
    expect(secrets.refreshToken).toBe("refresh-next");
    expect(secrets.password).toBe("pass-next");
  });
});
