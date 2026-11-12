// apps/api/src/payments.ts - Taking card and bank (ACH) payments through Stripe Checkout, and keeping a
// locked copy of each billing record. Both sit behind small interfaces so tests, local runs, and the
// browser demo work without Stripe or AWS. Only Web APIs (fetch, crypto.subtle) are used here; the S3
// copy (S3Records) lives in services.ts with the other AWS clients.




// --- Payments --------------------------------------------------------------------------

/** What a Checkout session is opened with: the amount still owed on one invoice */
export interface CheckoutRequest {
  amountCents: number;
  invoiceNumber: string;
  description: string;
  email?: string;
  successUrl: string;
  cancelUrl: string;
  // Read back by the webhook to find the invoice; Stripe returns it unchanged
  metadata: { tenantId: string; projectId: string; invoiceId: string };
}

/** The parts of a Stripe event 1NEON acts on */
export interface PaymentEvent {
  id: string;
  type: string;
  session?: { id: string; paymentStatus: string; amountTotal: number; paymentIntent?: string; method?: string; metadata: Record<string, string> };
}

/** The payment provider */
export interface Payments {
  // Open a hosted payment page; the browser goes to `url`
  checkout(r: CheckoutRequest): Promise<{ id: string; url: string }>;
  // Check a webhook's signature and read it; undefined when the signature doesn't hold
  verify(rawBody: string, signatureHeader: string | undefined, now?: number): Promise<PaymentEvent | undefined>;
}


// Stripe's webhook signatures older than five minutes are refused, so a captured one can't be replayed later
const TOLERANCE_S = 300;

/** HMAC-SHA256 of text as lowercase hex */
async function hmacHex(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings in time that doesn't depend on where they differ */
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Verify a `Stripe-Signature` header ("t=...,v1=...") over the raw body, as Stripe documents it */
export async function verifyStripeSignature(secret: string, rawBody: string, header: string | undefined, now = Date.now()) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > TOLERANCE_S) return false;
  const want = await hmacHex(secret, `${t}.${rawBody}`);
  return sigs.some((s) => same(s, want));
}

/** Read the fields 1NEON uses from a Stripe event body */
export function readEvent(body: string): PaymentEvent {
  const e = JSON.parse(body) as { id: string; type: string; data?: { object?: Record<string, unknown> } };
  const o = e.data?.object;
  const isSession = o?.object === "checkout.session";
  return {
    id: e.id,
    type: e.type,
    session: isSession ? {
      id: String(o!.id),
      paymentStatus: String(o!.payment_status ?? ""),
      amountTotal: Number(o!.amount_total ?? 0),
      paymentIntent: typeof o!.payment_intent === "string" ? o!.payment_intent : undefined,
      method: Array.isArray(o!.payment_method_types) && o!.payment_method_types.length === 1 ? String(o!.payment_method_types[0]) : undefined,
      metadata: (o!.metadata ?? {}) as Record<string, string>,
    } : undefined,
  };
}


/** Stripe, through its REST API. Bank (ACH) is offered first: it costs 0.8%, capped at $5 */
export class StripePayments implements Payments {
  constructor(private secretKey: string, private webhookSecret: string) {}

  // Bank first, then card; if the account can't take ACH yet, Stripe refuses the pair, so card alone still works
  async checkout(r: CheckoutRequest) {
    try {
      return await this.session(r, ["us_bank_account", "card"]);
    } catch (e) {
      if (!/us_bank_account|payment method type/i.test(String(e))) throw e;
      console.warn("ACH unavailable on the Stripe account; offering card only");
      return this.session(r, ["card"]);
    }
  }

  private async session(r: CheckoutRequest, methods: string[]) {
    const f = new URLSearchParams();
    f.set("mode", "payment");
    for (const m of methods) f.append("payment_method_types[]", m);
    f.set("line_items[0][quantity]", "1");
    f.set("line_items[0][price_data][currency]", "usd");
    f.set("line_items[0][price_data][unit_amount]", String(r.amountCents));
    f.set("line_items[0][price_data][product_data][name]", r.invoiceNumber);
    f.set("line_items[0][price_data][product_data][description]", r.description.slice(0, 300));
    f.set("success_url", r.successUrl);
    f.set("cancel_url", r.cancelUrl);
    f.set("client_reference_id", r.metadata.invoiceId);
    if (r.email) f.set("customer_email", r.email);
    f.set("payment_intent_data[description]", `neon1 ${r.invoiceNumber}`);
    // Card statements read "NEON1* INV003901", so a charge names the invoice it paid (banks ignore it for ACH)
    f.set("payment_intent_data[statement_descriptor_suffix]", r.invoiceNumber.replace(/[^A-Za-z0-9]/g, "").slice(0, 12));
    for (const [k, v] of Object.entries(r.metadata)) {
      f.set(`metadata[${k}]`, v);
      f.set(`payment_intent_data[metadata][${k}]`, v);
    }
    // One session per invoice and amount: a double click reuses the first session instead of opening two
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${this.secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": `${r.metadata.invoiceId}-${r.amountCents}-${methods.length}-${new Date().toISOString().slice(0, 13)}` },
      body: f,
    });
    const j = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
    if (!res.ok || !j.id || !j.url) throw new Error(`stripe checkout failed: ${res.status} ${j.error?.message ?? ""}`);
    return { id: j.id, url: j.url };
  }

  async verify(rawBody: string, header: string | undefined, now = Date.now()) {
    return (await verifyStripeSignature(this.webhookSecret, rawBody, header, now)) ? readEvent(rawBody) : undefined;
  }
}


/** Tests and local runs: sessions are remembered, and events are signed with a known secret */
export class MemoryPayments implements Payments {
  sessions: (CheckoutRequest & { id: string })[] = [];
  constructor(public webhookSecret = "whsec_test") {}

  async checkout(r: CheckoutRequest) {
    const id = `cs_test_${this.sessions.length + 1}`;
    this.sessions.push({ ...r, id });
    return { id, url: `https://checkout.example.invalid/${id}` };
  }

  async verify(rawBody: string, header: string | undefined, now = Date.now()) {
    return (await verifyStripeSignature(this.webhookSecret, rawBody, header, now)) ? readEvent(rawBody) : undefined;
  }

  /** A signed webhook body and header, as Stripe would send them */
  async sign(event: unknown, at = Date.now()) {
    const body = JSON.stringify(event);
    const t = Math.floor(at / 1000);
    return { body, header: `t=${t},v1=${await hmacHex(this.webhookSecret, `${t}.${body}`)}` };
  }
}


// --- Locked records ------------------------------------------------------------------------

/** Write-once copies of signed and issued records, kept apart from working files */
export interface Records {
  put(key: string, record: unknown): Promise<void>;
}

/** Tests, local runs, and the demo keep the copies in memory */
export class MemoryRecords implements Records {
  saved = new Map<string, unknown>();
  async put(key: string, record: unknown) {
    // Write-once, like the locked bucket: a second write to the same key is a bug
    if (this.saved.has(key)) throw new Error(`record ${key} already kept`);
    this.saved.set(key, structuredClone(record));
  }
}
