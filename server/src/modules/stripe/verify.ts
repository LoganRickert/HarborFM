import Stripe from "stripe";
import { createStripeClient, isE2eStripeSecret } from "./stripeClient.js";

export type VerifyCheckStatus = "ok" | "fail" | "unknown";

export type VerifyCheck = {
  id: string;
  label: string;
  status: VerifyCheckStatus;
  detail?: string;
};

export type VerifyCredentialsResult = {
  ok: boolean;
  checks: VerifyCheck[];
};

const PERMISSION_PROBES: Array<{
  id: string;
  label: string;
  /** Attempt a write that should fail with resource_missing if Write is granted. */
  run: (stripe: Stripe) => Promise<unknown>;
}> = [
  {
    id: "customers",
    label: "Customers",
    run: (stripe) =>
      stripe.customers.update("cus_harbor_permission_probe", {
        description: "harborfm-probe",
      }),
  },
  {
    id: "charges-refunds",
    label: "Charges and Refunds",
    run: (stripe) =>
      stripe.refunds.create({ charge: "ch_harbor_permission_probe" }),
  },
  {
    id: "payment-intents",
    label: "Payment Intents",
    run: (stripe) =>
      stripe.paymentIntents.update("pi_harbor_permission_probe", {
        metadata: { harborfm_probe: "1" },
      }),
  },
  {
    id: "products",
    label: "Products",
    run: (stripe) =>
      stripe.products.update("prod_harbor_permission_probe", {
        name: "harborfm-probe",
      }),
  },
  {
    id: "coupons",
    label: "Coupons",
    run: (stripe) => stripe.coupons.del("harbor_permission_probe"),
  },
  {
    id: "customer-portal",
    label: "Customer Portal",
    run: (stripe) =>
      stripe.billingPortal.sessions.create({
        customer: "cus_harbor_permission_probe",
        return_url: "https://example.com/",
      }),
  },
  {
    id: "invoices",
    label: "Invoices",
    run: (stripe) =>
      stripe.invoices.create({ customer: "cus_harbor_permission_probe" }),
  },
  {
    id: "prices",
    label: "Prices",
    run: (stripe) =>
      stripe.prices.update("price_harbor_permission_probe", { active: false }),
  },
  {
    id: "promotion-codes",
    label: "Promotion Codes",
    run: (stripe) =>
      stripe.promotionCodes.update("promo_harbor_permission_probe", {
        active: false,
      }),
  },
  {
    id: "subscriptions",
    label: "Subscriptions",
    run: (stripe) =>
      stripe.subscriptions.update("sub_harbor_permission_probe", {
        metadata: { harborfm_probe: "1" },
      }),
  },
  {
    id: "checkout-sessions",
    label: "Checkout Sessions",
    run: (stripe) =>
      stripe.checkout.sessions.create({
        mode: "payment",
        success_url: "https://example.com/s",
        cancel_url: "https://example.com/c",
        line_items: [
          { price: "price_harbor_permission_probe", quantity: 1 },
        ],
      }),
  },
];

function isStripeError(err: unknown): err is Stripe.errors.StripeError {
  return err instanceof Stripe.errors.StripeError;
}

function isAuthError(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeAuthenticationError;
}

function isPermissionError(err: unknown): boolean {
  if (!isStripeError(err)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("required permissions") ||
    msg.includes("does not have the required permission") ||
    (err.statusCode === 403 && msg.includes("permission"))
  );
}

/** Permission was fine; request failed for a harmless reason (missing id, bad params). */
function isExpectedProbeFailure(err: unknown): boolean {
  if (!isStripeError(err)) return false;
  if (isPermissionError(err) || isAuthError(err)) return false;
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    if (err.code === "resource_missing") return true;
    if (err.code === "parameter_invalid_empty") return true;
    if (err.code === "parameter_missing") return true;
    if (/no such /i.test(err.message)) return true;
    if (
      /invalid/i.test(err.message) &&
      /id|customer|price|product|charge|payment|subscription|coupon|promo|refund/i.test(
        err.message,
      )
    ) {
      return true;
    }
  }
  return false;
}

async function probePermission(
  stripe: Stripe,
  probe: (typeof PERMISSION_PROBES)[number],
): Promise<VerifyCheck> {
  try {
    await probe.run(stripe);
    return {
      id: probe.id,
      label: probe.label,
      status: "ok",
      detail: "Write access looks available.",
    };
  } catch (err) {
    if (isAuthError(err)) throw err;
    if (isPermissionError(err)) {
      return {
        id: probe.id,
        label: probe.label,
        status: "fail",
        detail:
          "This key is missing Write for this resource. Edit the restricted key in Stripe and set it to Write.",
      };
    }
    if (isExpectedProbeFailure(err)) {
      return {
        id: probe.id,
        label: probe.label,
        status: "ok",
        detail: "Write access looks available.",
      };
    }
    const detail = isStripeError(err) ? err.message : "Unexpected error while checking.";
    return {
      id: probe.id,
      label: probe.label,
      status: "unknown",
      detail,
    };
  }
}

