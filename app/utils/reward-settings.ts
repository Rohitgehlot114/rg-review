export const REWARD_TRIGGERS = ["published", "published_verified"] as const;
export const DISCOUNT_TYPES = ["percentage", "fixed"] as const;
export const EXPIRATION_CHOICES = ["7", "14", "30", "60", "90", "never"] as const;

export type RewardTrigger = (typeof REWARD_TRIGGERS)[number];
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export type RewardSettingsInput = {
  enabled: boolean;
  trigger: RewardTrigger;
  discountType: DiscountType;
  discountValue: string;
  expirationDays: string;
  minimumPurchase: string;
  usageLimit: string;
  onePerCustomer: boolean;
};

export type ParsedRewardSettings = {
  enabled: boolean;
  trigger: RewardTrigger;
  discountType: DiscountType;
  discountValue: number;
  expirationDays: number | null;
  minimumPurchase: number | null;
  usageLimit: number;
  onePerCustomer: boolean;
};

export const EMPTY_REWARD_SETTINGS: RewardSettingsInput = {
  enabled: false,
  trigger: "published",
  discountType: "percentage",
  discountValue: "",
  expirationDays: "30",
  minimumPurchase: "",
  usageLimit: "1",
  onePerCustomer: true,
};

const MAX_USAGE_LIMIT = 10000;

function isTrigger(value: string): value is RewardTrigger {
  return REWARD_TRIGGERS.some((trigger) => trigger === value);
}

function isDiscountType(value: string): value is DiscountType {
  return DISCOUNT_TYPES.some((type) => type === value);
}

function parsePositiveDecimal(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function parseRewardSettings(
  input: RewardSettingsInput,
): { ok: true; settings: ParsedRewardSettings } | { ok: false; error: string } {
  if (!isTrigger(input.trigger)) {
    return { ok: false, error: "Choose a valid reward trigger." };
  }
  if (!isDiscountType(input.discountType)) {
    return { ok: false, error: "Choose a valid discount type." };
  }
  if (!EXPIRATION_CHOICES.some((choice) => choice === input.expirationDays)) {
    return { ok: false, error: "Choose a valid coupon expiration." };
  }

  const usageParsed = Number.parseInt(input.usageLimit.trim(), 10);
  if (
    !Number.isFinite(usageParsed) ||
    usageParsed < 1 ||
    usageParsed > MAX_USAGE_LIMIT
  ) {
    return {
      ok: false,
      error: "Usage limit must be a whole number from 1 to 10000.",
    };
  }

  const minimumRaw = input.minimumPurchase.trim();
  let minimumPurchase: number | null = null;
  if (minimumRaw) {
    minimumPurchase = parsePositiveDecimal(minimumRaw);
    if (minimumPurchase === null) {
      return {
        ok: false,
        error: "Minimum purchase must be a positive amount with up to 2 decimals.",
      };
    }
  }

  const valueRaw = input.discountValue.trim();
  let discountValue = 0;
  if (input.enabled || valueRaw) {
    const parsed = parsePositiveDecimal(valueRaw);
    if (parsed === null) {
      return {
        ok: false,
        error: "Discount value must be a positive number with up to 2 decimals.",
      };
    }
    if (input.discountType === "percentage" && parsed > 100) {
      return { ok: false, error: "Percentage discounts cannot be more than 100." };
    }
    discountValue = parsed;
  }

  if (input.enabled && discountValue <= 0) {
    return { ok: false, error: "Enter a discount value before enabling rewards." };
  }

  return {
    ok: true,
    settings: {
      enabled: input.enabled,
      trigger: input.trigger,
      discountType: input.discountType,
      discountValue,
      expirationDays:
        input.expirationDays === "never" ? null : Number(input.expirationDays),
      minimumPurchase,
      usageLimit: usageParsed,
      onePerCustomer: input.onePerCustomer,
    },
  };
}
