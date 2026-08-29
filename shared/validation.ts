import { z } from 'zod';

import { lotteryKinds, type LotteryKind, type SubmitLotteryInput } from './models';

export const X_ID_PATTERN = /^@?[A-Za-z0-9_]{1,15}$/;
export const VRC_NAME_MAX_LENGTH = 32;

export const normalizeXId = (value: string): string => {
  const trimmed = value.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return `@${withoutAt}`;
};

export const normalizeXIdForComparison = (value: string): string =>
  normalizeXId(value).toLowerCase();

const xIdSchema = z
  .string()
  .trim()
  .min(1, 'X IDを入力してください')
  .refine((value) => X_ID_PATTERN.test(value), 'X IDは英数字とアンダースコアを1〜15文字で入力してください')
  .transform(normalizeXId);

const vrcNameSchema = z
  .string()
  .trim()
  .min(1, '代表者のVRC名を入力してください')
  .max(VRC_NAME_MAX_LENGTH, `VRC名は${VRC_NAME_MAX_LENGTH}文字以内で入力してください`);

export const submitLotterySchema = z
  .object({
    kind: z.enum(lotteryKinds),
    representativeId: xIdSchema,
    representativeVrcName: vrcNameSchema,
    companionVrcName: z.string().trim().max(VRC_NAME_MAX_LENGTH, `同行者のVRC名は${VRC_NAME_MAX_LENGTH}文字以内で入力してください`).optional().default(''),
    token: z.string().min(32).max(256),
  })
  .superRefine((value, context) => {
    if (value.kind === 'counter' && !value.companionVrcName) {
      context.addIssue({
        code: 'custom',
        path: ['companionVrcName'],
        message: 'カウンター応募には同行者のVRC名が必要です',
      });
    }
  })
  .transform((value): SubmitLotteryInput => ({
    kind: value.kind,
    representativeId: normalizeXId(value.representativeId),
    representativeVrcName: value.representativeVrcName,
    companionVrcName: value.companionVrcName || undefined,
    token: value.token,
  }));

export const validateWinnerSlots = (
  kind: LotteryKind,
  requested: number,
  entries: number,
): string | null => {
  if (!Number.isInteger(requested) || requested < 0) return '当選組数は0以上の整数で入力してください';
  if (requested > entries) {
    const labels: Record<LotteryKind, string> = { counter: 'カウンター', private: '個室', table: 'テーブル席' };
    return `${labels[kind]}の応募組数を超える当選数は設定できません`;
  }
  return null;
};
