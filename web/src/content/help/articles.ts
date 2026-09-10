import type { Block } from "./blocks";

/**
 * The help centre, and — through `npm run docs:guide` — the printed manual.
 *
 * One array, three renderings: the article page, the guide, and the ? panel's
 * onward links. Written for somebody who has never kept an asset register
 * before, because most of the people reading this have not.
 */

export interface Article {
  slug: string;
  title: string;
  section: string;
  summary: string;
  keywords: string[];
  blocks: Block[];
}

export const SECTIONS = [
  "Getting started",
  "Managing assets",
  "Check-in and check-out",
  "Scanning and labels",
  "Importing and exporting",
  "Categories and custom fields",
  "Stock-takes",
  "Maintenance",
  "Depreciation and value",
  "Reports",
  "Users and access",
  "Integrations",
  "Notifications",
];

export const ARTICLES: Article[] = [
  {
    slug: "getting-started",
    title: "Setting up your register",
    section: "Getting started",
    summary: "The four steps from an empty account to a register you can trust.",
    keywords: ["setup", "onboarding", "first", "start", "begin", "new"],
    blocks: [
      { kind: "p", text: "An asset register is only useful if it matches reality. These four steps get you there in about an hour for a few hundred assets." },
      { kind: "steps", items: [
        "Create your categories first. They decide which extra fields each kind of asset carries, and which depreciation policy it inherits.",
        "Add your locations as a tree - sites, then buildings, then rooms - so you can filter by site later and limit people to their own.",
        "Import the spreadsheet you keep today. Use the dry run to check the column mapping before anything is written.",
        "Check a few assets out to real people. The register becomes trustworthy the moment it reflects who actually holds what.",
      ] },
      { kind: "note", text: "Do not try to make the import perfect. Get the assets in, then correct them in place - every correction is recorded in the asset's history, so nothing is lost by fixing things later." },
    ],
  },

  {
    slug: "managing-assets",
    title: "Adding and editing assets",
    section: "Managing assets",
    summary: "Creating assets, what each status means, and why nothing is ever really deleted.",
    keywords: ["asset", "create", "edit", "status", "delete", "retire", "serial", "tag"],
    blocks: [
      { kind: "p", text: "Only a name is required to create an asset. Leave the asset tag blank and the next tag in your organisation's sequence is allocated for you." },
      { kind: "term", term: "Asset tag", definition: "your own identifier for the asset, unique within your organisation. It is what goes on the printed label." },
      { kind: "term", term: "Serial number", definition: "the manufacturer's identifier. Optional, but it is what you will search by when somebody reads a number off a sticker over the phone." },
      { kind: "p", text: "Statuses describe where an asset is in its life:" },
      { kind: "list", items: [
        "Available - in your possession and free to issue.",
        "In use - checked out to somebody or somewhere.",
        "Maintenance - being serviced or repaired, and not available to issue.",
        "Retired - has left service but is kept for the record and for audit.",
        "Lost - unaccounted for. Keep it rather than deleting it: a lost asset that turns up has a history worth having.",
      ] },
      { kind: "note", text: "Deleting an asset hides it from the register but never removes it from the database, because asset records are evidence in an audit. Retire it instead when it has simply reached the end of its life." },
    ],
  },

  {
    slug: "check-in-out",
    title: "Checking assets in and out",
    section: "Check-in and check-out",
    summary: "Passing custody to a person, a place or an outside party, and getting it back.",
    keywords: ["check out", "check in", "checkout", "checkin", "custody", "borrow", "due", "overdue", "return"],
    blocks: [
      { kind: "p", text: "Checking out records who holds an asset. It can go to a person, to a location for shared equipment, or to a named outside party such as a contractor." },
      { kind: "steps", items: [
        "Open the asset, or scan its label.",
        "Choose Check out, then pick the person, location or outside party.",
        "Set a due date if it is coming back. Overdue assets are surfaced on the dashboard and can send a reminder email.",
        "Add a note if the context matters - which job it went out on, what condition it was in.",
      ] },
      { kind: "p", text: "Checking in closes the assignment and returns the asset to available. Record the condition on return: that record is what settles a disagreement months later." },
      { kind: "note", text: "An asset can only be held by one person at a time. A second check-out is refused rather than quietly overwriting the first, so the register never claims two people have the same machine." },
    ],
  },

  {
    slug: "scanning",
    title: "Scanning labels and printing them",
    section: "Scanning and labels",
    summary: "QR codes for phones, Code 128 for warehouse scanners, and how to print sheets.",
    keywords: ["scan", "barcode", "qr", "code128", "label", "print", "camera", "scanner", "sticker"],
    blocks: [
      { kind: "p", text: "Every asset carries a tag that prints as two kinds of barcode, because the two situations need different things." },
      { kind: "term", term: "QR code", definition: "holds a link to the asset. Anybody can scan it with a plain phone camera and land on the asset page - there is no app to install. If they are not signed in they are asked to, then taken straight there." },
      { kind: "term", term: "Code 128", definition: "holds just the tag. A USB or Bluetooth scanner types it into whatever field is focused, exactly as a person would, which is what makes a warehouse scanner work with no setup at all." },
      { kind: "p", text: "To scan inside the application, use Scan in the header. The camera option works on a phone or a laptop; the scanner option simply waits for a handheld scanner to type." },
      { kind: "steps", items: [
        "Select the assets you want labels for on the register.",
        "Choose Print labels, then pick the label sheet size you buy.",
        "Print onto plain paper first and hold it against a sheet to check the alignment.",
      ] },
      { kind: "note", text: "Print a spare label for each asset and keep it with the paperwork. A label that falls off in a workshop is the most common reason an asset drifts out of a register." },
    ],
  },

  {
    slug: "importing",
    title: "Importing and exporting",
    section: "Importing and exporting",
    summary: "Bringing a spreadsheet in safely with a dry run, and getting your data back out.",
    keywords: ["import", "export", "csv", "excel", "xlsx", "spreadsheet", "bulk", "upload", "dry run"],
    blocks: [
      { kind: "p", text: "Import accepts CSV and Excel files. The process is deliberately three steps, so that a mis-mapped column cannot silently rewrite your register." },
      { kind: "steps", items: [
        "Upload the file. The first row is treated as the header.",
        "Map each column onto an asset field. Columns you do not map are ignored, and a category's custom fields appear once you choose that category.",
        "Read the dry-run preview: how many assets would be created, how many updated, and every row that would be rejected, with the reason.",
        "Commit the import only once the preview looks right.",
      ] },
      { kind: "term", term: "Dry run", definition: "a complete validation pass that writes nothing at all. Running one costs nothing, and it is the only chance to catch a mistake before it lands." },
      { kind: "p", text: "Rows match existing assets by asset tag, or by serial number where there is no tag. Re-importing a corrected sheet therefore updates those assets rather than creating duplicates." },
      { kind: "note", text: "Export the register before a large import. It is the fastest way back if the mapping turns out to have been wrong." },
    ],
  },

  {
    slug: "categories-and-fields",
    title: "Categories and custom fields",
    section: "Categories and custom fields",
    summary: "Why a laptop and a generator need different fields, and how to set that up.",
    keywords: ["category", "custom field", "field schema", "schema", "type", "required", "select"],
    blocks: [
      { kind: "p", text: "Different kinds of asset need different information. A laptop needs a warranty expiry; a generator needs running hours and a next service date; a licence needs an expiry and a rights holder. Categories are how you say that." },
      { kind: "term", term: "Field schema", definition: "the list of extra fields every asset in a category carries. Each field has a key the API uses, a label people see, a type, and an optional required flag." },
      { kind: "p", text: "Fields can be text, a number, a date, a fixed list of choices, or a yes/no. Choose the narrowest type that fits: a date field sorts and filters properly, where the same date typed into a text field does not." },
      { kind: "steps", items: [
        "Open Categories and create or edit one.",
        "Add a field, giving it a label, a type, and whether it is required.",
        "Save. The field appears immediately on the form for every asset in that category.",
      ] },
      { kind: "note", text: "A field's type cannot be changed once assets hold values for it, because those values would become invalid. Add a new field and move the values across instead." },
    ],
  },

  {
    slug: "stock-takes",
    title: "Counting what you actually have",
    section: "Stock-takes",
    summary: "Walking the site with a scanner, and what to do with what the count finds.",
    keywords: ["stocktake", "stock take", "stock-take", "count", "audit", "inventory", "missing", "physical"],
    blocks: [
      { kind: "p", text: "A stock-take is a physical count. You walk the site scanning what is actually there, and the system tells you what it expected to find, what is missing, and what turned up somewhere it should not be." },
      { kind: "steps", items: [
        "Start a session, optionally limited to one location so two people can count different buildings at once.",
        "Scan or type each asset tag as you find it. The list updates as you go.",
        "Work through anything still expected but not counted before you finish - that is the part worth doing carefully.",
        "Close the session. The counts become the record of what was found that day.",
      ] },
      { kind: "term", term: "Unexpected", definition: "an asset found here that the register says is somewhere else. This is not an error - it is exactly the finding a stock-take exists to produce." },
      { kind: "note", text: "Closing a session is final. Investigate the missing assets first: an asset marked lost that was really in the next room is a correction somebody has to unpick later." },
    ],
  },

  {
    slug: "maintenance",
    title: "Keeping things serviced",
    section: "Maintenance",
    summary: "Repeating service schedules, what completing one does, and who gets told.",
    keywords: ["maintenance", "service", "repair", "schedule", "inspection", "calibration", "due"],
    blocks: [
      { kind: "p", text: "Some assets need work on a timetable: an inspection, a calibration, a filter change. A maintenance schedule records what has to happen, how often, and when it is next due." },
      { kind: "steps", items: [
        "Open the asset and add a schedule, with what the work is and how many months apart it falls.",
        "When the work is done, complete the schedule and record what was done.",
        "The next due date moves forward automatically from the completion.",
      ] },
      { kind: "p", text: "Assets with work coming up appear on the dashboard, and a notification rule can email the people responsible before the date rather than after it." },
      { kind: "note", text: "Complete the schedule rather than editing its due date. Editing the date moves the reminder but leaves no record that the work was ever done." },
    ],
  },

  {
    slug: "depreciation",
    title: "What the register is worth",
    section: "Depreciation and value",
    summary: "How assets lose value over time, and where the numbers on the dashboard come from.",
    keywords: ["depreciation", "value", "book value", "straight line", "reducing balance", "salvage", "finance"],
    blocks: [
      { kind: "p", text: "An asset is worth less each year than it cost. Depreciation is how that is written down, and it is what turns a list of purchases into a number your finance team can use." },
      { kind: "term", term: "Straight line", definition: "the same amount written off every month across the asset's useful life. Simple, predictable, and what most organisations use." },
      { kind: "term", term: "Reducing balance", definition: "a fixed percentage of what is left each month, so the asset loses value quickly at first and slowly later. Closer to how vehicles and machinery actually behave." },
      { kind: "term", term: "Salvage value", definition: "what the asset will still be worth at the end of its life. Depreciation stops there rather than running to zero." },
      { kind: "p", text: "Set the policy on a category and every asset in it inherits it. Set it on one asset only when that asset is genuinely an exception, and clear the override to put it back on its category's policy." },
      { kind: "note", text: "Book value on the dashboard comes from month-end snapshots, not from a live calculation. That is deliberate: a figure that changes while you are reading it cannot be reconciled with a report you ran yesterday." },
    ],
  },

  {
    slug: "reports",
    title: "Running and scheduling reports",
    section: "Reports",
    summary: "The report catalogue, the output formats, and emailing a report on a timetable.",
    keywords: ["report", "export", "pdf", "excel", "csv", "chart", "schedule", "email"],
    blocks: [
      { kind: "p", text: "Reports answer the questions people actually ask: what do we own, what is it worth, what is overdue, what is due for service, and what happened to a particular asset." },
      { kind: "p", text: "Every report downloads as JSON for another system, CSV for a spreadsheet, Excel with formatting, PDF for circulation, or an image for a slide." },
      { kind: "note", text: "All the formats come from one query, so the PDF you email and the spreadsheet your finance team analyses cannot disagree with each other." },
      { kind: "steps", items: [
        "Open Reports and choose one from the gallery.",
        "Set its filters - the date range, a category, a location.",
        "Download it, or save it and put it on a schedule to be emailed regularly.",
      ] },
      { kind: "term", term: "Scheduled report", definition: "a saved report with its filters, run automatically on a timetable and emailed to a list of people. This is usually what somebody means when they ask for a monthly report." },
    ],
  },

  {
    slug: "roles-and-access",
    title: "Who can do what",
    section: "Users and access",
    summary: "Building roles out of permissions, and limiting people to their own branches.",
    keywords: ["user", "role", "permission", "access", "invite", "invitation", "team", "branch", "scope", "admin", "join", "colleague"],
    blocks: [
      { kind: "p", text: "A role is a named set of permissions that you build yourself. There is no fixed list to fit your organisation into: create the roles you actually use, and call them what your colleagues already call them." },
      { kind: "term", term: "Invitation", definition: "how somebody joins. You send one from People with their name, address and role; they follow a link that lasts 72 hours and choose their own password. Nobody else ever knows it, and an invitation sent to the wrong address can be withdrawn before it is used." },
      { kind: "term", term: "Permission", definition: "one specific thing a person may do - read assets, edit them, issue them, run a stock-take, manage users. The API enforces exactly these, so what the screen offers and what the system allows can never drift apart." },
      { kind: "p", text: "A role can also be limited to particular branches. Somebody scoped to one site sees only that site's assets - in the register, in search, in reports and on the dashboard - and cannot move an asset out of it." },
      { kind: "steps", items: [
        "Open Settings, then Roles, and create a role with the permissions that job needs.",
        "Open People and invite your colleague with that role, choosing their branches if they should only see part of the organisation.",
        "Grant the least that lets them do their work. It is easy to add a permission later and awkward to explain why somebody deleted something.",
      ] },
      { kind: "note", text: "A role still held by somebody cannot be deleted - move those people to another role first. Changing somebody's role never removes what they have already done: the history keeps their name against it." },
    ],
  },

  {
    slug: "integrations",
    title: "Connecting another system",
    section: "Integrations",
    summary: "API keys, their scopes, and having events pushed to you instead of polling.",
    keywords: ["api", "key", "integration", "token", "scope", "webhook", "developer", "rotate", "revoke"],
    blocks: [
      { kind: "p", text: "Other systems talk to your register through the API using a key. Give each system its own key, so that one can be revoked without disturbing the others." },
      { kind: "steps", items: [
        "Open Settings, then API keys, and create one.",
        "Name it after the system that will use it, so that a key you find in a year is identifiable.",
        "Grant the narrowest scopes that work - a reporting script needs to read assets and nothing more.",
        "Copy the key immediately. It is shown once and cannot be recovered.",
      ] },
      { kind: "p", text: "A webhook is the other direction: instead of another system asking us repeatedly whether anything has changed, we send it a signed message the moment something does. Subscribe an endpoint under Settings, then Webhooks." },
      { kind: "note", text: "To rotate a key: create the replacement, move the integration onto it, confirm it works, and only then revoke the old one. Revocation takes effect on the very next request." },
      { kind: "p", text: "The full API documentation, with copy-paste examples in four languages, is at /developers." },
    ],
  },

  {
    slug: "notifications",
    title: "Email and notifications",
    section: "Notifications",
    summary: "Setting up sending, choosing which events email whom, and turning them off.",
    keywords: ["email", "notification", "smtp", "provider", "rule", "recipient", "reminder", "overdue"],
    blocks: [
      { kind: "p", text: "Nothing is emailed until an email provider is configured. Once it is, notification rules decide which events send mail and who receives it." },
      { kind: "steps", items: [
        "Open Settings, then Email, and enter your provider's details.",
        "Send a test message. A provider that accepts the settings but then rejects the mail is the usual failure, and only a test finds it.",
        "Open Notifications and check the rules: each names an event, a template and who is told.",
      ] },
      { kind: "term", term: "Recipient rule", definition: "who gets told - the person who did it, the person holding the asset, everybody with a given permission, or named addresses." },
      { kind: "p", text: "Anybody can turn off individual notifications for themselves, so a rule is an offer rather than an obligation." },
      { kind: "note", text: "Turning a rule off stops the email but never stops the event being recorded. The asset's history stays complete whatever anybody chooses to be told about." },
    ],
  },
];

/**
 * Free-text search across the things a reader might type.
 *
 * Keywords carry the words people actually use that the titles do not contain -
 * "barcode" for the scanning article, "stocktake" without the hyphen - because
 * a search that fails on the reader's own vocabulary teaches them the help
 * centre is not worth using.
 */
export function searchArticles(query: string): Article[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return ARTICLES;

  return ARTICLES.filter((article) =>
    [article.title, article.summary, article.section, ...article.keywords]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}
