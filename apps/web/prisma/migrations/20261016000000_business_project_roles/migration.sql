-- Provider is retired. Preserve historical paid/failed/pending orders and existing entitlements.
-- Remove only its credentials and disable groups that were actually configured for it.
DO $$
DECLARE prefix text;
BEGIN
  FOREACH prefix IN ARRAY ARRAY['pay_', 'vpnpay_', 'bizpay_'] LOOP
    IF EXISTS (SELECT 1 FROM "SiteConfig" WHERE ("key" = prefix || 'acquiring_provider' AND lower("value") LIKE '%cloudpayments%') OR ("key" = prefix || 'acquiring_link' AND "value" ~* '^https?://([^/]*\.)?cloudpayments\.(ru|com)([:/]|$)')) THEN
      UPDATE "SiteConfig" SET "value" = CASE WHEN "key" = prefix || 'acquiring_enabled' THEN '0' ELSE '' END
      WHERE "key" IN (prefix || 'acquiring_enabled', prefix || 'acquiring_provider', prefix || 'acquiring_link', prefix || 'acquiring_merchant', prefix || 'acquiring_secret');
    END IF;
  END LOOP;
END $$;
DELETE FROM "SiteConfig" WHERE "key" IN ('pay_cloudpayments_public_id', 'vpnpay_cloudpayments_public_id', 'paylink_auto_activate');
-- Do not reuse active legacy checkout URLs. Keep USED and paid reports for manual reconciliation.
UPDATE "PaymentLink" SET "status" = 'DISABLED', "reservationExpiresAt" = NULL
WHERE "status" IN ('FREE', 'RESERVED', 'AWAITING') AND "url" ~* '^https?://([^/]*\.)?cloudpayments\.(ru|com)([:/]|$)';
CREATE TABLE "TzIdProjectRole" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "role" VARCHAR(16) NOT NULL DEFAULT 'ADMIN',
  "revokedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TzIdProjectRole_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TzIdProjectRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TzIdProjectRole_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "TzIdClient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TzIdProjectRole_clientId_userId_key" ON "TzIdProjectRole"("clientId", "userId");
