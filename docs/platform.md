# The platform console

This system is rented to companies. The console is where you — the person doing
the renting — create those companies, decide what each one has bought, and see
which of them needs a decision today.

It lives at `/platform`. It is not part of the product your customers use, and
nobody who signs in at `/signin` can reach it.

## Two planes, and why

There are two entirely separate kinds of account:

| | Tenant | Platform |
|---|---|---|
| Who | Your customer's own people | You, and whoever operates this deployment with you |
| Sign in at | `/signin` | `/platform` |
| Cookie | `ams_session` | `ams_platform` |
| Session lasts | 7 days | 8 hours |
| Database role | `ams_app` | `ams_platform` |
| Sees | Their own organisation, enforced by the database | Every organisation, but only its commercial facts |

They share a deployment and nothing else. The two cookies have different names,
the two session tables are different tables, and each plane's code reads only
its own cookie — so a tenant session, however privileged inside its own
organisation, buys exactly nothing here. A customer's administrator opening
`/platform` gets the operator sign-in, not a glimpse of anybody's data.

This is asserted, not asserted-ish: `e2e/smoke.spec.ts` signs in as a customer
administrator and then tries the console, in a real browser, against a real
deployment. It is the single most important test in the suite.

The reason for the separation is blunt: the platform role can read across every
organisation, so row-level security cannot protect anybody from it. What
protects them instead is that the role holds almost no grants — see
[What you can and cannot see](#what-you-can-and-cannot-see).

## Creating the first operator

Chicken and egg: the console manages operator accounts, and only an operator can
open the console. This is how the first one exists.

On the server, with `PLATFORM_DATABASE_URL` set:

```bash
npm run platform:admin -- --email you@example.com --name "Your Name"
```

It prints a generated password once and never again. Copy it before closing the
terminal. Run it again for the same address to reset that password, which is
what you will want the day somebody locks themselves out.

It refuses to run without `PLATFORM_DATABASE_URL`. The account it creates can
see every customer on the deployment, so it is created over the platform
connection or not at all.

## Provisioning a customer

**Customers → New customer.** You give the company's name, the address of their
first administrator, and a plan. In return you get a password, shown once, to
hand over.

Behind that one form:

- the organisation is created, with its slug — which appears in URLs and
  exports, and cannot be changed afterwards;
- its four standard roles are created and given their permissions;
- its notification rules are created, so its reminders work on day one;
- its first administrator is created with the password you are shown.

The password is never stored anywhere you can read it back. If it is lost before
the customer signs in, use the invitation flow or reset it — do not go looking
for it.

Set a trial end date now if there is one. The console will remind you two
weeks before it lapses; nothing will happen automatically when it does.

## What each feature means

A feature is something a customer would recognise on a price list and could
sensibly not have. They are defined in code (`api/src/lib/platform/features.ts`)
rather than in the database, because a feature means something only where a
handler checks it — one invented in a plan would sell air.

| Feature | What the customer loses without it |
|---|---|
| **Asset register** | Nothing — it is in every plan. The register, custody and history. |
| **Spreadsheet import** | Bringing an existing register in from CSV or Excel. |
| **Labels and scanning** | Printable QR and barcode sheets, and scanning with a phone. |
| **Stock-takes** | Counting sessions, and the report of what is missing. |
| **Maintenance schedules** | Repeating servicing with reminders before the date. |
| **Depreciation** | Book values, and the register's worth at month end. |
| **Reports** | The report catalogue and its downloads. |
| **Scheduled reports** | Reports run on a timetable and emailed out. |
| **API access** | API keys and the published v1 API. |
| **Webhooks** | Signed event delivery to their own endpoint. |

Plans are rows, not code: **Plans** in the console creates, prices, edits and
retires them, because prices move and tiers get renamed without a deploy.

On one customer's page, each feature can be turned on or off regardless of their
plan. That exception sticks with the customer, survives a plan change, and shows
on their page as "turned on for this customer" so the next person knows somebody
decided it rather than the plan granting it. The asset register cannot be turned
off: an account that can sign in and do nothing is a support call, not a plan.

## What happens when a limit is reached

Limits come from the plan, and can be overridden per customer.

A limit refuses **writes** and nothing else. A customer who has hit their asset
cap:

- can still sign in, search, run reports and export everything they have;
- cannot create another asset until the cap moves or something is deleted;
- is told exactly what happened — which limit, what the cap is, and that the
  fix is a conversation with you — not "something went wrong".

Reads and exports are never refused. Holding a customer's data hostage over a
commercial disagreement is not a feature.

You will see them on **Needs attention** as "over their limit" with the numbers,
because their work is being refused right now. That is the most urgent thing the
console ever shows.

## Suspension versus deletion

**Suspension is reversible and is what you almost always want.** A suspended
customer cannot sign in and their API keys stop working, but every row they own
is untouched. Their people are told the organisation's access is suspended and
to contact whoever manages the subscription — never that their password is
wrong, which would send them to fix something that is not broken.

Lifting it restores everything immediately. A reason is required, and it is kept
with the record, because somebody will ask months later.

**Deletion is permanent and cascades.** Every asset, attachment, document and
record of that customer goes, and no part of the console can bring any of it
back. It asks you to type the customer's slug first. Take a backup you can
actually restore ([the restore runbook](runbooks/restore.md)) before you do it,
and prefer suspension unless the customer has asked you in writing to erase
them.

Nothing suspends or deletes anybody automatically. A lapsed trial, an unpaid
renewal and a customer over their limit all show up on **Needs attention** and
wait for a person. The console keeps records; it does not enforce contracts.

## What you can and cannot see

The console shows **counts and commercial facts**, never the contents of
anybody's register. You can see that a customer holds 620 assets; you cannot see
what any of them are.

That boundary is grants in the database, not a convention in the code above it:

- `assets` — only the columns needed to count (`org_id`, `deleted_at`). Names,
  serial numbers, purchase prices and locations are unreadable.
- `attachments` — only `org_id` and `size_bytes`, so storage can be totalled.
  Filenames and the files themselves are unreadable.
- `sessions` — only `org_id` and `created_at`, so "nobody has signed in for two
  months" can be answered. Who and from where are unreadable.
- `audit_events`, `email_messages`, and every other tenant table — no grant at
  all.

A bug in the console cannot turn into a data breach of something it was never
granted. `api/src/lib/platform/db.test.ts` asserts each of these refusals.

There is deliberately **no impersonation**. "Sign in as this customer to see
what they see" is the feature every console of this kind grows and the one that
makes the boundary above meaningless. If it is ever added it needs its own
design: time-boxed, announced to the customer, and on the record.

Everything you do here is written to `platform_audit` — who, what, which
customer, when. That table can be inserted into and read, and never updated or
deleted, including by you.

## Day to day

**Needs attention** is the front page, and it is a list of customers rather than
a dashboard, because the question is "who do I need to do something about" and a
chart has never answered it. A customer appears once, with every reason beside
them, busiest first:

- **Over their limit** — writes being refused now.
- **Trial** — ending within two weeks, or already lapsed.
- **Renewal** — due within the month.
- **No plan** — they can use the register and nothing else.
- **Suspended** — for over three months, so it needs deciding either way.
- **Dormant** — nobody has signed in for two months.

An empty list is the right answer, not a page of zeroes. If nothing is on it,
there is nothing to decide today.

## Trying it

The demo seed creates an operator (`ops@demo.local`, with `SEED_PASSWORD`) and
two customers: one healthy on Professional, and one on Starter that is over its
asset cap and three days from the end of a trial — so the console has something
real to show the first time you open it.

Re-seeding never resets an operator password that already exists. If it is not
the one you expect, reset it with `npm run platform:admin`.
