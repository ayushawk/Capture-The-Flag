import { z } from "zod";

/** Slugs that would collide with a route or read as official. */
export const RESERVED_SLUGS = new Set([
  "api", "admin", "map", "login", "logout", "signin", "signup", "auth", "me",
  "empire", "empires", "plot", "plots", "leaderboard", "activity", "about",
  "faq", "terms", "privacy", "support", "help", "settings", "claim", "share",
  "pixelempire", "official", "staff", "system", "root", "null", "undefined",
  "new", "edit", "delete", "static", "_next", "assets", "public", "og",
]);

/**
 * URL-safe slug. Non-ASCII is folded away rather than percent-encoded, so the
 * result is always readable and always route-safe.
 */
export const slugify = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

/**
 * Strips control characters and collapses whitespace. Stored as plain text and
 * rendered by React, which escapes it — no HTML ever reaches a template.
 */
export const cleanText = (input: string): string =>
  input
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Accepts `@name`, `name`, or a full x.com / twitter.com profile URL. */
export const normaliseXUsername = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const fromUrl = trimmed.match(
    /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i,
  );
  const handle = (fromUrl ? fromUrl[1]! : trimmed).replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
};

/** http/https only: blocks `javascript:`, `data:` and friends at the source. */
export const safeUrl = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (/[\u0000-\u001f\s]/.test(trimmed)) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".")) return null;
  if (url.href.length > 500) return null;
  return url.href;
};

/** Optional free text: empty string and null both mean "clear this field". */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} must be ${max} characters or fewer`)
    .nullish()
    .transform((value) => {
      if (value == null) return null;
      const cleaned = cleanText(value);
      return cleaned === "" ? null : cleaned;
    });

/** Optional URL field that reports a real error instead of silently blanking. */
const optionalUrl = (label: string) =>
  z
    .string()
    .max(500)
    .nullish()
    .transform((value, ctx) => {
      if (value == null || value.trim() === "") return null;
      const url = safeUrl(value);
      if (url === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a valid http(s) address`,
        });
        return z.NEVER;
      }
      return url;
    });

export const empireNameSchema = z
  .string()
  .transform(cleanText)
  .pipe(
    z
      .string()
      .min(2, "Empire name must be at least 2 characters")
      .max(40, "Empire name must be 40 characters or fewer"),
  );

export const empireSlugSchema = z
  .string()
  .transform((value) => slugify(value))
  .pipe(
    z
      .string()
      .min(3, "Address must be at least 3 characters")
      .max(40, "Address must be 40 characters or fewer")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens"),
  )
  .refine((value) => !RESERVED_SLUGS.has(value), { message: "That address is reserved" });

export const updateEmpireSchema = z
  .object({
    name: empireNameSchema.optional(),
    slug: empireSlugSchema.optional(),
    description: optionalText(280, "Description").optional(),
    xUsername: z
      .string()
      .max(120)
      .nullish()
      .transform((value, ctx) => {
        if (value == null || value.trim() === "") return null;
        const handle = normaliseXUsername(value);
        if (handle === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Use an X handle like @pixelempire",
          });
          return z.NEVER;
        }
        return handle;
      })
      .optional(),
    websiteUrl: optionalUrl("Website").optional(),
    avatarUrl: optionalUrl("Avatar URL").optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export type UpdateEmpireInput = z.infer<typeof updateEmpireSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

export const uuidSchema = z.string().uuid("Expected a valid id");

export const createPurchaseSchema = z.object({
  plotId: uuidSchema,
});

export const verifyPaymentSchema = z.object({
  purchaseId: uuidSchema,
  razorpayOrderId: z.string().min(1).max(200),
  razorpayPaymentId: z.string().min(1).max(200),
  razorpaySignature: z.string().min(1).max(500),
});

export const mapQuerySchema = z
  .object({
    minX: z.coerce.number().int().min(0).max(99).default(0),
    minY: z.coerce.number().int().min(0).max(99).default(0),
    maxX: z.coerce.number().int().min(0).max(99).default(99),
    maxY: z.coerce.number().int().min(0).max(99).default(99),
  })
  .refine((value) => value.minX <= value.maxX && value.minY <= value.maxY, {
    message: "Bounds are inverted",
  });

export const limitSchema = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
