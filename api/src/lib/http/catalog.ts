import { ERROR_BASE } from "./problem";

/**
 * Every error the API can return, what causes it, and what to do about it.
 *
 * The developer portal promises exactly this. A hand-maintained list is wrong
 * the first time somebody adds `problem(409, "asset-checked-out", …)` and
 * forgets the documentation, so the test beside this file reads the slugs out
 * of the source and fails when the two disagree. That turns a documentation
 * promise into a build failure.
 *
 * `fix` is written for the person holding the failing request. "Check your
 * input" helps nobody; naming the field and the constraint does.
 */

export interface ErrorEntry {
  slug: string;
  status: number;
  title: string;
  /** When this fires. */
  when: string;
  /** What the caller should do next. */
  fix: string;
}

export const ERROR_CATALOG: ErrorEntry[] = [
  {
    slug: "unauthorized",
    status: 401,
    title: "Authentication required",
    when:
      "No credential was sent, or the one sent is not valid. An API key that "
      + "has been revoked returns this, as does an expired browser session.",
    fix:
      "Send an API key as `Authorization: Bearer ams_live_…`. If the key was "
      + "revoked, mint a new one under Settings — a revoked key never comes "
      + "back.",
  },
  {
    slug: "forbidden",
    status: 403,
    title: "Forbidden",
    when:
      "The credential is valid but lacks the permission for this operation, or "
      + "the resource sits outside the branches it is limited to. Writing from "
      + "a browser with a mismatched Origin also lands here.",
    fix:
      "Check the role's permissions, and whether the account is scoped to "
      + "particular branches. The `detail` field says which of the two it was.",
  },
  {
    slug: "not-found",
    status: 404,
    title: "Not found",
    when:
      "No such resource in this organisation. Note that an id belonging to "
      + "another tenant is indistinguishable from one that never existed — "
      + "deliberately, since confirming existence would leak it.",
    fix:
      "Check the id. If it came from a different environment or organisation, "
      + "it will not resolve here.",
  },
  {
    slug: "validation",
    status: 422,
    title: "Validation failed",
    when:
      "The request body or query did not satisfy the schema. This is the only "
      + "error that carries an `errors` array.",
    fix:
      "Read `errors`: each entry names the `field` and what was wrong with it. "
      + "The field path is dotted, so `custom.ram_gb` means the `ram_gb` key "
      + "inside `custom`.",
  },
  {
    slug: "conflict",
    status: 409,
    title: "Conflict",
    when:
      "The request collides with the current state: a duplicate asset tag or "
      + "serial number, a role name already in use, a stock-take already "
      + "closed, or a role still held by somebody.",
    fix:
      "Read `detail` — it says which collision occurred. This is not worth "
      + "retrying unchanged; the same request will collide again.",
  },
  {
    slug: "invalid-transition",
    status: 409,
    title: "Invalid status transition",
    when:
      "The asset cannot move from its current status to the requested one — "
      + "issuing an asset that is already out, or returning one that was never "
      + "issued.",
    fix:
      "Read the asset first and branch on its `status`. A retry will not help "
      + "until the asset actually changes state.",
  },
  {
    slug: "organization-suspended",
    status: 403,
    title: "Organisation suspended",
    when:
      "The organisation's access has been suspended by whoever manages its "
      + "subscription. Sign-in is refused, and so is every existing session "
      + "and API key - a suspension that only stopped new sign-ins would not "
      + "be one.",
    fix:
      "Nothing in the API will lift this. Contact whoever manages the "
      + "subscription; the organisation's data is intact and returns "
      + "untouched when access is restored.",
  },
  {
    slug: "invitation-invalid",
    status: 410,
    title: "Invitation is no longer valid",
    when:
      "The invitation link has been used already, withdrawn, or has passed its "
      + "72 hours. All three answer the same way on purpose: this endpoint is "
      + "public, and three different answers would let somebody probe which "
      + "invitations exist.",
    fix:
      "Ask whoever invited you to send another. The old link cannot be "
      + "revived - a new invitation carries a new token.",
  },
  {
    slug: "payload-too-large",
    status: 413,
    title: "File too large",
    when: "An uploaded import or attachment exceeded 10 MB.",
    fix:
      "Split the spreadsheet and import in batches. Imports are additive, so "
      + "several passes produce the same register as one large file.",
  },
  {
    slug: "plan-limit",
    status: 402,
    title: "Plan limit reached",
    when:
      "The write would take the organisation past a limit its plan sets - the "
      + "number of assets, or the number of people. Reading and exporting are "
      + "never refused for this reason, however far over the limit they are.",
    fix:
      "The detail names the limit and the current count. Remove some, or ask "
      + "whoever manages the subscription to change plan. Retrying unchanged "
      + "will fail again.",
  },
  {
    slug: "feature-not-enabled",
    status: 403,
    title: "Not included in this plan",
    when:
      "The endpoint belongs to a feature this organisation's plan does not "
      + "include - stock-takes, webhooks, scheduled reports and the like.",
    fix:
      "Nothing in the API will change this. Whoever manages the subscription "
      + "can add the feature; until then the endpoint stays refused.",
  },
  {
    slug: "rate-limited",
    status: 429,
    title: "Rate limit exceeded",
    when:
      "Too many requests for one API key within the hour. The limit is per "
      + "key, so a noisy integration cannot exhaust another one's budget.",
    fix:
      "Wait for the number of seconds in `Retry-After`, then continue. If a "
      + "job legitimately needs more throughput, give it its own key.",
  },
  {
    slug: "internal",
    status: 500,
    title: "Internal server error",
    when:
      "Something failed that should not have. The response deliberately says "
      + "nothing further: a database error's detail can quote the offending "
      + "row, which would be another tenant's data.",
    fix:
      "Retry once — some causes are transient. If it persists, quote the "
      + "`X-Request-Id` from the response headers to support; it identifies "
      + "the exact request in the server logs.",
  },
];

/** The absolute `type` a problem document carries, for this slug. */
export const errorTypeUri = (slug: string): string => `${ERROR_BASE}${slug}`;
