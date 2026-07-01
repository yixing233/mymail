import { describe, expect, it } from "vitest";
import { extractVerificationCodes } from "@/lib/verification";

describe("extractVerificationCodes", () => {
  it("extracts common Chinese verification code formats", () => {
    expect(extractVerificationCodes("登录确认码：839 204，5分钟内有效")).toEqual(["839204"]);
    expect(extractVerificationCodes("您的动态密码为 71-36-90，请勿泄露")).toEqual(["713690"]);
    expect(extractVerificationCodes("安全码 AB12CD 用于本次登录")).toEqual(["AB12CD"]);
  });

  it("extracts common English OTP and passcode formats", () => {
    expect(extractVerificationCodes("Your one-time passcode is 482-913. It expires soon.")).toEqual(["482913"]);
    expect(extractVerificationCodes("Use OTP: q7k9m2 to continue")).toEqual(["q7k9m2"]);
    expect(extractVerificationCodes("Enter 884211 as your verification code.")).toEqual(["884211"]);
  });

  it("deduplicates codes and ignores nearby non-code noise", () => {
    expect(extractVerificationCodes("验证码 123456，有效期至 2026-06-08 00:18。再次输入 123 456。")).toEqual(["123456"]);
    expect(extractVerificationCodes("Your order code AB-2026-0608 was shipped.")).toEqual([]);
  });
});
