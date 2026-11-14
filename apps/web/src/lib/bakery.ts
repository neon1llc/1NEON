// apps/web/src/lib/bakery.ts - Maple Street Bakery, the one made-up client every walkthrough, the
// sample project page, and help's examples follow. Its facts live here once, and its money is worked
// out with the same rules a real project uses (packages/domain billing), so no page can quote a
// figure the others don't. Every figure is illustrative: a fictional bakery, not a quote.


import { DEPOSIT_PERCENT, dollars, hoursRange, hoursText, priceLine, priceOf, type BasisLine, type Price } from "@1neon/domain";


// --- The bakery -------------------------------------------------------------------------

/** Who's who. Maria decides; Sam and Dee are the two people whose days the project changes */
export const PEOPLE = {
  maria: "Maria Lopez, the owner",
  sam: "Sam, who runs the counter and closes most nights",
  dee: "Dee, the head baker, who starts at 4am",
} as const;

/** How orders reach the bakery today, on the Friday Maria gives as her example: 41 in all */
export const FRIDAY = { emails: 27, voicemails: 8, instagram: 6, total: 41 } as const;
/** The past week of real orders the dry run replays, and how many landed right the first time */
export const DRY_RUN = { orders: 243, right: 236, fixed: 7 } as const;

/** The project as Maria describes it when she starts it */
export const PROJECT = {
  name: "Orders without retyping",
  today: "Orders come in by email, voicemail, and Instagram. Sam and I retype about 40 a night into a spreadsheet, and Dee tallies the bake from it by hand at 4am.",
  outcome: "Every order lands in one list on its own, the kitchen gets its bake sheet, and nobody retypes anything.",
  example: `Last Friday, ${FRIDAY.total} orders: ${FRIDAY.emails} emails, ${FRIDAY.voicemails} voicemails, and ${FRIDAY.instagram} Instagram messages, typed in from 8 to 9pm.`,
} as const;

/** The two measures: what they are now, and what they should be */
export const MEASURES = [
  { title: "Minutes retyping each night", unit: "min", baseline: 60, target: 10 },
  { title: "Orders missed or wrong each week", unit: "orders", baseline: 3, target: 0 },
] as const;


// --- What neon1 learned in Listen -----------------------------------------------------------

/** Questions from the first call, with the answers Pradeep wrote down */
export const LEARNED: [string, string][] = [
  ["Where do orders come from?", `Email (about two in three), after-hours voicemail, and Instagram messages. Last Friday: ${FRIDAY.emails} emails, ${FRIDAY.voicemails} voicemails, and ${FRIDAY.instagram} Instagram messages.`],
  ["What goes wrong today?", "About three orders a week are missed or typed wrong, most often a pickup date or a cake message. Dee tallies the bake by hand at 4am. Everyone signs in with one shared Google password."],
  ["What can't change?", "Customers keep ordering the way they do now. Sam and Dee don't learn a new app: whatever is built lives in the Google account the bakery already pays for."],
];
/** What "better" means, in Maria's words from the call */
export const BETTER = "Nobody retypes an order, Dee's bake sheet is waiting for her at 4am, and we don't have to stop taking holiday orders two days early like last year.";

/** Limits found before any option was written, so each option is honest about them */
export const CONSTRAINTS: [string, string][] = [
  ["Instagram messages stay manual for now", "Instagram does offer official messaging access for business accounts, but setting it up (a Meta developer app, its permissions, and upkeep as Meta's rules change) costs more than it saves for about six orders a night. An instant reply sends the order form's link, and staff enter the rest in a short staff form. It can be added later if Instagram orders grow."],
  ["Voicemail orders depend on the phone service emailing transcripts", "Most services do. If the bakery's doesn't, a free Google Voice number can take the after-hours calls."],
  ["Ready before the holiday rush", "The week side by side with the old way has to finish before the rush starts."],
];

/** The accounts the work touches, all the bakery's own */
export const ASSETS = ["Google Workspace: the orders inbox and the order spreadsheet", "Phone service: after-hours voicemail and its transcripts", "Instagram business account"];

/** The file Pradeep asks for, and what Maria sends */
export const FILE_ASK = { title: "Last week's order emails and voicemail transcripts, names removed", body: "Export or forward them as a zip, whichever is easier. I use them to test against real orders before anything goes live.", name: "orders-last-week.zip", text: `${DRY_RUN.orders} orders: emails and voicemail transcripts, names removed` } as const;


// --- The three options -------------------------------------------------------------------

/** neon1's rate for small-business workflow work, in cents an hour (Knowledge Center, "How pricing works") */
export const RATE_CENTS = 10_000;

