// apps/api/src/payments.test.ts - StripePayments against a stubbed Stripe: the request it sends, and
// card-only Checkout when the account can't take bank (ACH) payments yet.


import { afterEach, describe, expect, it, vi } from "vitest";
import { StripePayments } from "./payments.ts";


const REQ = { invoiceNumber: "INV-0039-01", amountCents: 85000, description: "Deposit", successUrl: "https://x/ok", cancelUrl: "https://x/no", metadata: { invoiceId: "i1", tenantId: "t1", projectId: "p1" } };
afterEach(() => vi.unstubAllGlobals());


describe("Stripe Checkout", () => {
  it("offers bank first, then card, and names the invoice on the statement", async () => {
    const sent: URLSearchParams[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      sent.push(init.body as URLSearchParams);
      return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/1" }));
    });
    expect(await new StripePayments("sk_x", "whsec_x").checkout(REQ as never)).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/c/1" });
    expect(sent[0]!.getAll("payment_method_types[]")).toEqual(["us_bank_account", "card"]);
    expect(sent[0]!.get("payment_intent_data[statement_descriptor_suffix]")).toBe("INV003901");
  });

  it("falls back to card alone when ACH isn't active on the account", async () => {
    const sent: URLSearchParams[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      sent.push(init.body as URLSearchParams);
      return sent.length === 1
        ? new Response(JSON.stringify({ error: { message: "The payment method type \"us_bank_account\" is invalid." } }), { status: 400 })
        : new Response(JSON.stringify({ id: "cs_2", url: "https://checkout.stripe.com/c/2" }));
    });
    expect((await new StripePayments("sk_x", "whsec_x").checkout(REQ as never)).id).toBe("cs_2");
    expect(sent[1]!.getAll("payment_method_types[]")).toEqual(["card"]);
  });

  it("doesn't retry other failures", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "Invalid API Key provided" } }), { status: 401 }));
    await expect(new StripePayments("sk_x", "whsec_x").checkout(REQ as never)).rejects.toThrow(/401/);
  });
});
