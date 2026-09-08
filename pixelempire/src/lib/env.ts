/** Environment access. Lazy on purpose: a missing secret must fail the request
 *  that needs it, not the whole build. */

const read = (key: string, fallback?: string): string => {
  const value = process.env[key];
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const bool = (key: string, fallback = false): boolean => {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
};

export const isProduction = (): boolean => process.env.NODE_ENV === "production";
export const isTest = (): boolean => process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const env = {
  get databaseUrl() {
    return read("DATABASE_URL");
  },
  get appUrl() {
    return read("NEXT_PUBLIC_APP_URL", "http://localhost:3000").replace(/\/+$/, "");
  },
  get appName() {
    return read("NEXT_PUBLIC_APP_NAME", "PixelEmpire");
  },
  get authSecret() {
    const secret = read("AUTH_SECRET");
    if (secret.length < 32) {
      throw new Error("AUTH_SECRET must be at least 32 characters");
    }
    return secret;
  },
  get razorpayKeyId() {
    return read("RAZORPAY_KEY_ID");
  },
  get razorpayKeySecret() {
    return read("RAZORPAY_KEY_SECRET");
  },
  get razorpayWebhookSecret() {
    return read("RAZORPAY_WEBHOOK_SECRET");
  },
  get publicRazorpayKeyId() {
    return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "";
  },
  get emailProvider() {
    return read("EMAIL_PROVIDER", "console");
  },
  get emailFrom() {
    return read("EMAIL_FROM", "PixelEmpire <login@pixelempire.example>");
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY ?? "";
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get logLevel() {
    return read("LOG_LEVEL", "info");
  },
};

/** V2 mechanics (§32). All false in V1; nothing gated by these renders. */
export const featureFlags = {
  get battles() {
    return bool("BATTLES_ENABLED");
  },
  get expansion() {
    return bool("EXPANSION_ENABLED");
  },
  get powerScore() {
    return bool("POWER_SCORE_ENABLED");
  },
  get empireLevels() {
    return bool("EMPIRE_LEVELS_ENABLED");
  },
  get premiumLand() {
    return bool("PREMIUM_LAND_ENABLED");
  },
  get sponsoredLand() {
    return bool("SPONSORED_LAND_ENABLED");
  },
};
