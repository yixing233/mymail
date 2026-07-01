import { describe, expect, it } from "vitest";
import { getMessageDetail, upsertMessages } from "@/lib/provider-store";

describe("message detail html rendering", () => {
  it("keeps original image-heavy html email layout styles", () => {
    const messageId = "outlook-layout-test";
    upsertMessages("outlook-layout-box", "outlook", [
      {
        id: messageId,
        providerId: "outlook",
        mailboxId: "outlook-layout-box",
        providerLabel: "Outlook",
        from: "Outlook Team <noreply@microsoft.com>",
        subject: "Welcome",
        preview: "Preview",
        receivedAt: "2026-06-05T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Preview",
        html: `<center><table role="presentation" style="width: 640px;border-collapse: collapse;" cellspacing="0" cellpadding="0" bgcolor="#F1F1F1"><tbody><tr><td colspan="2" style="height:52px;text-align:center"><img src="https://example.com/logo.png" width="116"></td></tr><tr><td colspan="2" style="padding:0 0 0 28px"><table style="width:100%"><tbody><tr><td style="padding:0 0 0 36px;text-align:left;width:270px"><div style="font-size:40px">Hi</div></td><td style="text-align:center"><img style="width:320px;max-width:320px" width="320" src="https://example.com/hero.png"></td></tr></tbody></table></td></tr></tbody></table></center>`,
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain("<table");
    expect(detail!.html).toContain("<img");
    expect(detail!.html).toContain("width: 640px");
    expect(detail!.html).toContain("width:320px");
    expect(detail!.html).toContain(' width="320"');
    expect(detail!.html).toContain(' width="116"');
    expect(detail!.html).toContain("<center>");
  });

  it("preserves standard single-column email table widths", () => {
    const messageId = "standard-layout-test";
    upsertMessages("standard-layout-box", "outlook", [
      {
        id: messageId,
        providerId: "outlook",
        mailboxId: "standard-layout-box",
        providerLabel: "Outlook",
        from: '"宝可梦" <52pokemon@52pokemon88.cc>',
        subject: "标准模板",
        preview: "到期提醒",
        receivedAt: "2026-06-05T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "到期提醒",
        html: `<tr><td></td><td class="container" width="600" valign="top" style="display:block!important; max-width:600px!important; clear:both!important; margin:0 auto"><div class="content" style="max-width:600px; display:block; margin:0 auto; padding:20px"><table class="main" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fff" style="border-radius:3px; background-color:#fff; margin:0; border:1px solid #e9e9e9"><tbody><tr><td class="alert alert-warning" align="center" bgcolor="#0073ba" valign="top" style="font-size:22px; text-align:center; padding:20px">到期提示</td></tr><tr><td class="content-wrap" valign="top" style="padding:20px"><table width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td class="content-block" valign="top" style="font-size:34px; line-height:1em; padding:20px 0 30px">Dear Customer</td></tr></tbody></table></td></tr></tbody></table></div></td><td></td></tr>`,
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain('class="container"');
    expect(detail!.html).toContain("max-width:600px!important");
    expect(detail!.html).toContain('class="main"');
    expect(detail!.html).toContain(' width="100%"');
  });

  it("does not inject character-level wrapping into normal email words", () => {
    const messageId = "word-wrap-test";
    upsertMessages("word-wrap-box", "outlook", [
      {
        id: messageId,
        providerId: "outlook",
        mailboxId: "word-wrap-box",
        providerLabel: "Outlook",
        from: '"宝可梦" <52pokemon@52pokemon88.cc>',
        subject: "单词换行",
        preview: "Dear Customer",
        receivedAt: "2026-06-05T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Dear Customer",
        html: `<table width="100%"><tbody><tr><td style="font-size:34px; line-height:1em; padding:20px 0 30px">Dear Customer</td></tr></tbody></table>`,
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain("Dear Customer");
    expect(detail!.html).not.toContain("overflow-wrap:anywhere");
  });

  it("preserves embedded style tags from full html emails", () => {
    const messageId = "full-html-style-test";
    const html = `<!doctype html><html><head><style>.title{color:#d00;font-size:28px}</style></head><body><p class="title">Styled title</p></body></html>`;
    upsertMessages("full-html-style-box", "outlook", [
      {
        id: messageId,
        providerId: "outlook",
        mailboxId: "full-html-style-box",
        providerLabel: "Outlook",
        from: "sender@example.com",
        subject: "Styled",
        preview: "Styled title",
        receivedAt: "2026-06-05T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Styled title",
        html,
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toBe(html);
  });

  it("falls back to text html when stored html content is the literal false string", () => {
    const messageId = "false-html-fallback-test";
    upsertMessages("qq-false-box", "qq", [
      {
        id: messageId,
        providerId: "qq",
        mailboxId: "qq-false-box",
        providerLabel: "QQ Mail",
        from: "sender@example.com",
        subject: "False html",
        preview: "Real preview",
        receivedAt: "2026-06-11T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Real body text",
        html: "false",
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain("Real body text");
    expect(detail!.html).not.toBe("false");
  });

  it("renders plain-text fallback as paragraphs instead of one long line", () => {
    const messageId = "plain-text-paragraph-test";
    upsertMessages("qq-plain-box", "qq", [
      {
        id: messageId,
        providerId: "qq",
        mailboxId: "qq-plain-box",
        providerLabel: "QQ Mail",
        from: "sender@example.com",
        subject: "Plain text",
        preview: "Hey yixing233!",
        receivedAt: "2026-06-11T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: [
          "Hey yixing233!",
          "",
          "Visit https://github.com/settings/security-log for more information.",
          "",
          "Thanks,",
          "The GitHub Team",
        ].join("\n"),
        html: "",
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain("<p>Hey yixing233!</p>");
    expect(detail!.html).toContain("<p>Thanks,<br />The GitHub Team</p>");
  });

  it("linkifies urls in plain-text fallback html", () => {
    const messageId = "plain-text-linkify-test";
    upsertMessages("qq-link-box", "qq", [
      {
        id: messageId,
        providerId: "qq",
        mailboxId: "qq-link-box",
        providerLabel: "QQ Mail",
        from: "sender@example.com",
        subject: "Plain text links",
        preview: "Visit https://github.com/contact",
        receivedAt: "2026-06-11T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Visit https://github.com/contact",
        html: "",
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain('href="https://github.com/contact"');
    expect(detail!.html).toContain('target="_blank"');
    expect(detail!.html).toContain('rel="noopener noreferrer"');
  });

  it("treats html content without any html tags as plain text fallback", () => {
    const messageId = "plain-text-html-string-test";
    upsertMessages("qq-html-string-box", "qq", [
      {
        id: messageId,
        providerId: "qq",
        mailboxId: "qq-html-string-box",
        providerLabel: "QQ Mail",
        from: "sender@example.com",
        subject: "Plain text html string",
        preview: "Hey yixing233!",
        receivedAt: "2026-06-11T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Hey yixing233!\n\nVisit https://github.com/contact\n\nThanks,\nThe GitHub Team",
        html: "Hey yixing233! Visit https://github.com/contact Thanks, The GitHub Team",
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain("<p>Hey yixing233!</p>");
    expect(detail!.html).toContain('href="https://github.com/contact"');
    expect(detail!.html).toContain("<p>Thanks,<br />The GitHub Team</p>");
  });

  it("re-renders legacy single-paragraph wrapper fallback html as rich plain text", () => {
    const messageId = "legacy-wrapper-fallback-test";
    upsertMessages("qq-legacy-wrapper-box", "qq", [
      {
        id: messageId,
        providerId: "qq",
        mailboxId: "qq-legacy-wrapper-box",
        providerLabel: "QQ Mail",
        from: "sender@example.com",
        subject: "Legacy wrapper fallback",
        preview: "Hey yixing233!",
        receivedAt: "2026-06-11T00:00:00.000Z",
        unread: true,
        hasAttachments: false,
        tags: [],
        attachments: [],
        text: "Hey yixing233!\n\nVisit https://github.com/contact\n\nThanks,\nThe GitHub Team",
        html: "<div><p>Hey yixing233!\n\nVisit https://github.com/contact\n\nThanks,\nThe GitHub Team\n</p></div>",
      },
    ]);

    const detail = getMessageDetail(messageId);

    expect(detail).toBeDefined();
    expect(detail!.html).toContain("<p>Hey yixing233!</p>");
    expect(detail!.html).toContain('href="https://github.com/contact"');
    expect(detail!.html).toContain("<p>Thanks,<br />The GitHub Team</p>");
  });
});
