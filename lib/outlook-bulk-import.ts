import { listProviderMailboxes, upsertImportedOutlookMailbox } from "@/lib/provider-store";

export interface OutlookBulkImportRow {
  account: string;
  password: string;
  clientId: string;
  refreshToken: string;
}

export interface OutlookBulkImportResult {
  imported: number;
  updated: number;
  mailboxes: Array<{ id: string; account: string }>;
  errors: string[];
}

const linePattern =
  /^\s*(?<account>.+?)\s*(?<separator>-{1,4})\s*(?<password>.+?)\s*\k<separator>\s*(?<clientId>.+?)\s*\k<separator>\s*(?<refreshToken>.+?)\s*$/;

export function parseOutlookBulkImport(input: string) {
  const rows: OutlookBulkImportRow[] = [];

  for (const [index, rawLine] of input.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(linePattern);
    if (!match?.groups) {
      throw new Error(`第 ${index + 1} 行格式错误，应为：邮箱----密码----client_id----refresh_token`);
    }

    const row = {
      account: match.groups.account.trim(),
      password: match.groups.password.trim(),
      clientId: match.groups.clientId.trim(),
      refreshToken: match.groups.refreshToken.trim(),
    };

    if (!row.account.includes("@")) {
      throw new Error(`第 ${index + 1} 行邮箱格式不正确`);
    }

    rows.push(row);
  }

  if (rows.length === 0) {
    throw new Error("没有可导入的 Outlook 数据");
  }

  return rows;
}

export function saveOutlookBulkImport(input: string): OutlookBulkImportResult {
  const rows = parseOutlookBulkImport(input);
  let imported = 0;
  let updated = 0;

  for (const row of rows) {
    const result = upsertImportedOutlookMailbox(row);
    if (result.updated) {
      updated += 1;
    } else {
      imported += 1;
    }
  }

  const mailboxes = listProviderMailboxes("outlook").map((mailbox) => ({
    id: mailbox.id,
    account: mailbox.account,
  }));

  return {
    imported,
    updated,
    mailboxes,
    errors: [],
  };
}
