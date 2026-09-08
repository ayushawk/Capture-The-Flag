/** Canonical V1 map + domain constants. Values that operators may tune live in
 *  `platform_settings`; these are the compile-time defaults and the vocabulary. */

export const MAP = {
  /** Logical pixels across the world. */
  width: 1000,
  /** Logical pixels down the world. */
  height: 1000,
  /** Logical pixels per plot edge. */
  plotSize: 10,
} as const;

/** 100 x 100 = 10,000 plots. */
export const GRID_WIDTH = MAP.width / MAP.plotSize;
export const GRID_HEIGHT = MAP.height / MAP.plotSize;
export const TOTAL_PLOTS = GRID_WIDTH * GRID_HEIGHT;
export const PIXELS_PER_PLOT = MAP.plotSize * MAP.plotSize;
export const TOTAL_LOGICAL_PIXELS = MAP.width * MAP.height;

/** V1 founding release. */
export const FOUNDING_INVENTORY = 1000;
/** $1.00 in minor units. */
export const FOUNDING_PRICE_MINOR = 100;
export const FOUNDING_CURRENCY = "USD";
export const CHECKOUT_LOCK_MINUTES = 10;

export const PLOT_STATUS = {
  unreleased: "unreleased",
  available: "available",
  locked: "locked",
  owned: "owned",
  disabled: "disabled",
} as const;
export type PlotStatus = (typeof PLOT_STATUS)[keyof typeof PLOT_STATUS];
export const PLOT_STATUSES = Object.values(PLOT_STATUS) as PlotStatus[];

export const PLOT_TIER = {
  founding: "founding",
  standard: "standard",
} as const;
export type PlotTier = (typeof PLOT_TIER)[keyof typeof PLOT_TIER];

export const PURCHASE_STATUS = {
  pending: "pending",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
  refunded: "refunded",
} as const;
export type PurchaseStatus = (typeof PURCHASE_STATUS)[keyof typeof PURCHASE_STATUS];

export const PAYMENT_STATUS = {
  created: "created",
  pending: "pending",
  paid: "paid",
  failed: "failed",
  refunded: "refunded",
} as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const ACQUISITION_TYPE = {
  purchase: "purchase",
  adminTransfer: "admin_transfer",
  // Future: conquest — deliberately not implemented in V1.
} as const;

export const ACTIVITY_EVENT = {
  territoryClaimed: "territory_claimed",
  empireCreated: "empire_created",
} as const;

export const PAYMENT_PROVIDER = "razorpay" as const;

/** Compact status codes used by the map API/canvas so the wire format stays small. */
export const STATUS_CODE: Record<PlotStatus, number> = {
  unreleased: 0,
  available: 1,
  locked: 2,
  owned: 3,
  disabled: 4,
};
export const CODE_STATUS: PlotStatus[] = ["unreleased", "available", "locked", "owned", "disabled"];

export const SETTING_KEYS = {
  mapWidth: "map_width",
  mapHeight: "map_height",
  plotSize: "plot_size",
  foundingInventory: "founding_inventory",
  foundingPrice: "founding_price",
  checkoutLockMinutes: "checkout_lock_minutes",
} as const;