/** One option as Pradeep writes it: the title, the details, and its fields */
export interface BakeryOption { title: string; body: string; fields: Record<string, unknown> & { hoursLow: number; hoursHigh: number; basis: BasisLine[] } }

// Every option is an estimate: hours at the rate, from a low to a high end, with the work behind them
const estimate = (hoursLow: number, hoursHigh: number, basis: BasisLine[]) => ({ pricing: "estimate" as const, rateCents: RATE_CENTS, hoursLow, hoursHigh, basis });

// The work behind each option, task by task, as the proposal's "How the hours add up" lists it
// (Knowledge Center, "Proposal with options, filled in"). A and B share the form; C starts from B
const FORM: BasisLine[] = [
  { work: "Order form with pickup rules and a confirmation to the customer", hours: 2 },
  { work: "One order list with a status for each order", hours: 0.5 },
  { work: "The form's link on your website and Google profile, and in automatic replies", hours: 0.5 },
];
const QUICK: BasisLine[] = [
  { work: "Accounts set up in the bakery's name, and the follow-up questions from discovery", hours: 0.5 },
  ...FORM,
  { work: "Ten test orders with you and Sam, and a walkthrough", hours: 1 },
  { work: "Go-live support: the first two weeks of fixes and questions", hours: 0.5 },
];
const SOLID: BasisLine[] = [
  { work: "Accounts set up in the bakery's name, and the follow-up questions from discovery", hours: 1.5 },
  ...FORM,
  { work: "Order emails and voicemail transcripts read into the list, each marked to check", hours: 5 },
  { work: "Staff form for phone and Instagram orders, and a flag on possible duplicates", hours: 2 },
  { work: "7pm summary for you and Sam, and Dee's bake sheet for 4am", hours: 2 },
  { work: "Pickup tags from the label printer", hours: 1.5 },
  { work: "Safety net: a nightly copy, an alert if orders stop arriving, and a sign-in for each person", hours: 2.5 },
  { work: "Dry run on a past week of real orders, then a week side by side with the old way", hours: 3 },
  { work: "Runbook, recorded walkthrough, training for each person, and handover", hours: 2.5 },
  { work: "Go-live support: the first two weeks of fixes and questions", hours: 2 },
];
const sum = (b: BasisLine[]) => b.reduce((n, x) => n + x.hours, 0);

