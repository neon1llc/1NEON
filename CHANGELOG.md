# Changelog

1NEON releases use `v0.MINOR.PATCH` until the first complete release, v1.0.0 (see neon1's [versioning standard](https://neon1.tech/knowledge/standards/versioning/)). Each release is tagged on the commit that shipped it, once it's live.

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
