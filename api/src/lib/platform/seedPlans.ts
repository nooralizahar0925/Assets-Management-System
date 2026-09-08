/**
 * The plans a deployment starts with.
 *
 * Seeded with ON CONFLICT DO NOTHING, so a deploy never overwrites what the
 * operator has since edited: these are a starting point to rename and reprice,
 * not a definition the code owns. Only a brand-new deployment sees them
 * exactly as written here.
 *
 * Prices are minor units. The numbers are placeholders and are meant to be
 * changed before anybody is charged them.
 */

interface SeedPlan {
  code: string;
  name: string;
  description: string;
  price_minor: number;
  features: string[];
  limits: Record<string, number>;
  sort_order: number;
}

export const STARTING_PLANS: SeedPlan[] = [
  {
    code: "starter",
    name: "Starter",
    description:
      "For a single site getting its register in order: the assets, labels "
      + "and the reports to show for them.",
    price_minor: 250_000,
    features: ["core", "import", "labels", "reports"],
    limits: { max_assets: 500, max_users: 10 },
    sort_order: 1,
  },
  {
    code: "professional",
    name: "Professional",
    description:
      "For an organisation running its assets rather than only listing them: "
      + "counting, servicing, depreciation and an API.",
    price_minor: 950_000,
    features: [
      "core", "import", "labels", "reports", "stocktake", "maintenance",
      "depreciation", "reports_scheduled", "api",
    ],
    limits: { max_assets: 5_000, max_users: 50 },
    sort_order: 2,
  },
  {
    code: "enterprise",
    name: "Enterprise",
    description:
      "Everything, with no caps. For customers whose register is large enough "
      + "that a limit would be the thing they notice first.",
    price_minor: 2_500_000,
    features: [
      "core", "import", "labels", "reports", "stocktake", "maintenance",
      "depreciation", "reports_scheduled", "api", "webhooks",
    ],
    limits: {},
    sort_order: 3,
  },
];

/**
 * Idempotent, and deliberately never an update.
 *
 * A deploy that reset a customer's prices to whatever was last committed would
 * be a billing incident caused by a code change.
 */
export async function seedPlansWithClient(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
): Promise<void> {
  for (const plan of STARTING_PLANS) {
    await client.query(
      `INSERT INTO plans (code, name, description, price_minor, features,
                          limits, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO NOTHING`,
      [
        plan.code, plan.name, plan.description, plan.price_minor,
        plan.features, JSON.stringify(plan.limits), plan.sort_order,
      ],
    );
  }
}
