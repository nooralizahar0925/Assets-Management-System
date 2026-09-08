/**
 * What can be sold separately.
 *
 * Deliberately coarse. A feature here is something a customer would recognise
 * on a price list and could sensibly not have - not every screen and not every
 * endpoint. Splitting "assets" into creating and editing would be permissions,
 * which already exist and are the customer's business to arrange, not ours.
 *
 * Code-defined, like PERMISSIONS and for the same reason: a feature means
 * something only because a handler checks it, so one invented in the database
 * would grant nothing. Plans reference these keys; a plan naming a key that is
 * not here is caught by the test beside this file.
 */

export interface Feature {
  key: string;
  group: string;
  label: string;
  description: string;
}

export const FEATURES = [
  {
    key: "core", group: "Core", label: "Asset register",
    description:
      "The register itself: assets, categories, locations, custody and the "
      + "full history of every change. Every plan includes this.",
  },
  {
    key: "import", group: "Core", label: "Spreadsheet import",
    description:
      "Bring an existing register in from CSV or Excel, with a dry run that "
      + "reports what would happen before anything is written.",
  },
  {
    key: "labels", group: "Operations", label: "Labels and scanning",
    description:
      "Printable QR and Code 128 label sheets, and scanning with a phone "
      + "camera or a handheld scanner.",
  },
  {
    key: "stocktake", group: "Operations", label: "Stock-takes",
    description:
      "Physical counting sessions that report what is missing and what turned "
      + "up somewhere it should not be.",
  },
  {
    key: "maintenance", group: "Operations", label: "Maintenance schedules",
    description:
      "Repeating service schedules with due dates, completion records and "
      + "reminders before the date rather than after it.",
  },
  {
    key: "depreciation", group: "Finance", label: "Depreciation",
    description:
      "Straight-line and reducing-balance policies, and the month-end book "
      + "values the register's worth is reported from.",
  },
  {
    key: "reports", group: "Finance", label: "Reports",
    description:
      "The report catalogue, each report downloadable as JSON, CSV, Excel, "
      + "PDF or an image.",
  },
  {
    key: "reports_scheduled", group: "Finance", label: "Scheduled reports",
    description:
      "Saved reports run on a timetable and emailed to a list of people, so "
      + "nobody has to remember to run them.",
  },
  {
    key: "api", group: "Integration", label: "API access",
    description:
      "API keys and the published v1 API, for another system to read or "
      + "update the register directly.",
  },
  {
    key: "webhooks", group: "Integration", label: "Webhooks",
    description:
      "Signed event delivery to a customer's own endpoint, so their systems "
      + "are told when something happens rather than polling for it.",
  },
] as const satisfies readonly Feature[];

export type FeatureKey = (typeof FEATURES)[number]["key"];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

/**
 * Granted to everybody, plan or no plan.
 *
 * Without the register there is no product, so this survives any override: an
 * account that can sign in and do nothing at all is a support call, not a
 * plan. An organisation with no plan yet - one being set up, or one whose
 * trial is being arranged - still gets it.
 */
export const ALWAYS_ON: readonly FeatureKey[] = ["core"];

export const isFeatureKey = (value: string): value is FeatureKey =>
  (FEATURE_KEYS as readonly string[]).includes(value);