export const OPTIONS: BakeryOption[] = [
  {
    title: "A. Quick fix",
    body: [
      "An order form that customers fill in themselves, feeding one order list. It fixes new orders made through the form; it doesn't touch the ones that still arrive by email, voicemail, or Instagram.",
      "Includes:\n- An order form with your items, quantities, pickup day and time, and notes. It refuses a pickup you can't make, such as a Monday, or a custom cake with less than two days' notice\n- A confirmation to the customer with what they ordered\n- One order list, sorted by pickup, with a status for each order: new, baked, picked up\n- The form's link on your website and Google profile, and in an automatic reply to order emails and Instagram messages\n- Ten test orders with you and Sam, then a walkthrough",
      "Not included:\n- Orders that still come by email, voicemail, or Instagram message, which are typed in as today\n- The 7pm summary and the kitchen's bake sheet",
    ].join("\n\n"),
    fields: {
      ...estimate(4, 6, QUICK),
      timeline: "1 week", outsideCosts: "None. It runs in the Google account you already pay for",
      result: "Orders from the form appear in the list within a minute, with nothing retyped.",
      why: "Pick this to try the form before paying for more. Emails, voicemails, and Instagram messages would still be retyped, and they are most of tonight's hour.",
      costScore: 5, qualityScore: 2, effortScore: 4,
    },
  },
  {
    title: "B. Solid setup",
    body: [
      "Every order in one list by 7pm, however it arrived, and the kitchen's bake sheet made from that list. Nobody retypes an order; a person checks each one that a customer didn't type in themselves.",
      "Includes:\n- Everything in A\n- Order emails and voicemail transcripts read into the same list as they arrive. Each is marked to check, with a link to the original, so a person confirms it in seconds and nothing is trusted blindly\n- A 20-second staff form for phone calls and Instagram messages, and a flag when the same order seems to have arrived twice\n- A 7pm email to you and Sam with tomorrow's pickups and anything still to check, and a bake sheet for Dee with tomorrow's totals by item, ready before 4am\n- Pickup tags printed from the list\n- A safety net: a nightly copy of the list, an alert to you if no orders arrive during opening hours, and each person signing in as themselves in place of the shared password\n- A dry run on a past week of your real orders before anything goes live, then a week side by side with the old way\n- A runbook, a recorded walkthrough for new staff, training for each person, and every account in the bakery's name\n- Two weeks of go-live support for fixes and questions",
      "Not included:\n- Taking payment online\n- Changes to your phone service or your website's design",
      "Depends on:\n- Your phone service emailing voicemail transcripts. Most do, and if yours doesn't, a free Google Voice number can\n- Instagram messages staying manual for now. Automating them would mean a Meta developer app, its permissions, and upkeep, which costs more than it saves for about six orders a night. An instant reply sends the order form's link, and staff use the staff form for the rest",
    ].join("\n\n"),
    fields: {
      ...estimate(22, 28, SOLID),
      timeline: "4 weeks, the last one side by side", outsideCosts: "Nothing each month. It runs in the Google account you already pay for",
      result: "Every order is in one list by 7pm, with under 10 minutes of checking a night, and no order missed.",
      why: "It ends the nightly retyping without asking one customer to change how they order, and it's running before the holiday rush. The online order page in C can follow later, and nothing in B is redone.",
      costScore: 3, qualityScore: 4, effortScore: 4, recommended: true,
      purchases: [{ name: "Label printer for pickup bags", estimate: "$180-$220", buyer: "client", why: "Prints a pickup tag from each order in the list", example: "Brother QL-820NWB" }],
    },
  },
  {
    title: "C. Fuller build",
    body: [
      "Everything in B, plus an online order page where customers choose a pickup time, pay ahead, and get a reminder, so most new orders never pass through the inbox at all.",
      "Includes:\n- Everything in B\n- An order page on Square's online store, with your menu, pickup times, and holiday cutoffs\n- Payment when ordering, a deposit on custom cakes, and an email or text reminder the day before pickup\n- Paid orders copied into the same list, tested with real test orders and one refund from end to end",
      "Not included:\n- Delivery\n- Photography; I set up the photos you send",
      "Depends on:\n- Your menu with prices, two weeks before go-live\n- Customers choosing to order online; the email, voicemail, and Instagram paths from B stay open",
    ].join("\n\n"),
    fields: {
      ...estimate(32, 39, [
        { work: "Everything in B", hours: sum(SOLID) },
        { work: "Online order page with your menu, pickup times, and holiday cutoffs", hours: 4 },
        { work: "Payment when ordering, deposits on custom cakes, and pickup reminders", hours: 3 },
        { work: "Paid orders into the same list, then test orders and a refund end to end", hours: 3 },
        { work: "Go-live support for the online order page", hours: 0.5 },
      ]),
      timeline: "7 weeks", outsideCosts: "About $20 a month for the service that links Square to your order list, plus Square's card fees on each online order",
      result: "Most new orders arrive paid, with a pickup time, and never pass through the inbox.",
      why: "Pick this if you want customers to pay when they order. It asks them to change a habit, and it would land after the holidays, which is why I'd start with B.",
      costScore: 2, qualityScore: 5, effortScore: 3,
    },
  },
];

/** The option Maria approves */
export const CHOSEN = OPTIONS[1]!;


// --- The work, and the hours it took --------------------------------------------------------

/** The tasks under Execute, in the order they're done */
export const TASKS = {
  form: "Order form and one order list",
  reading: "Order emails and voicemails read into the list",
  summary: "7pm summary and the kitchen's bake sheet",
  safety: "Safety net: nightly copy, alert, and separate sign-ins",
  dryRun: "Dry run on a past week of real orders",
} as const;
export const MILESTONE = "Side-by-side week starts";

/** Every hour Pradeep logs, in order. `when` is days before the handover, for a believable date */
export const HOURS: { work: string; hours: number; when: number; phase: "plan" | "build" | "test" | "handover" }[] = [
  { work: "Accounts set up in the bakery's name; follow-up questions from discovery", hours: 1.5, when: 25, phase: "plan" },
  { work: "Order form with pickup rules and the customer's confirmation", hours: 2, when: 24, phase: "plan" },
  { work: "Order list with statuses; form link and automatic replies", hours: 1, when: 23, phase: "plan" },
  { work: "Order emails read into the list, each marked to check", hours: 3, when: 20, phase: "build" },
  { work: "Voicemail transcripts read into the list", hours: 1.5, when: 19, phase: "build" },
  { work: "Staff form for phone and Instagram orders; possible-duplicate flag", hours: 2, when: 18, phase: "build" },
  { work: "7pm summary for Maria and Sam; Dee's bake sheet", hours: 2, when: 16, phase: "build" },
  { work: "Pickup tags on the label printer", hours: 1.5, when: 15, phase: "build" },
  { work: "Nightly copy, the no-orders alert, and a sign-in for each person", hours: 2, when: 14, phase: "build" },
  { work: `Dry run on ${DRY_RUN.orders} past orders, fixes for two-order emails and photo orders, and two check-ins in the side-by-side week`, hours: 3.5, when: 8, phase: "test" },
  { work: "Go-live support: fixes and questions in the first two weeks", hours: 2, when: 4, phase: "test" },
  { work: "Runbook, recorded walkthrough, training Maria, Sam, and Dee, and handover", hours: 2.5, when: 1, phase: "handover" },
];

