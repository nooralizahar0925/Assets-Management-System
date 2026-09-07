import type { HttpRequest } from "./renderers";

/**
 * The flows most integrations need, each described once.
 *
 * Every path, field name and type here was read out of the handlers rather
 * than out of the plan: a recipe that does not run is worse than no recipe,
 * because the reader trusts it and blames their own code.
 */

export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  request: HttpRequest;
  note?: string;
}

export const RECIPES: Recipe[] = [
  {
    id: "list-assets",
    title: "List assets",
    blurb:
      "Read a page of the register, newest first, filtered to the assets "
      + "currently in use.",
    request: {
      method: "GET",
      path: "/api/v1/assets",
      query: { status: "in_use", sort: "-created_at", per_page: "100" },
    },
    note:
      "Page with page and per_page until meta.page reaches meta.total_pages. "
      + "per_page is capped at 200.",
  },
  {
    id: "create-asset",
    title: "Create an asset",
    blurb:
      "Register a new asset. Omit asset_tag and the server allocates the next "
      + "one for your organisation.",
    request: {
      method: "POST",
      path: "/api/v1/assets",
      body: {
        name: "ThinkPad X1 Carbon",
        category_id: "<category-uuid>",
        serial_no: "PF3ABCDE",
        status: "available",
        location_id: "<location-uuid>",
        purchase_date: "2026-02-14",
        purchase_cost: 24500000,
        currency: "IDR",
      },
    },
    note:
      "purchase_cost is sent as a number and comes back as a decimal string. "
      + "Send an Idempotency-Key header so a retry cannot create a second asset.",
  },
  {
    id: "update-custom-fields",
    title: "Update custom fields",
    blurb:
      "Patch the per-category custom fields. Values are validated against the "
      + "category's field schema, so an unknown key or a wrong type is rejected.",
    request: {
      method: "PATCH",
      path: "/api/v1/assets/<asset-uuid>",
      body: { custom: { warranty_end: "2028-04-01", ram_gb: 32 } },
    },
    note:
      "custom is merged, not replaced: keys you omit keep their current "
      + "values. Setting one to null stores null rather than removing it.",
  },
  {
    id: "check-out",
    title: "Check an asset out",
    blurb:
      "Assign custody to a user, a location or a named external party, "
      + "optionally with a due date.",
    request: {
      method: "POST",
      path: "/api/v1/assets/<asset-uuid>/checkout",
      body: {
        assignee_type: "user",
        assignee_id: "<user-uuid>",
        due_at: "2026-10-01T09:00:00Z",
        note: "Onsite installation",
      },
    },
    note:
      "An asset that is already out returns 409 invalid-transition; check it "
      + "in first. Only available and maintenance assets can be issued.",
  },
  {
    id: "check-in",
    title: "Check an asset back in",
    blurb:
      "Close the open assignment and return the asset to available, recording "
      + "its condition.",
    request: {
      method: "POST",
      path: "/api/v1/assets/<asset-uuid>/checkin",
      body: { condition: "good", note: "Returned with charger" },
    },
  },
  {
    id: "read-history",
    title: "Read an asset's history",
    blurb:
      "The audit trail and every custody record for one asset: who changed "
      + "what, who held it and when.",
    request: { method: "GET", path: "/api/v1/assets/<asset-uuid>/history" },
    note:
      "Returns data.events and data.assignments together, newest first. It is "
      + "not paginated - the response is one asset's whole life.",
  },
  {
    id: "bulk-import",
    title: "Import a spreadsheet",
    blurb:
      "Upload a CSV or XLSX with a column mapping. The default is a dry run: "
      + "it reports what would be created, updated and rejected without "
      + "writing anything.",
    request: {
      method: "POST",
      path: "/api/v1/imports",
      upload: {
        field: "file",
        filename: "assets.csv",
        fields: {
          mapping: '{"Asset Name":"name","Serial Number":"serial_no"}',
          dry_run: "true",
        },
      },
    },
    note:
      "mapping is a JSON object of source header to target field. Re-post the "
      + "same file and mapping with dry_run=false to commit; that run fires "
      + "import.completed.",
  },
  {
    id: "resolve-tag",
    title: "Resolve a scanned tag",
    blurb:
      "Turn a barcode payload into the asset it identifies. This is the "
      + "endpoint behind the application's own scan dialog.",
    request: {
      method: "GET",
      path: "/api/v1/assets/lookup",
      query: { tag: "AMS-000123" },
    },
    note:
      "QR labels encode a deep link ending in the same tag, so stripping the "
      + "URL prefix gives the value this endpoint takes.",
  },
];
