-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "x_username" TEXT,
    "website_url" TEXT,
    "bio" TEXT,
    "avatar_url" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empires" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "x_username" TEXT,
    "website_url" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "empires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plots" (
    "id" UUID NOT NULL,
    "grid_x" INTEGER NOT NULL,
    "grid_y" INTEGER NOT NULL,
    "pixel_width" INTEGER NOT NULL DEFAULT 10,
    "pixel_height" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "owner_user_id" UUID,
    "owner_empire_id" UUID,
    "owned_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_history" (
    "id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "owner_empire_id" UUID NOT NULL,
    "acquisition_type" TEXT NOT NULL,
    "purchase_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "pricing_rule_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "provider_event_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plot_locks" (
    "id" UUID NOT NULL,
    "plot_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "released_at" TIMESTAMPTZ(6),

    CONSTRAINT "plot_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "inventory_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" UUID,
    "empire_id" UUID,
    "plot_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_exceptions" (
    "id" UUID NOT NULL,
    "purchase_id" UUID,
    "payment_id" UUID,
    "reason" TEXT NOT NULL,
    "detail" JSONB,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_tokens" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "empires_owner_user_id_key" ON "empires"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "empires_slug_key" ON "empires"("slug");

-- CreateIndex
CREATE INDEX "plots_status_idx" ON "plots"("status");

-- CreateIndex
CREATE INDEX "plots_owner_empire_id_idx" ON "plots"("owner_empire_id");

-- CreateIndex
CREATE INDEX "plots_tier_status_idx" ON "plots"("tier", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plots_grid_x_grid_y_key" ON "plots"("grid_x", "grid_y");

-- CreateIndex
CREATE INDEX "ownership_history_plot_id_started_at_idx" ON "ownership_history"("plot_id", "started_at");

-- CreateIndex
CREATE INDEX "ownership_history_owner_empire_id_idx" ON "ownership_history"("owner_empire_id");

-- CreateIndex
CREATE INDEX "purchases_user_id_status_idx" ON "purchases"("user_id", "status");

-- CreateIndex
CREATE INDEX "purchases_plot_id_status_idx" ON "purchases"("plot_id", "status");

-- CreateIndex
CREATE INDEX "purchases_status_expires_at_idx" ON "purchases"("status", "expires_at");

-- CreateIndex
CREATE INDEX "payments_purchase_id_status_idx" ON "payments"("purchase_id", "status");

-- CreateIndex
CREATE INDEX "payments_provider_order_id_idx" ON "payments"("provider_order_id");

-- CreateIndex
CREATE INDEX "plot_locks_expires_at_released_at_idx" ON "plot_locks"("expires_at", "released_at");

-- CreateIndex
CREATE INDEX "plot_locks_purchase_id_idx" ON "plot_locks"("purchase_id");

-- CreateIndex
CREATE INDEX "pricing_rules_tier_is_active_idx" ON "pricing_rules"("tier", "is_active");

-- CreateIndex
CREATE INDEX "activity_events_created_at_idx" ON "activity_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_exceptions_resolved_at_created_at_idx" ON "payment_exceptions"("resolved_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_provider_event_id_key" ON "webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_tokens_token_hash_key" ON "login_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "login_tokens_email_created_at_idx" ON "login_tokens"("email", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- AddForeignKey
ALTER TABLE "empires" ADD CONSTRAINT "empires_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plots" ADD CONSTRAINT "plots_owner_empire_id_fkey" FOREIGN KEY ("owner_empire_id") REFERENCES "empires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_owner_empire_id_fkey" FOREIGN KEY ("owner_empire_id") REFERENCES "empires"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_pricing_rule_id_fkey" FOREIGN KEY ("pricing_rule_id") REFERENCES "pricing_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plot_locks" ADD CONSTRAINT "plot_locks_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plot_locks" ADD CONSTRAINT "plot_locks_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plot_locks" ADD CONSTRAINT "plot_locks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_empire_id_fkey" FOREIGN KEY ("empire_id") REFERENCES "empires"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "plots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_exceptions" ADD CONSTRAINT "payment_exceptions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_exceptions" ADD CONSTRAINT "payment_exceptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants (§37). These are enforced by the database, not only by services,
-- so a bug in application code cannot corrupt ownership.
-- ---------------------------------------------------------------------------

-- Vocabulary guards.
ALTER TABLE "plots" ADD CONSTRAINT "plots_status_check"
  CHECK ("status" IN ('unreleased', 'available', 'locked', 'owned', 'disabled'));
ALTER TABLE "plots" ADD CONSTRAINT "plots_grid_range_check"
  CHECK ("grid_x" >= 0 AND "grid_x" < 100 AND "grid_y" >= 0 AND "grid_y" < 100);
ALTER TABLE "plots" ADD CONSTRAINT "plots_pixel_size_check"
  CHECK ("pixel_width" > 0 AND "pixel_height" > 0);

-- owned  => owner_user_id, owner_empire_id and owned_at are all set.
-- !owned => all three are NULL.
ALTER TABLE "plots" ADD CONSTRAINT "plots_ownership_invariant"
  CHECK (
    ("status" = 'owned'
      AND "owner_user_id" IS NOT NULL
      AND "owner_empire_id" IS NOT NULL
      AND "owned_at" IS NOT NULL)
    OR
    ("status" <> 'owned'
      AND "owner_user_id" IS NULL
      AND "owner_empire_id" IS NULL
      AND "owned_at" IS NULL)
  );

-- A plot has at most one ACTIVE lock. Released locks are retained for audit.
CREATE UNIQUE INDEX "plot_locks_one_active_per_plot"
  ON "plot_locks" ("plot_id") WHERE "released_at" IS NULL;
ALTER TABLE "plot_locks" ADD CONSTRAINT "plot_locks_window_check"
  CHECK ("expires_at" > "locked_at");

-- A plot has at most one OPEN ownership-history row.
CREATE UNIQUE INDEX "ownership_history_one_open_per_plot"
  ON "ownership_history" ("plot_id") WHERE "ended_at" IS NULL;
ALTER TABLE "ownership_history" ADD CONSTRAINT "ownership_history_type_check"
  CHECK ("acquisition_type" IN ('purchase', 'admin_transfer', 'conquest'));

-- At most one live reservation per plot. Combined with the inline expiry in
-- createPurchase() this is what makes two simultaneous claims resolve to one.
CREATE UNIQUE INDEX "purchases_one_pending_per_plot"
  ON "purchases" ("plot_id") WHERE "status" = 'pending';
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_status_check"
  CHECK ("status" IN ('pending', 'completed', 'cancelled', 'expired', 'refunded'));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amount_check"
  CHECK ("amount_minor" > 0);
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_completed_check"
  CHECK (("status" = 'completed') = ("completed_at" IS NOT NULL));

ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check"
  CHECK ("status" IN ('created', 'pending', 'paid', 'failed', 'refunded'));
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check"
  CHECK ("amount_minor" > 0);

-- One provider payment id maps to at most one payment row: a replayed webhook
-- or a double-fired browser callback cannot fan out into two payment records.
CREATE UNIQUE INDEX "payments_provider_payment_id_key"
  ON "payments" ("provider", "provider_payment_id") WHERE "provider_payment_id" IS NOT NULL;

ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_price_check"
  CHECK ("price_minor" > 0);
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_window_check"
  CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");

-- ---------------------------------------------------------------------------
-- ownership_history is append-only: rows may be inserted and closed
-- (ended_at set), never deleted and never otherwise rewritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "ownership_history_append_only"() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ownership_history is append-only: deletes are not permitted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."plot_id" IS DISTINCT FROM OLD."plot_id"
    OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
    OR NEW."owner_empire_id" IS DISTINCT FROM OLD."owner_empire_id"
    OR NEW."acquisition_type" IS DISTINCT FROM OLD."acquisition_type"
    OR NEW."purchase_id" IS DISTINCT FROM OLD."purchase_id"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION 'ownership_history is append-only: only ended_at may be updated';
  END IF;

  IF OLD."ended_at" IS NOT NULL AND NEW."ended_at" IS DISTINCT FROM OLD."ended_at" THEN
    RAISE EXCEPTION 'ownership_history is append-only: ended_at is write-once';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ownership_history_append_only_trg"
  BEFORE UPDATE OR DELETE ON "ownership_history"
  FOR EACH ROW EXECUTE FUNCTION "ownership_history_append_only"();