/** The updates Pradeep posts: the plan, and the dry run with what it found */
export const UPDATES = {
  plan: { title: "Form and order list are live; email reading starts Monday", body: "The form took its first three real orders today. Next: order emails and voicemails into the same list, each marked to check." },
  dryRun: {
    title: `Dry run: ${DRY_RUN.right} of ${DRY_RUN.orders} past orders landed right`,
    body: `I replayed last week's ${DRY_RUN.orders} orders through the new list. ${DRY_RUN.fixed} needed a fix: emails with two orders in one message, and orders sent as a photo. Two-order emails now become two rows, and a photo order is marked to check with the photo attached. The side-by-side week starts Monday. No change to the estimate.`,
  },
} as const;

/** What the bakery buys itself, with the receipt Maria attaches */
export const PRINTER = { name: "Label printer for pickup bags", paid: "$199.99", receipt: "staples-receipt.pdf", text: "Staples receipt: Brother QL-820NWB label printer, $199.99" } as const;


// --- The money, worked out -----------------------------------------------------------------

const price = priceOf(CHOSEN.fields) as Extract<Price, { kind: "estimate" }>;
const logged = HOURS.reduce((n, h) => n + h.hours, 0);
const earnedCents = Math.round(Math.min(logged, price.hoursHigh) * price.rateCents);
const depositCents = Math.round((price.lowCents * DEPOSIT_PERCENT) / 100);
// Hours logged by the end of each part of the story, for what Maria sees on screen at that point
const through = (...phases: string[]) => HOURS.filter((h) => phases.includes(h.phase)).reduce((n, h) => n + h.hours, 0);

/** The chosen option's figures as the story says them, every one derived from the option and the hours */
export const MONEY = {
  rate: dollars(price.rateCents),
  range: priceLine(price).replace(" estimate", ""),
  low: dollars(price.lowCents),
  high: dollars(price.highCents),
  hours: hoursRange(price),
  expected: hoursText(sum(CHOSEN.fields.basis)),
  deposit: dollars(depositCents),
  logged: hoursText(logged),
  loggedAfterBuild: hoursText(through("plan", "build")),
  earned: dollars(earnedCents),
  final: dollars(earnedCents - depositCents),
  depositCents, earnedCents, finalCents: earnedCents - depositCents,
} as const;

/** Each option's price line and hours, for pages that list the three ("$2,200 to $2,800 estimate") */
export const SUMMARY = OPTIONS.map((o) => {
  const p = priceOf(o.fields) as Extract<Price, { kind: "estimate" }>;
  return { title: o.title.replace(/^[A-C]\. /, ""), price: priceLine(p), hours: hoursRange(p), expected: sum(o.fields.basis) };
});


// --- The handover ---------------------------------------------------------------------------

/** The runbook Pradeep hands over: one page the bakery can follow without him */
export const RUNBOOK = [
  "Maple Street Bakery: orders runbook",
  "",
  "Where orders go",
  "- Every order lands in the Orders sheet, one row each, sorted by pickup: from the order form, an email, a voicemail, or the staff form.",
  "- Rows marked CHECK came from an email or a voicemail. Open the original (linked in the row), fix anything, and clear the mark.",
  "- Phone calls and Instagram messages: fill in the staff form (bookmarked on the counter tablet). It takes about 20 seconds.",
  "- A row marked DUPLICATE? looks like an order already in the list. Compare the two, and delete one if they match.",
  "",
  "Every evening",
  "- The 7pm email lists tomorrow's pickups and anything still marked CHECK. Clear those before closing.",
  "- Print pickup tags: select tomorrow's rows, then Extensions > Print tags (label printer at the front desk).",
  "- Dee's bake sheet arrives by 3:30am: tomorrow's totals by item, with cake messages listed first.",
  "",
  "If something looks wrong",
  "- An order missing: search the inbox for the customer's name, and add it with the staff form if it never arrived.",
  "- No 7pm email, or an alert that no orders arrived today: open the Orders sheet's Triggers page (Extensions > Apps Script > Triggers) and check each one shows as running.",
  "- The list was changed by mistake: yesterday's copy is in the Orders backups folder, one file per night for 30 nights.",
  "- Anything else: email hello@neon1.tech with a screenshot.",
  "",
  "Accounts (all in the bakery's name)",
  "- Google account: Maria is the owner. Sam and Dee each sign in as themselves; Sam can edit the Orders sheet, and Dee can read it.",
  "- The shared password is retired. Nobody signs in as the bakery any more.",
].join("\n");
