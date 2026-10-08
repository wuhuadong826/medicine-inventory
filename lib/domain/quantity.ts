import type { QuantityInput } from "./types";

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function chineseInteger(raw: string): number {
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const mixedArabic = raw.replace(/[^\d.]/g, "");
  if (mixedArabic) return Number(mixedArabic);
  let result = 0;
  let current = 0;
  for (const char of raw) {
    if (char === "十") {
      result += (current || 1) * 10;
      current = 0;
    } else if (char in CN_DIGITS) current = CN_DIGITS[char];
  }
  return result + current;
}

export function parseFriendlyQuantity(
  input: string,
  unitsPerBox: number,
  precision = 0,
): QuantityInput {
  const normalized = input.trim().replace(/\s+/g, "").replace(/[，,]/g, "");
  if (!normalized) throw new Error("请输入数量");
  const boxMatch = normalized.match(/([\d.零〇一二两三四五六七八九十]+)\s*(?:盒|瓶)/);
  const looseMatch = normalized.match(/([\d.零〇一二两三四五六七八九十]+)\s*(?:粒|片|袋|支|丸|毫升|ml|单位)/i);
  let boxes = boxMatch ? chineseInteger(boxMatch[1]) : 0;
  let loose = looseMatch ? chineseInteger(looseMatch[1]) : 0;
  if (!boxMatch && !looseMatch) loose = chineseInteger(normalized);
  if (![boxes, loose, unitsPerBox].every(Number.isFinite) || boxes < 0 || loose < 0 || unitsPerBox <= 0) {
    throw new Error("数量格式不正确");
  }
  if (!Number.isInteger(boxes)) throw new Error("盒数必须是整数");
  const factor = 10 ** precision;
  const rawTotal = boxes * unitsPerBox + loose;
  if (Math.abs(rawTotal * factor - Math.round(rawTotal * factor)) > 1e-9) {
    throw new Error(`数量最多保留 ${precision} 位小数`);
  }
  const total = Math.round(rawTotal * factor) / factor;
  return { boxes, loose, total };
}

export function formatQuantity(total: number, unitsPerBox: number, unitName: string) {
  if (!Number.isFinite(total)) return "—";
  const boxes = Math.floor(total / unitsPerBox);
  const loose = Number((total - boxes * unitsPerBox).toFixed(3));
  if (boxes > 0 && loose > 0) return `${boxes}盒零${loose}${unitName}`;
  if (boxes > 0) return `${boxes}盒`;
  return `${loose}${unitName}`;
}

export function makeIdempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}
