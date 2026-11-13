# Changelog

1NEON releases use `v0.MINOR.PATCH` until the first complete release, v1.0.0 (see neon1's [versioning standard](https://neon1.tech/knowledge/standards/versioning/)). Each release is tagged on the commit that shipped it, once it's live.

## v0.10.0 - 2026-11-13

### Added
- **A deposit share per option.** An option says how much is asked up front: the usual 50%, or what the client agreed (20%, or nothing). The proposal, the approval, and every deposit invoice follow it, including a second deposit draft made while the first is still a draft.
- **Revise terms after approval.** neon1 drafts revised terms from the approved option; the card says what changes ("Deposit up front: 30%, was 20%"), they go out in the next revision, and the client approves them in place of the original. Money already invoiced counts toward them, so only the difference is drafted.
- **Edited proposal copies.** A Word file carrying a proposal's ID (edited in Word, Google Docs, or Pages) is asked about on upload. Kept with that revision, it shows what changed word by word, maps each change to the option field it belongs to (deposit share, title, description, timeline, hours, result), and applies the checked ones, to a shared option directly or to revised terms for an approved one. Changes that fit no field are listed to answer by hand.
- **Option history.** Each option shows when it was added, issued in each revision, approved and signed (with the signed name and reason), replaced, revised, invoiced, and paid.
- **Download everything.** An organization's admins can download a copy of all of it from Settings, any time, without asking neon1: one zip with every project's records, decisions and signatures, proposals, invoices, payments, and handover steps as JSON and CSV, every uploaded file as uploaded, and a README saying what each file holds.
- **Pay from 1NEON.** The Pay button shows in neon1's own organization too, and neon1 can copy a client's pay link to send.
- Copies of what you sign (approvals, changes, the agreement, handovers) reach you by email and in the bell; billing in neon1's own organization reaches neon1.
- Moving a project back to Decide or before once an option is approved asks for a reason, and Next step says when the board is behind what's been done ("An option is approved: move to Build").

### Changed
- Maria's bakery, in every walkthrough and the sample project, is re-estimated to match the Knowledge Center's proposal: account setup and discovery follow-up, training for each person, and two weeks of go-live support are now listed. Her chosen option is 22 to 28 hours ($2,200 to $2,800 at $100 an hour, a $1,100 deposit); the work took 24.5 hours, and the final invoice comes to $1,350.
- Proposals, previews, invoices, and documents open in a new tab.
- Money boxes show a $ sign, the deposit box a % sign; new invoice lines come filled in from the approved option and can be changed or added to, with a running total.
- Forms and dialogs have even spacing between fields and buttons; date boxes keep their width on phones.
- On phones, the box being typed in, and the line being typed in a long one, stays above the keyboard as it wraps; scrolling away to read is left alone until the next keystroke. Dialogs stay in the part of the screen that's showing, and a panel's name and Close stay at its top.
- A typed signature has to read as the signer's name.

### Fixed
- On iPhone browsers (DuckDuckGo included), the strips above the top bar and below the tab bar are solid, so nothing scrolls by under the browser's own bars.
- An option panel no longer runs under the browser's top bar, out of reach of its Close button.
- **Check invoices** under Next step goes to the invoices again when pressed a second time.
- A new deposit draft no longer replaces a typed amount with the 50% suggestion.

## v0.9.0 - 2026-11-13

### Added
- **Change the decision.** After an option is approved, the decision maker can still choose another one, until the handover is accepted. The change asks why, shows what it replaces, what was already invoiced, the hours already logged, and the deposit asked now, and is signed like an approval. Nothing is billed twice: money invoiced for the earlier option counts toward the new one, an unissued deposit draft for it is replaced, and if what was invoiced comes to more than the new option can cost, accepting the handover drafts a credit for the difference. The earlier decision stays on record, marked replaced, with the reason on the new one. A replaced option can be chosen again once neon1 confirms it in the next revision. Everyone who follows decisions is told.
- Archive a project from the project list or the timeline, behind a quiet menu at the end of each row.
- A question before archiving a project or deactivating a person, saying what happens and how to undo it.

### Changed
- The walkthrough's narration sits in a band under the controls, above the page, so it never covers what's happening. Every walkthrough plays about 15% slower, and Maria's thoughts wait until the narration has had time to be read. Each says its new length: the preview about three minutes, the whole story about 17, and a chapter on its own a few minutes.
- The bakery example and the demo are priced at $100 an hour, the rate for small-business workflow work: Maria's chosen option is now $1,200 to $1,500, and her final invoice comes to $775 after a $600 deposit.
- A project's stage says how long it's been there in words ("Decide for 4 days", "since today"), not "0d".

### Fixed
- On phones, the walkthrough's Start and end cards are centered on the screen.
- In DuckDuckGo on iPhone, the strip under the browser's toolbar no longer shows the page scrolling under the tab bar.
- Checkboxes keep their size: the consent box when signing was stretched across the dialog, squeezing its words into a narrow column on phones.
- A pressed link styled as a button, such as **Compare options** under Next step, kept a readable label.

## v0.8.0 - 2026-11-13

- `infra/envs/dev`: a dev backend for dev.neon1.tech/1NEON with its own Cognito pool (auth-dev.neon1.tech), table, and buckets; no texts, no malware scan, and a one-day lock on test records. The `dev` workflow ships the API and app there; `dev-sync` keeps the `dev` branch following main.
- Modules take a `boundary` (api, storage) and `retain_days` (records); production keeps its values. Sign-in code emails link to the environment's own portal, and contact form mail sent from dev says "[dev]" in its subject.

## v0.7.1 - 2026-11-13

### Fixed
- The emails shown in a walkthrough no longer make the browser log dozens of refused styles. Nothing looked wrong on screen: the styles were applied a moment later, as intended, but each one was first refused by the site's content policy as the email was read.

### Changed
- The walkthrough check that gates every release now applies the same content policy neon1.tech sends, so anything the live site would refuse fails the check before a release.

## v0.7.0 - 2026-11-13

### Added
- An option's price is now one of two kinds, and says which. A **fixed** price is the whole price for the work described. An **estimate** is a range of hours at an hourly rate: you pay for the hours worked, and the total never passes the high end unless you approve a change first.
- **How this adds up**, under every price: the work behind it line by line with the hours each piece should take, the expected total, and **When you pay** (the deposit at approval and the rest at handover). The approval restates the price, what kind it is, and when you pay before you sign. The proposal and its Word copy print the same breakdown.
- Each option says why neon1 recommends it, or when it's the right one to pick.
- **Hours**, under Execute: every entry neon1 logs, with its date, what the time went to, and how long it took, beside a bar showing the hours against the estimate and what they come to so far. Hours past the high end are listed and not billed. Only neon1 adds entries, and an entry stays as logged once an invoice bills it.
- An invoice for hours lists each entry it covers, so its total can be checked against the work, and the line that subtracts earlier invoices names them by number.
- Two walkthrough chapters, **Pay the deposit** and **Pay the final invoice**, so the full story shows both invoices and how each was worked out.
- A bank payment (ACH) shows on its invoice from the day it's started: "bank payment clearing", with the amount and the date. While it clears, **Pay** is gone and the invoice isn't counted as overdue, so nobody pays twice. If the bank refuses it, the invoice says so, is open again with **Pay again**, and both sides are told the same day. Before this, an invoice looked unpaid for the days a transfer took, and a refused one left no trace the client could see.
- When an estimate's hours come to less than the deposit, accepting the handover drafts a credit for the difference against the deposit invoice, so the refund the service agreement promises is on neon1's list to issue and not left to memory.
- **Accept the handover**: once every handover step is done, the decision maker accepts all of them with one signature. Each step is still signed for, and an accepted step stays done.
- **Needs you**, on Home, now lists invoices to pay (with the due date, overdue first), drafts for neon1 to issue, and a handover ready to accept.
- In the interactive demo and the walkthroughs, **Pay** opens a stand-in for the payment page that says no money moves, and lets you pay by bank or card to see each outcome. In the demo you can also play the bank and clear or refuse a transfer.
- FAQ answers: whether a price is fixed or an estimate, where the hours worked are listed, what happens if the work needs more or fewer hours than estimated, what happens if a bank payment doesn't go through, whether you get a receipt, whether paying by card or paying late costs more, and what to do if an invoice looks wrong.

### Changed
- The service agreement is edition 2.0. Its Paying section says how fixed prices and estimates are billed, that a deposit counts toward the final invoice, and that any difference is refunded if the work comes to less than a deposit paid. An organization that signed edition 1.0 signs 2.0 before its next approval, and its earlier signature keeps the text it was given.
- Deposits: half of a fixed price, or half of an estimate's low end. The final invoice on an estimate is the hours worked, less earlier invoices.
- Maple Street Bakery, the fictional client in every walkthrough and on the sample page, is rebuilt as one consistent example: a team of eight taking orders by email, voicemail, and Instagram; limits found before any option was written; three options priced as estimates with the hours behind each; a dry run on a past week of real orders; 21 hours logged against an estimate of 20 to 24; and a deposit and a final invoice that add up. Every figure is illustrative.
- The interactive demo offers an estimate beside a fixed price to choose from, and its project in progress shows hours, a paid deposit, and an open invoice worked out from those hours.
- The full story is 14 chapters and says about 13 minutes.
- **Next step** tells a client who has the work: "Build is with neon1. It's done when: all milestone tasks done. Then neon1 moves the project to Verify. Nothing needs you right now." It used to tell the client to move the project themselves. Moving a stage from Next step is offered to neon1.
- "Handoff" reads "handover" everywhere, and a finished step no longer offers its own signature beside the one that accepts them all.
- An email about an invoice or a payment opens that invoice, with **See the invoice**, where it used to open Home.
- Notices about payments name the payment page as their source, where they used to say "Someone".
- Progress counts skip records: hours, invoices, payments, decisions, and updates are never counted as work to finish.
- The interactive demo's history reads in order: each project was created before the stages it has passed, its proposal was issued the day it reached Decide, and each project's health says who assessed it and when.
- A walkthrough of one chapter sets the story up a second time by itself if the first setup stumbles, and only then shows a card.
- The demo bar's **Switch person** and **Start over** are as tall as the bar, so they're easy to tap on a phone.

### Fixed
- A project tab tapped just before another link (two quick taps on a busy phone) could leave the tab's page on screen under the link's address. The page shown now always matches the address, and a tab still slides to the next one.
- A walkthrough could stop partway in Safari while it set the story up out of sight, for the same reason. Setup now moves between pages without sliding, and a step that can't find what it needs says what the page showed instead.

## v0.6.0 - 2026-11-13

### Changed
- Every guided walkthrough now waits for you. It opens on a card that says who Maria is, what you'll see, and how long it takes, and nothing moves until you press **Start**. Coming back after a refresh, the card offers to continue where you left off or start from the beginning.
- Every walkthrough ends on a closing card that says what happened, with **Watch again**, the full story or the interactive demo, the other walkthroughs, help, and a way to get in touch.
- The narration is a line at the bottom of the screen, like subtitles, and screen readers hear each new line. The bar at the top keeps only the chapter's name and the controls.
- The full-screen chapter title between chapters is gone. Chapters follow one another without a cut.
- Maria gets everywhere the way a person does. She opens the menu and picks the page, including her profile, and she reaches the service agreement from a notice above her options and returns with **Back to your options**.
- Jumping ahead, or opening one chapter from help, shows a loading screen that names the chapter and fills a line while the story so far is set up. That setup takes about half the time it did.
- If a walkthrough can't play a step, it stops on a card that says so and offers to play the chapter again, start over, or try the demo, in place of looping.
- **Exit** returns to the page and the question you came from. The cookie and storage notice lists the one item this saves in your tab.
- Each walkthrough's stated length is now measured: the full story says about 11 minutes (it said 8), and the short ones say one to two minutes each. The FAQ says the same length, and a test keeps the two in step.

### Added
- A notice above the options tells a decision maker when the service agreement needs signing first, with a link to read and sign it and a button back to the options afterwards.
- A check that plays every walkthrough in a real browser, on a desktop and a phone screen, and stops a release if any of them doesn't reach its end. It also jumps between chapters, reloads partway, pauses and clicks around, turns the phone, and leaves the tab, and it fails when a walkthrough takes much longer or shorter than it says it does.
- A phone's screen stays lit while a walkthrough plays, and dims as usual once it's paused or over. Browsers without that ability behave as before.

### Fixed
- On phone browsers that float their controls over the page (DuckDuckGo on iPhone), the strip under the menu showed the page scrolling by. The menu, the dimmed backdrop behind it, and the walkthrough's cards and loading screen now reach the screen's edge, as the tab bar already did.
- The short walkthrough no longer redraws the page a moment after it opens.
- Maria's cursor no longer rests on top of the opening card.
- On a phone with the mini menu, the walkthrough picked the wrong menu item for People and Projects and stopped. It now finds each page by where its link leads.
- In the "Texts and text codes" walkthrough, the menu stayed open over the profile and the walkthrough stopped.
- A measure that starts at zero keeps its zero in the "Measure it" chapter.
- Pausing a walkthrough and closing its open dialog with Escape, then pressing Play, replays the chapter from its start, as clicking around already did.
- Changing tabs twice in quick succession no longer logs an error in the browser's console.

## v0.5.2 - 2026-11-12

### Fixed
- The two-minute walkthrough at /1NEON/live plays to the end again. Approving now needs a typed signature and a signed service agreement, and the short version stopped at the approval; Maria now signs both, as in the full story.

## v0.5.1 - 2026-11-12

### Changed
- Help matches the proposal as it works now: the proposal opens from **Read the proposal** and downloads as Word as well as PDF, and the approval lists its terms again, including anything to buy, before you sign.
- Help answers three more questions: how to suggest changes with a marked-up copy, who buys equipment or software (with receipts and paying back at cost), and what happens to a request made after approving. Searching help for markup, change order, reimburse, or an expired quote now finds them.
- The sample project shows the numbered proposal and option ID, the signed approval, the label printer bought with its receipt, and the handover accepted by the owner.
- Neo answers from the updated help (corpus v0.37.1).

## v0.5.0 - 2026-11-12

### Added
- Proposals are issued in numbered revisions, one proposal per project. neon1 issues a revision (the first is 0039-r1), which freezes a copy of everything the proposal shows; every option in it gets an ID such as 0039-r1-B, and the decision names it. Earlier revisions stay readable, marked as replaced, and none can be edited or deleted.
- Approving restates exactly what's being accepted: the option and its ID, the proposal it's from, the estimate, the timeline, neon1's time, what's paid directly, what's to buy, and the result to check. An option edited after its revision was issued waits for the next revision.
- A price check replaces expiry: a revision shows when its estimates were checked and when to recheck. After that date approval waits, the client can ask neon1 to refresh, and refreshing issues the next revision.
- Purchases in Execute, filled in from the approved option's expected purchases and marked with its ID. Each shows its estimate, what was paid and where, who buys it, and its receipt, with a flag when a bought item has no receipt yet. Items neon1 buys need the decision maker's initials, on the approval or afterwards, and are paid back at cost.
- Download a revision as a Word file. The proposal's ID travels in the file name, a document property, and the header on every page, so a marked-up copy uploaded to Files is recognized ("Is this a revision of Proposal 0039-r1?") and filed under Files → Proposals with the revision it answers.
- Constraints and assumptions, as their own list in Needs and their own section of the proposal.
- A request added after a decision asks whether it changes the agreed scope; one that does is flagged for the next revision.
- Handover steps can be checked and accepted by the decision maker, with a note on what they checked.
- neon1's service agreement, in 1NEON and at /1NEON/agreement. An admin of a client organization signs it once, with their typed name and a consent box, before the first option can be approved. The signature records the edition, a fingerprint of the exact text, the time, and where it came from.
- Approvals and handover acceptances are signed the same way. The approval records a fingerprint of the terms that were signed, the printed proposal and its Word copy show the signature, and initials for purchases come from the signed name.
- Invoices under Execute: a deposit invoice is drafted when a fixed-price option is approved and a final invoice when the handover is accepted. Reimbursement, progress, care plan, and credit invoices can be added too. neon1 checks a draft and issues it; issuing numbers it (such as INV-0039-01), sets its due date, and fixes its contents with a fingerprint. Clients never see drafts.
- An invoice page on neon1's letterhead, ready to print or save as a PDF, showing the lines, credits, payments, what is left, and how to pay.
- Pay online through Stripe Checkout, by bank transfer (ACH, preferred) or card. Stripe's signed webhook records the payment once, including bank payments that clear days later. Checks, Zelle, and wires are recorded by neon1. If the Stripe account can't take bank payments yet, Checkout offers card alone.
- Issued invoices and payments are permanent. A mistake is corrected with a credit or by voiding with a reason, and an invoice with payments can't be voided. A locked copy of every signature, issued invoice, and payment is kept for seven years.
- A Billing notification group (on by default) for signatures, issued and voided invoices, and payments.
- A "Pay an invoice" chapter in the walkthrough (/1NEON/live?play=pay): Pradeep issues the deposit, Next step tells Maria it's ready, she reads it on the letterhead and pays it by bank transfer. The full story also has her sign the service agreement and her approval, Pradeep finish his own handover steps, Maria sign her acceptance, and the final invoice paid in Care.
- Pay on the invoice page itself, as well as in the project's Invoices.
- The interactive demo's Backups that restore project has a deposit paid by bank transfer and an open progress invoice to pay.
- Help: what a proposal revision is, how to accept a handover step, and a new Invoices and paying section (where invoices are, how to pay, when they're sent, corrections, and the service agreement), each with a walkthrough link.

### Infrastructure
- A records bucket with S3 Object Lock (governance mode, seven years) for the locked copies.
- Stripe's restricted key and webhook signing secret are read from SecureString parameters (/1neon/prod/stripe/...). Terraform creates them with placeholder values and never sees the real ones; until they are set, online payment stays off.

### Changed
- Approving an option or accepting a handover step needs a typed signature; initials alone no longer approve. Neo can't approve on anyone's behalf and points to Approve instead.
- The help page explains invoices, paying, and the service agreement.
- The printed proposal shows the date its revision was issued, which no longer moves when an option is edited or approved, and only the acceptance recorded against that revision. Each printed page carries the proposal's ID and its page number, and a demo proposal says on every page that it's a fictional sample.
- Maria's walkthrough reads the numbered proposal, sees the approval restate the terms, buys the label printer from her option and attaches the receipt, marks Sam's training done, and accepts the last handover step. The runbook she receives is a full page instead of one line.

### Fixed
- A guided walkthrough no longer stops at "One moment…" for someone whose Projects page is set to Timeline. The walkthrough keeps its own List or Timeline choice, last organization, and loading background in memory, so it never reads or changes the visitor's own, and it opens a project from either layout.
- Before Start (with reduced motion on, or in a tab opened in the background), Back, On, and the chapter list start the walkthrough at the chosen chapter instead of throwing an error.
- Jumping to a later chapter sets it up behind a panel that names the chapter, so the earlier chapters' screens no longer flash past. The bar shows the new chapter and its neighbours from the moment it's chosen, and no thought from the skipped chapters carries over.
- The interactive demo keeps changes made in two tabs. Each change is applied on top of whatever another tab saved, under one lock shared by the browser's tabs, and is confirmed only once it's saved. Tabs opened together share the same starting data.
## v0.4.5 - 2026-11-12

### Added
- A closed project leads with the short version of its handover: what changed (the agreement as approved and the finished changes), the measured result before and now, who owns each system or account, and how much of the handoff checklist is done. Only the parts the project has are shown.

### Changed
- The Terms of use open with a short version, matching the Privacy policy. Nothing else in them changes.

## v0.4.4 - 2026-11-12

### Fixed
- In the interactive demo, Switch person starts the next person at their own home, instead of on a page from an organization they can't open.
- In a paused walkthrough, the messages in Maria's pretend inbox are buttons, so they open from the keyboard as well as with a click.

### Changed
- Help says how someone who has lost every second step gets back in: an email from the account's address, then a call to a phone number already on record and, where there is one, another admin's written OK, before anything is removed.

## v0.4.3 - 2026-11-12

### Changed
- The privacy, terms, and cookie pages name their Knowledge Center copies as the page for search engines to credit, so a search for neon1 shows the site instead of a portal screen.
- The portal lists neon1.tech's 192px matrix green icon first, the one search results show.

## v0.4.2 - 2026-11-12

### Changed
- Text messages have their own block under Notifications on your profile, apart from the email choices. The yes to texts and every kind of text start unticked, and the kinds stay off until you agree to texts. The email column keeps its defaults.

## v0.4.1 - 2026-11-12

### Fixed
- In DuckDuckGo on iPhone, the strip below the bottom tab bar shows the theme's background instead of the page scrolling underneath it (the v0.3.3 fix didn't take there). The tab bar is now solid rather than see-through.

### Changed
- The demo's sign-in screen is laid out like the real one: an "Interactive demo" heading with its line under it at the same size as the client portal's, the FAQs and policy links under the people, then a divider and the guided walkthrough link, where the real sign-in has the sample and the demo. The people's names and roles read a size larger.

## v0.4.0 - 2026-11-11

### Added
- **Read the full proposal**, under a project's options: discovery, goals, every shared option with what's in and out, neon1's hours, price, timeline, and outside costs, what each side will do, and the agreement, as one page in neon1's letterhead look. **Print or save as PDF** prints only the proposal. Once an option is approved, the page shows who approved which version and when; before that, it has signature lines.
- Options carry neon1's estimated hours, the costs paid directly to vendors, and the result the client can check. All three are copied into the decision when an option is approved.

### Changed
- The bakery's options in the walkthrough and the example are re-estimated from the actual work: about 3, 10, and 17 hours, with prices and timelines to match, and each lists what's included, what isn't, and what it depends on. In the walkthrough, Maria reads the full proposal before she approves.
- An option's card shows its first paragraph; the full details are in its panel and the proposal.

## v0.3.3 - 2026-11-11

### Fixed
- In DuckDuckGo on iPhone, the strip below the bottom tab bar shows the theme's background instead of the page scrolling underneath it, whether the browser's toolbar is showing or not.

## v0.3.2 - 2026-11-11

### Changed
- Text is set in Figtree, the typeface neon1.tech now uses, and emails ask for it too. JetBrains Mono stays for labels and codes.

## v0.3.1 - 2026-11-11

### Changed
- The tab icon is neon1's mark on a transparent background, matching the app's theme: brand green on awake, matrix green on Matrix. It replaces the rings.

## v0.3.0 - 2026-11-11

### Added
- Home's calendar shows a full month, headed by the month and year, with arrows back and forward, a Today button, and a jump to any month. Click a day to see what falls on it and add leave, an office closure, a meeting, a care plan call, or anything else that affects the work, once or repeating weekly or monthly.
- The calendar's lists fold the same way as the rest of 1NEON: Past and Repeated start closed, and Upcoming (formerly Later) starts open.
- Home has a "Projects at a glance" card, with each project's stage, health, progress, and next step, and an "Away this week" card listing who is on leave.
- A new "What is the calendar on Home?" walkthrough.

### Changed
- The 1NEON mark sits in the top bar beside the menu button, lined up with the mark inside the menu, in full and Mini mode, and both lead Home.
- Every change in the activity record says what changed ("status To do → Done; due Nov 3, 2026 → Nov 7, 2026") instead of just "Updated", for projects, work, people, stages, and calendar events. A save that changes nothing records nothing.
- The bell splits notifications into New and Earlier, so it is clear which ones you hadn't seen before opening it.
- On Home, Deciding opens the Decide stage on the Needs page and Building opens the Execute page, instead of both opening the board.
- Each FAQ walkthrough plays on its own, from signing in to the end of that topic, then stops. The bakery's earlier steps are set up out of sight first, so nothing unrelated plays on screen.
- Maria's thoughts stay up long enough to read, beside the part of the page they're about, and clear before the next step starts.
- The walkthrough cursor is a clean pointing hand over things you can click and a grabbing hand while dragging, in neon1's colors, with the arrow everywhere else.

## v0.2.4 - 2026-11-11

### Fixed
- Going Back from the invite demo's first look no longer leaves the welcome tour's shade and popover over the sign-in, and the replayed sign-in keeps the email the invite link filled in.
- The FAQ link into the full story's Needs chapter no longer goes off script on phones: catching up waits for the new project's page to open before Maria signs in and walks there.

## v0.2.3 - 2026-11-11

### Fixed
- On iPhone (Safari, DuckDuckGo, and Chrome), the sign-in box sits between the top bar and a bottom row that holds Neo's button and the rain controls, so neither covers the form or its border, and the browser's bottom toolbar stays dark like the top one instead of turning white.
- The 1NEON wordmark spells out as "1portal Needs Execute Observe Normalize", with a small gap between the words, and a tap on a phone opens it for a few seconds instead of leaving it open.
- In a walkthrough, the sign-in box centers in the screen below the walkthrough's bar instead of running off the bottom.
- Coming back to a walkthrough after switching apps or tabs plays on by itself, and time while the phone had the page frozen no longer counts against a step, so it doesn't go off script.
- Going Back a chapter in a walkthrough replays it from a clean start: a half-finished sign-in, a passkey added later, or a welcome tour already offered no longer send the invite and passkey demos off script.
- The browser's Back button inside a walkthrough returns to the page that linked to it (an FAQ, say) instead of stepping back through the pages the story visited.
- The passkey demo plays in browsers with no passkey support of their own.
- The sample project fits a 320px-wide phone without a sideways scroll.
- No more "blocked eval" errors logged on every page in Firefox and Safari.

### Changed
- The walkthrough's cursor is the plain arrow everywhere (an I-beam over text fields), with no pointing or grabbing hand.

## v0.2.2 - 2026-11-11

### Changed
- The privacy policy's Neo paragraph matches the website's word for word, and says plainly that Amazon Bedrock doesn't keep questions or answers, or use them to train models.

## v0.2.1 - 2026-11-11

### Changed
- Every guided walkthrough starts at the beginning: Maria on the sign-in screen with a thought about what she's come to do, the real email-code sign-in, and then the walk, menu by menu and tab by tab, to the page she needs. That includes the opening preview, the short demos, and links from the FAQs into the middle of the story.
- The sign-in box sits evenly between the walkthrough's bar and the bottom of the screen, and on phones it keeps clear of the rain controls.

### Fixed
- Pausing, changing the speed, or stepping Back and forth no longer makes a walkthrough stall, restart, and replay from the beginning. Time spent paused no longer counts against a step, a section's saved starting page is read once the page has settled, and pausing leaves an open notification list open.

## v0.2.0 - 2026-11-11

### Changed
- Next step and the Overview name the same current agreement: the decision no later approval replaced. Earlier approvals stay in Needs, marked replaced.
- Today, overdue, on time, the weekly counts, and a new reading's date follow the organization's calendar (Eastern time by default), so an evening in New York is still that day.
- A measure whose starting point already equals its target counts as reached by the same rule on its card and in Insights, using which direction is better.
- Every measure number (new project, Add measure, the item panel, and a reading) follows one rule: blank is unset, 0 is 0, and anything else must be a plain number. "1,5" or "1..2" shows a message under the field instead of being changed or dropped.
- Uploads run file by file. If some files don't make it, the rest still finish, the message says which, and Retry sends only those. An upload can be cancelled, and a stalled transfer stops with a message.
- Files that are still being checked for viruses update on their own, with Check again; archived projects show as unavailable for new uploads.
- Search opens with Ctrl+K (Cmd+K on a Mac) only; a bare "/" no longer does.
- Board cards can move up or down within their column from the same Move menu, without dragging.
- The help sheet has a Close button, the onboarding tour holds still with reduced motion, and toasts are read once and stay longer when they say more.

### Fixed
- Posting a status update starts from the project's current health, and says so when the chosen health differs.
- A slow save, comment, add, or workflow save no longer clears or closes over text typed while it was pending.
- Retrying a request with several needs after part of it failed, or after a lost reply, doesn't create the sent ones twice.
- A failed reading keeps the number in the box.
- A target date conflict shows both dates before Keep mine.
- Setting up an authenticator app ignores replies from a setup that was cancelled, and keeps errors in the dialog beside the code.
- The Enter that confirms an input method's candidate no longer adds an item or an action.
- Focus: arriving on a page puts it on the page title, each New project step announces itself, and Escape from the bell or the walkthrough lists returns to their button.
- On phones, Neo's launcher and window sit above the bottom tab bar, and the open menu keeps full-size rows and scrolls.
- Read-only board cards no longer mark their project links as disabled, and template cards show keyboard focus.
- Coming up and Insights refresh after changes like the rest of the organization's pages.

## v0.1.1 - 2026-11-10

### Fixed
- Emails in the walkthrough, such as the sign-in code, show their own layout on neon1.tech instead of plain text.

## v0.1.0 - 2026-11-10

The first tagged release. 1NEON had been live at neon1.tech/1NEON since 2026-11-06, deployed from main without version numbers; this entry records what that release holds.

### Added
- Sign-in by email with an emailed code or a passkey, and "Confirm it's you" with a passkey, an authenticator app, or a texted code before admin actions.
- Organizations, people with viewer, editor, and admin access, and invitations by email.
- Projects through Needs, Execute, Observe, and Normalize: requests, discovery questions, requirements, options with cost, quality, and effort, approvals with conditions, tasks and milestones, status updates, measures, files, handover, and care.
- Home, the board, Insights, search, notifications under the bell with per-kind email and text switches, and Default and Mini menus.
- Awake (light) and Matrix (dark) themes that follow a choice or the device.
- The interactive demo, a sample project, the guided walkthrough with a primer, the code sign-in, and five short demos, and FAQs that link into the walkthrough.
- Neo for signed-in people, off until its model is switched on.
- The contact route behind neon1.tech's form.

### Fixed
- Phone pages no longer zoom out when a project's tabs or the invite form are on screen.

## Before v0.1.0

1NEON shipped from main for several days before releases were tagged. These pre-releases mark the points in that history where a meaningful piece landed, on the commits as they are on main. They were tagged on 2026-11-10; the dates below are when each one shipped.

### v0.1.0-alpha.8 - 2026-11-10
- Neo for signed-in people, grounded in the 1NEON guide, and the contact route takes any number of topics or none.

### v0.1.0-alpha.7 - 2026-11-10
- Review fixes across new projects, Home, requests, Insights, and the outbox; route titles and descriptions; FAQs that link each answer; and a release that's fully checked before any AWS change.

### v0.1.0-alpha.6 - 2026-11-09
- A Watch it link on every FAQ the walkthrough can show, the contact form endpoint for neon1.tech, and plainer thoughts for the demo's client.

### v0.1.0-alpha.5 - 2026-11-09
- Notifications open what they're about, Default and Mini menus, items that edit, check off, and delete the same way, and Next step after each action.

### v0.1.0-alpha.4 - 2026-11-09
- A facet review of every page, search that offers only what you can do, one release workflow for infrastructure and app, and API routes split by feature.

### v0.1.0-alpha.3 - 2026-11-09
- Four short demos, the branded sign-in code email, and text notices in the portal.

### v0.1.0-alpha.2 - 2026-11-09
- A hardening pass: a durable outbox for notices and invitations, texted codes to confirm it's you, safer decisions and uploads, a full-history secret scan before deploys, and signed-in pages that load on first visit.

### v0.1.0-alpha.1 - 2026-11-08
- The earliest commit in the published history: the portal, the demo, and a walkthrough that holds up to jumps, pauses, and clicks.
