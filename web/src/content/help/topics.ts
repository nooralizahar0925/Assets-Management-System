import type { Block } from "./blocks";

/**
 * One help topic per page, keyed by its route.
 *
 * Written for somebody who has never seen an asset register before, which is
 * most of the people who will use this. The rule for every topic: say what the
 * page is for, define the words on it that cannot be guessed, and name the one
 * mistake that is expensive to undo.
 */

export interface HelpTopic {
  title: string;
  blocks: Block[];
  /** Slug of the fuller help-centre article, linked from the panel. */
  article?: string;
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  "/": {
    title: "Your dashboard",
    article: "getting-started",
    blocks: [
      { kind: "p", text: "A live summary of the register: how much you hold, what state it is in, and what needs attention today." },
      { kind: "term", term: "Utilisation", definition: "the share of assets currently checked out. Persistently low utilisation usually means you own more than you need." },
      { kind: "term", term: "Book value", definition: "what the register is worth after depreciation, taken from the month-end snapshots rather than recalculated on the fly." },
      { kind: "note", text: "Every tile is a filter. Click one to open the register already narrowed to those assets." },
    ],
  },

  "/assets": {
    title: "The asset register",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Every asset you own, in one searchable table. Search matches names, asset tags and serial numbers, so a partial serial read off a sticker is enough to find a machine." },
      { kind: "p", text: "Filters combine: pick a category, a status and a location together to narrow to exactly the set you mean." },
      { kind: "term", term: "Status", definition: "available means nobody holds it; in use means it is checked out; maintenance means it is being serviced; retired means it has left service but is kept for the record; lost means it is unaccounted for." },
      { kind: "note", text: "Select rows with the checkboxes to change status, move location or print labels for many assets at once." },
    ],
  },

  "/assets/new": {
    title: "Adding an asset",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Only a name is required. Leave the asset tag blank and the next one in your organisation's sequence is allocated for you." },
      { kind: "p", text: "Choosing a category changes the form: the extra fields below the standard ones come from that category's field schema." },
      { kind: "term", term: "Depreciation", definition: "how the asset loses value over its life. Leave it alone and the asset follows its category's policy; set it here only when this one asset is an exception." },
      { kind: "note", text: "Adding many assets at once is far faster through Import than through this form." },
    ],
  },

  "/assets/:id": {
    title: "Asset detail",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Everything known about one asset, including everyone who has held it and every change ever made to it." },
      { kind: "term", term: "History", definition: "an append-only audit trail. Entries are never edited or deleted, which is what lets the register stand up in an audit." },
      { kind: "p", text: "Check out passes custody to a person, a location or a named outside party. Check in closes that assignment and returns the asset to available." },
      { kind: "note", text: "An asset that is already checked out cannot be checked out again. Check it in first, so the record shows it actually came back." },
    ],
  },

  "/assets/:id/edit": {
    title: "Editing an asset",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Changes here are recorded in the asset's history with your name against them, so the register always says who changed what." },
      { kind: "p", text: "Moving an asset to a different category changes which extra fields it carries. Values for fields the new category does not have are kept but no longer shown." },
      { kind: "note", text: "Use check in and check out to record custody rather than editing the status by hand: editing the status leaves no assignment record behind." },
    ],
  },

  "/import": {
    title: "Importing a spreadsheet",
    article: "importing",
    blocks: [
      { kind: "p", text: "Bring an existing register in from CSV or Excel in three steps: upload the file, map its columns onto asset fields, then read the preview before anything is written." },
      { kind: "term", term: "Dry run", definition: "a full validation pass that writes nothing. It reports exactly what would be created, what would be updated, and which rows would be rejected and why." },
      { kind: "p", text: "Rows are matched to existing assets by asset tag or serial number, so re-importing a corrected sheet updates those assets rather than duplicating them." },
      { kind: "note", text: "Always read the dry-run preview. It is the only chance to catch a mis-mapped column before it rewrites your register." },
    ],
  },

  "/maintenance": {
    title: "Maintenance",
    article: "maintenance",
    blocks: [
      { kind: "p", text: "Servicing that has to happen on a timetable: inspections, calibrations, filter changes, anything with a due date." },
      { kind: "term", term: "Schedule", definition: "a repeating job on one asset, with an interval in months. Completing it records the service and moves the next due date forward." },
      { kind: "p", text: "Assets with a service coming up appear on the dashboard, and the people who need to know are emailed if a notification rule says so." },
      { kind: "note", text: "Completing a service is what advances the schedule. Editing the due date by hand loses the record that the work was done." },
    ],
  },

  "/whats-new": {
    title: "What's new",
    article: "getting-started",
    blocks: [
      { kind: "p", text: "Everything that has changed in the system, newest first, written in terms of what it means for you rather than what was changed in the code." },
      { kind: "note", text: "The dot on the sidebar means there is something here you have not read yet. Opening this page clears it." },
    ],
  },

  "/stocktakes": {
    title: "Stock-takes",
    article: "stock-takes",
    blocks: [
      { kind: "p", text: "A stock-take is a physical count: you walk the site scanning what is actually there, and the system tells you what is missing and what turned up unexpectedly." },
      { kind: "term", term: "Session", definition: "one counting exercise, optionally limited to a location. It stays open while you count, and freezes when you close it." },
      { kind: "note", text: "Closing a session is final. The counts become the record of what was found that day, so close it only when the counting is finished." },
    ],
  },

  "/stocktakes/:id": {
    title: "Counting",
    article: "stock-takes",
    blocks: [
      { kind: "p", text: "Scan or type each asset tag as you find it. The list updates as you go, so several people can count different rooms at the same time." },
      { kind: "term", term: "Unexpected", definition: "an asset found here that the register says is somewhere else. It is not an error - it is the finding the stock-take exists to produce." },
      { kind: "p", text: "Anything never scanned stays as missing when you close the session. Investigate those before closing rather than after." },
    ],
  },

  "/reports": {
    title: "Reports",
    article: "reports",
    blocks: [
      { kind: "p", text: "Prebuilt views over the register, each downloadable as JSON, CSV, Excel, PDF or an image." },
      { kind: "p", text: "Every format comes from the same query, so the PDF you email and the spreadsheet you analyse can never disagree with each other." },
      { kind: "term", term: "Scheduled report", definition: "a saved report the system runs on a timetable and emails to a list of people, so nobody has to remember to run it." },
    ],
  },

  "/reports/:key": {
    title: "Running a report",
    article: "reports",
    blocks: [
      { kind: "p", text: "Set the filters, read the result, then download it in whichever format the person asking for it needs." },
      { kind: "p", text: "Saving a report keeps its filters under a name, so next month is one click rather than a rebuild from memory." },
      { kind: "note", text: "A saved report can be put on a schedule and emailed automatically. That is usually what somebody means when they ask for a monthly report." },
    ],
  },

  "/categories": {
    title: "Categories and custom fields",
    article: "categories-and-fields",
    blocks: [
      { kind: "p", text: "Categories group assets that share the same extra information. A laptop needs a warranty date; a generator needs running hours; a licence needs an expiry." },
      { kind: "term", term: "Field schema", definition: "the list of extra fields that assets in this category carry. Each field has a key, a label, a type - text, number, date, select or boolean - and can be marked required." },
      { kind: "p", text: "Adding a field makes it appear on the form for every asset in that category. Existing assets simply have no value for it until somebody sets one." },
      { kind: "note", text: "A category also carries the default depreciation policy for its assets, so you set it once here rather than on every machine." },
    ],
  },

  "/locations": {
    title: "Locations",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Where assets live, as a tree: a site contains buildings, and a building contains rooms." },
      { kind: "p", text: "An asset has a home location, and can separately be checked out to a location - a tool assigned to a workshop rather than to a person." },
      { kind: "note", text: "Locations are also how access is limited: a role can be scoped to particular branches, and people with that role see only what is there." },
    ],
  },

  "/settings/users": {
    title: "People",
    article: "roles-and-access",
    blocks: [
      { kind: "p", text: "Everybody who can sign in to your organisation, and the role each of them holds." },
      { kind: "p", text: "A role can be limited to particular branches. Somebody scoped to one site sees only that site's assets, in the register, in reports and in search." },
      { kind: "note", text: "Changing somebody's role takes effect the next time they load a page. It never removes what they have already done - the history keeps their name." },
    ],
  },

  "/settings/roles": {
    title: "Roles",
    article: "roles-and-access",
    blocks: [
      { kind: "p", text: "A role is a named set of permissions. Build the ones your organisation actually uses rather than fitting people into names somebody else chose." },
      { kind: "term", term: "Permission", definition: "one specific thing a person may do, such as editing assets or issuing them. The API enforces exactly these, so the screen and the API can never disagree." },
      { kind: "note", text: "A role still held by somebody cannot be deleted. Move those people to another role first, so nobody is left without one." },
    ],
  },

  "/settings/api-keys": {
    title: "API keys",
    article: "integrations",
    blocks: [
      { kind: "p", text: "Keys let another system read or update your register through the API. Give each system its own, so one can be revoked without disturbing the rest." },
      { kind: "term", term: "Scope", definition: "what a key is allowed to do. Grant the narrowest set that works - a reporting script needs to read assets and nothing more." },
      { kind: "note", text: "A key is shown once, when it is created. Only a hash is kept, so it cannot be recovered: if it is lost, revoke it and create another." },
    ],
  },

  "/settings/webhooks": {
    title: "Webhooks",
    article: "integrations",
    blocks: [
      { kind: "p", text: "Have this system tell another application the moment something happens, instead of that application asking over and over whether anything has changed." },
      { kind: "p", text: "Each delivery is signed with the endpoint's own secret, so the receiver can prove it came from us and not from somebody who guessed the URL." },
      { kind: "note", text: "A failed delivery is retried after 1, 5 and 30 minutes and then given up on. Answer quickly and do the slow work afterwards." },
    ],
  },

  "/settings/email": {
    title: "Email",
    article: "notifications",
    blocks: [
      { kind: "p", text: "Where the system's email goes out from. Nothing is sent until a provider is configured here." },
      { kind: "p", text: "Send a test message after saving. A provider that accepts the settings but rejects the mail is the common failure, and the test is what catches it." },
      { kind: "note", text: "Credentials are stored encrypted and never shown again after saving, in the same way as an API key." },
    ],
  },

  "/settings/notifications": {
    title: "Notifications",
    article: "notifications",
    blocks: [
      { kind: "p", text: "Which events send an email, and who receives it. Every rule names an event, a template and a set of recipients." },
      { kind: "term", term: "Recipient rule", definition: "who gets told: the person who did it, the person holding the asset, everybody with a given permission, or named addresses." },
      { kind: "p", text: "People can turn off individual notifications for themselves, so a rule is an offer rather than an obligation." },
      { kind: "note", text: "Turning a rule off stops the email but never stops the event being recorded. The history is always complete." },
    ],
  },
};
