# Changelog

1NEON releases use `v0.MINOR.PATCH` until the first complete release, v1.0.0 (see neon1's [versioning standard](https://neon1.tech/knowledge/standards/versioning/)). Each release is tagged on the commit that shipped it, once it's live.

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