async function verifyPublishableKey(
  publishableKey: string,
  mode: "test" | "live",
): Promise<VerifyCheck> {
  const expectedPrefix = mode === "live" ? "pk_live_" : "pk_test_";
  if (!publishableKey.startsWith(expectedPrefix) && !publishableKey.includes("e2e")) {
    return {
      id: "publishable-key",
      label: "Publishable key",
      status: "fail",
      detail: `Expected a ${expectedPrefix}… key for ${mode} mode.`,
    };
  }
  if (isE2eStripeSecret(publishableKey) || /_e2e_/i.test(publishableKey)) {
    return {
      id: "publishable-key",
      label: "Publishable key",
      status: "ok",
      detail: "E2E publishable key accepted.",
    };
  }

  const pub = createStripeClient(publishableKey);
  try {
    // Valid publishable keys accept the request then fail validation (missing card details).
    await pub.paymentMethods.create({ type: "card" });
    return {
      id: "publishable-key",
      label: "Publishable key",
      status: "ok",
      detail: "Publishable key is accepted by Stripe.",
    };
  } catch (err) {
    if (isAuthError(err)) {
      return {
        id: "publishable-key",
        label: "Publishable key",
        status: "fail",
        detail: "Stripe rejected this publishable key. Double-check you copied the full pk_… value.",
      };
    }
    if (isExpectedProbeFailure(err) || isStripeError(err)) {
      // Any non-auth Stripe error means the key authenticated.
      return {
        id: "publishable-key",
        label: "Publishable key",
        status: "ok",
        detail: "Publishable key is accepted by Stripe.",
      };
    }
    return {
      id: "publishable-key",
      label: "Publishable key",
      status: "unknown",
      detail: err instanceof Error ? err.message : "Could not verify publishable key.",
    };
  }
}

async function verifyRestrictedKey(
  secretKey: string,
  mode: "test" | "live",
): Promise<{ check: VerifyCheck; stripe: Stripe | null }> {
  const rkPrefix = mode === "live" ? "rk_live_" : "rk_test_";
  const skPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  const okPrefix =
    secretKey.startsWith(rkPrefix) ||
    secretKey.startsWith(skPrefix) ||
    isE2eStripeSecret(secretKey);

  if (!okPrefix) {
    return {
      check: {
        id: "restricted-key",
        label: "Restricted key",
        status: "fail",
        detail: `Expected a ${rkPrefix}… (or ${skPrefix}…) key for ${mode} mode.`,
      },
      stripe: null,
    };
  }

  if (isE2eStripeSecret(secretKey)) {
    return {
      check: {
        id: "restricted-key",
        label: "Restricted key",
        status: "ok",
        detail: "E2E restricted key accepted.",
      },
      stripe: null,
    };
  }

  const stripe = createStripeClient(secretKey);
  try {
    // Any authenticated response (including permission errors) proves the key is real.
    await stripe.customers.list({ limit: 1 });
    return {
      check: {
        id: "restricted-key",
        label: "Restricted key",
        status: "ok",
        detail: "Restricted key is accepted by Stripe.",
      },
      stripe,
    };
  } catch (err) {
    if (isAuthError(err)) {
      return {
        check: {
          id: "restricted-key",
          label: "Restricted key",
          status: "fail",
          detail:
            "Stripe rejected this restricted key. Double-check you copied the Token (rk_…) value.",
        },
        stripe: null,
      };
    }
    if (isPermissionError(err) || isExpectedProbeFailure(err) || isStripeError(err)) {
      return {
        check: {
          id: "restricted-key",
          label: "Restricted key",
          status: "ok",
          detail: "Restricted key is accepted by Stripe.",
        },
        stripe,
      };
    }
    return {
      check: {
        id: "restricted-key",
        label: "Restricted key",
        status: "unknown",
        detail: err instanceof Error ? err.message : "Could not verify restricted key.",
      },
      stripe: null,
    };
  }
}

/**
 * Verify restricted + publishable keys, then probe Write on each required resource.
 * Write probes intentionally use fake IDs so a granted permission fails as resource_missing
 * without creating Stripe objects.
 */
export async function verifyStripeCredentialKeys(opts: {
  secretKey: string;
  publishableKey: string;
  mode: "test" | "live";
}): Promise<VerifyCredentialsResult> {
  const secretKey = opts.secretKey.trim();
  const publishableKey = opts.publishableKey.trim();
  const mode = opts.mode === "live" ? "live" : "test";
  const checks: VerifyCheck[] = [];

  if (!secretKey) {
    checks.push({
      id: "restricted-key",
      label: "Restricted key",
      status: "fail",
      detail: "Restricted key is missing.",
    });
  }
  if (!publishableKey) {
    checks.push({
      id: "publishable-key",
      label: "Publishable key",
      status: "fail",
      detail: "Publishable key is missing.",
    });
  }
  if (!secretKey || !publishableKey) {
    return { ok: false, checks };
  }

  const { check: restrictedCheck, stripe } = await verifyRestrictedKey(
    secretKey,
    mode,
  );
  checks.push(restrictedCheck);

  const publishableCheck = await verifyPublishableKey(publishableKey, mode);
  checks.push(publishableCheck);

  if (restrictedCheck.status === "ok" && stripe) {
    for (const probe of PERMISSION_PROBES) {
      checks.push(await probePermission(stripe, probe));
    }
  } else if (restrictedCheck.status === "ok" && isE2eStripeSecret(secretKey)) {
    for (const probe of PERMISSION_PROBES) {
      checks.push({
        id: probe.id,
        label: probe.label,
        status: "ok",
        detail: "Skipped for E2E key.",
      });
    }
  } else {
    for (const probe of PERMISSION_PROBES) {
      checks.push({
        id: probe.id,
        label: probe.label,
        status: "unknown",
        detail: "Skipped because the restricted key could not be verified.",
      });
    }
  }

  const keyChecks = checks.filter(
    (c) => c.id === "restricted-key" || c.id === "publishable-key",
  );
  const permissionChecks = checks.filter(
    (c) => c.id !== "restricted-key" && c.id !== "publishable-key",
  );
  const keysOk = keyChecks.every((c) => c.status === "ok");
  // Unknown permission results are allowed (could not confirm); explicit fails are not.
  const permissionsOk = permissionChecks.every((c) => c.status !== "fail");
  return { ok: keysOk && permissionsOk, checks };
}
