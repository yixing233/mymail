const verificationKeywords = [
  "验证码",
  "安全代码",
  "安全码",
  "校验码",
  "动态码",
  "动态密码",
  "登录确认码",
  "确认码",
  "一次性密码",
  "verification code",
  "security code",
  "authentication code",
  "confirmation code",
  "login code",
  "one-time passcode",
  "one time passcode",
  "passcode",
  "otp",
];

const verificationKeywordPattern = new RegExp(`(?:${verificationKeywords.join("|")})`, "i");
const codeCandidatePattern = "(?:[A-Z0-9]{2,4}(?:[\\s-][A-Z0-9]{2,4}){1,3}|[A-Z0-9]{4,10})";
const separatorPattern = "(?:\\s|:|：|=|-|—|–|,|，|。|\\.|;|；|为|是|is|as|your|use|enter|用于|本次|登录|继续|to|continue){0,36}";

const focusedPatterns = [
  new RegExp(`(?:${verificationKeywords.join("|")})${separatorPattern}(${codeCandidatePattern})`, "gi"),
  new RegExp(`(${codeCandidatePattern})${separatorPattern}(?:${verificationKeywords.join("|")})`, "gi"),
];

function normalizeCode(value: string) {
  return value.trim().replace(/[\s-]+/g, "");
}

function isLikelyVerificationCode(value: string) {
  if (!/^[A-Z0-9]{4,10}$/i.test(value)) return false;
  if (/^\d{1,4}$/.test(value)) return false;
  if (/^[A-Z]+$/i.test(value)) return false;
  if (/^20\d{2}\d{2,4}$/.test(value)) return false;
  if (/^(code|passcode|otp)$/i.test(value)) return false;
  return true;
}

export function extractVerificationCodes(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join("\n");
  if (!verificationKeywordPattern.test(text)) {
    return [];
  }

  const matches: string[] = [];
  const seen = new Set<string>();

  for (const pattern of focusedPatterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = normalizeCode(match[2] || match[1] || "");
      if (!isLikelyVerificationCode(candidate)) continue;
      const key = candidate.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(candidate);
    }
  }

  if (matches.length) {
    return matches;
  }

  for (const match of text.matchAll(/\b(?:[A-Z0-9]{2,4}(?:[\s-][A-Z0-9]{2,4}){1,3}|[A-Z0-9]{4,10})\b/gi)) {
    const candidate = normalizeCode(match[0]);
    if (!isLikelyVerificationCode(candidate)) continue;
    const index = match.index ?? 0;
    const nearby = text.slice(Math.max(0, index - 32), Math.min(text.length, index + 32));
    if (!verificationKeywordPattern.test(nearby)) continue;
    const key = candidate.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(candidate);
  }

  return matches;
}
