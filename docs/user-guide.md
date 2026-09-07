# Assets Management System — User guide

This document is **generated** from the in-app help centre by `npm run docs:guide`.
Edit `web/src/content/help/articles.ts` and regenerate; anything written here by
hand is lost on the next run.

## Contents

- **Getting started**
  - [Setting up your register](#getting-started)
- **Managing assets**
  - [Adding and editing assets](#managing-assets)
- **Check-in and check-out**
  - [Checking assets in and out](#check-in-out)
- **Scanning and labels**
  - [Scanning labels and printing them](#scanning)
- **Importing and exporting**
  - [Importing and exporting](#importing)
- **Categories and custom fields**
  - [Categories and custom fields](#categories-and-fields)
- **Stock-takes**
  - [Counting what you actually have](#stock-takes)
- **Maintenance**
  - [Keeping things serviced](#maintenance)
- **Depreciation and value**
  - [What the register is worth](#depreciation)
- **Reports**
  - [Running and scheduling reports](#reports)
- **Users and access**
  - [Who can do what](#roles-and-access)
- **Integrations**
  - [Connecting another system](#integrations)
- **Notifications**
  - [Email and notifications](#notifications)

## Getting started

<a id="getting-started"></a>

### Setting up your register

*The four steps from an empty account to a register you can trust.*

An asset register is only useful if it matches reality. These four steps get you there in about an hour for a few hundred assets.

1. Create your categories first. They decide which extra fields each kind of asset carries, and which depreciation policy it inherits.
2. Add your locations as a tree - sites, then buildings, then rooms - so you can filter by site later and limit people to their own.
3. Import the spreadsheet you keep today. Use the dry run to check the column mapping before anything is written.
4. Check a few assets out to real people. The register becomes trustworthy the moment it reflects who actually holds what.

> **Note:** Do not try to make the import perfect. Get the assets in, then correct them in place - every correction is recorded in the asset's history, so nothing is lost by fixing things later.

## Managing assets

<a id="managing-assets"></a>

### Adding and editing assets

*Creating assets, what each status means, and why nothing is ever really deleted.*

Only a name is required to create an asset. Leave the asset tag blank and the next tag in your organisation's sequence is allocated for you.

**Asset tag** — your own identifier for the asset, unique within your organisation. It is what goes on the printed label.

**Serial number** — the manufacturer's identifier. Optional, but it is what you will search by when somebody reads a number off a sticker over the phone.

Statuses describe where an asset is in its life:

- Available - in your possession and free to issue.
- In use - checked out to somebody or somewhere.
- Maintenance - being serviced or repaired, and not available to issue.
- Retired - has left service but is kept for the record and for audit.
- Lost - unaccounted for. Keep it rather than deleting it: a lost asset that turns up has a history worth having.

> **Note:** Deleting an asset hides it from the register but never removes it from the database, because asset records are evidence in an audit. Retire it instead when it has simply reached the end of its life.

## Check-in and check-out

<a id="check-in-out"></a>

### Checking assets in and out

*Passing custody to a person, a place or an outside party, and getting it back.*

Checking out records who holds an asset. It can go to a person, to a location for shared equipment, or to a named outside party such as a contractor.

1. Open the asset, or scan its label.
2. Choose Check out, then pick the person, location or outside party.
3. Set a due date if it is coming back. Overdue assets are surfaced on the dashboard and can send a reminder email.
4. Add a note if the context matters - which job it went out on, what condition it was in.

Checking in closes the assignment and returns the asset to available. Record the condition on return: that record is what settles a disagreement months later.

> **Note:** An asset can only be held by one person at a time. A second check-out is refused rather than quietly overwriting the first, so the register never claims two people have the same machine.

## Scanning and labels

<a id="scanning"></a>

### Scanning labels and printing them

*QR codes for phones, Code 128 for warehouse scanners, and how to print sheets.*

Every asset carries a tag that prints as two kinds of barcode, because the two situations need different things.

**QR code** — holds a link to the asset. Anybody can scan it with a plain phone camera and land on the asset page - there is no app to install. If they are not signed in they are asked to, then taken straight there.

**Code 128** — holds just the tag. A USB or Bluetooth scanner types it into whatever field is focused, exactly as a person would, which is what makes a warehouse scanner work with no setup at all.

To scan inside the application, use Scan in the header. The camera option works on a phone or a laptop; the scanner option simply waits for a handheld scanner to type.

1. Select the assets you want labels for on the register.
2. Choose Print labels, then pick the label sheet size you buy.
3. Print onto plain paper first and hold it against a sheet to check the alignment.

> **Note:** Print a spare label for each asset and keep it with the paperwork. A label that falls off in a workshop is the most common reason an asset drifts out of a register.

## Importing and exporting

<a id="importing"></a>

### Importing and exporting

*Bringing a spreadsheet in safely with a dry run, and getting your data back out.*

Import accepts CSV and Excel files. The process is deliberately three steps, so that a mis-mapped column cannot silently rewrite your register.

1. Upload the file. The first row is treated as the header.
2. Map each column onto an asset field. Columns you do not map are ignored, and a category's custom fields appear once you choose that category.
3. Read the dry-run preview: how many assets would be created, how many updated, and every row that would be rejected, with the reason.
4. Commit the import only once the preview looks right.

**Dry run** — a complete validation pass that writes nothing at all. Running one costs nothing, and it is the only chance to catch a mistake before it lands.

Rows match existing assets by asset tag, or by serial number where there is no tag. Re-importing a corrected sheet therefore updates those assets rather than creating duplicates.

> **Note:** Export the register before a large import. It is the fastest way back if the mapping turns out to have been wrong.

## Categories and custom fields

<a id="categories-and-fields"></a>

### Categories and custom fields

*Why a laptop and a generator need different fields, and how to set that up.*

Different kinds of asset need different information. A laptop needs a warranty expiry; a generator needs running hours and a next service date; a licence needs an expiry and a rights holder. Categories are how you say that.

**Field schema** — the list of extra fields every asset in a category carries. Each field has a key the API uses, a label people see, a type, and an optional required flag.

Fields can be text, a number, a date, a fixed list of choices, or a yes/no. Choose the narrowest type that fits: a date field sorts and filters properly, where the same date typed into a text field does not.

1. Open Categories and create or edit one.
2. Add a field, giving it a label, a type, and whether it is required.
3. Save. The field appears immediately on the form for every asset in that category.

> **Note:** A field's type cannot be changed once assets hold values for it, because those values would become invalid. Add a new field and move the values across instead.

## Stock-takes

<a id="stock-takes"></a>

### Counting what you actually have

*Walking the site with a scanner, and what to do with what the count finds.*

A stock-take is a physical count. You walk the site scanning what is actually there, and the system tells you what it expected to find, what is missing, and what turned up somewhere it should not be.

1. Start a session, optionally limited to one location so two people can count different buildings at once.
2. Scan or type each asset tag as you find it. The list updates as you go.
3. Work through anything still expected but not counted before you finish - that is the part worth doing carefully.
4. Close the session. The counts become the record of what was found that day.

**Unexpected** — an asset found here that the register says is somewhere else. This is not an error - it is exactly the finding a stock-take exists to produce.

> **Note:** Closing a session is final. Investigate the missing assets first: an asset marked lost that was really in the next room is a correction somebody has to unpick later.

## Maintenance

<a id="maintenance"></a>

### Keeping things serviced

*Repeating service schedules, what completing one does, and who gets told.*

Some assets need work on a timetable: an inspection, a calibration, a filter change. A maintenance schedule records what has to happen, how often, and when it is next due.

1. Open the asset and add a schedule, with what the work is and how many months apart it falls.
2. When the work is done, complete the schedule and record what was done.
3. The next due date moves forward automatically from the completion.

Assets with work coming up appear on the dashboard, and a notification rule can email the people responsible before the date rather than after it.

> **Note:** Complete the schedule rather than editing its due date. Editing the date moves the reminder but leaves no record that the work was ever done.

## Depreciation and value

<a id="depreciation"></a>

### What the register is worth

*How assets lose value over time, and where the numbers on the dashboard come from.*

An asset is worth less each year than it cost. Depreciation is how that is written down, and it is what turns a list of purchases into a number your finance team can use.

**Straight line** — the same amount written off every month across the asset's useful life. Simple, predictable, and what most organisations use.

**Reducing balance** — a fixed percentage of what is left each month, so the asset loses value quickly at first and slowly later. Closer to how vehicles and machinery actually behave.

**Salvage value** — what the asset will still be worth at the end of its life. Depreciation stops there rather than running to zero.

Set the policy on a category and every asset in it inherits it. Set it on one asset only when that asset is genuinely an exception, and clear the override to put it back on its category's policy.

> **Note:** Book value on the dashboard comes from month-end snapshots, not from a live calculation. That is deliberate: a figure that changes while you are reading it cannot be reconciled with a report you ran yesterday.

## Reports

<a id="reports"></a>

### Running and scheduling reports

*The report catalogue, the output formats, and emailing a report on a timetable.*

Reports answer the questions people actually ask: what do we own, what is it worth, what is overdue, what is due for service, and what happened to a particular asset.

Every report downloads as JSON for another system, CSV for a spreadsheet, Excel with formatting, PDF for circulation, or an image for a slide.

> **Note:** All the formats come from one query, so the PDF you email and the spreadsheet your finance team analyses cannot disagree with each other.

1. Open Reports and choose one from the gallery.
2. Set its filters - the date range, a category, a location.
3. Download it, or save it and put it on a schedule to be emailed regularly.

**Scheduled report** — a saved report with its filters, run automatically on a timetable and emailed to a list of people. This is usually what somebody means when they ask for a monthly report.

## Users and access

<a id="roles-and-access"></a>

### Who can do what

*Building roles out of permissions, and limiting people to their own branches.*

A role is a named set of permissions that you build yourself. There is no fixed list to fit your organisation into: create the roles you actually use, and call them what your colleagues already call them.

**Permission** — one specific thing a person may do - read assets, edit them, issue them, run a stock-take, manage users. The API enforces exactly these, so what the screen offers and what the system allows can never drift apart.

A role can also be limited to particular branches. Somebody scoped to one site sees only that site's assets - in the register, in search, in reports and on the dashboard - and cannot move an asset out of it.

1. Open Settings, then Roles, and create a role with the permissions that job needs.
2. Open People and give somebody that role, choosing their branches if they should only see part of the organisation.
3. Grant the least that lets them do their work. It is easy to add a permission later and awkward to explain why somebody deleted something.

> **Note:** A role still held by somebody cannot be deleted - move those people to another role first. Changing somebody's role never removes what they have already done: the history keeps their name against it.

## Integrations

<a id="integrations"></a>

### Connecting another system

*API keys, their scopes, and having events pushed to you instead of polling.*

Other systems talk to your register through the API using a key. Give each system its own key, so that one can be revoked without disturbing the others.

1. Open Settings, then API keys, and create one.
2. Name it after the system that will use it, so that a key you find in a year is identifiable.
3. Grant the narrowest scopes that work - a reporting script needs to read assets and nothing more.
4. Copy the key immediately. It is shown once and cannot be recovered.

A webhook is the other direction: instead of another system asking us repeatedly whether anything has changed, we send it a signed message the moment something does. Subscribe an endpoint under Settings, then Webhooks.

> **Note:** To rotate a key: create the replacement, move the integration onto it, confirm it works, and only then revoke the old one. Revocation takes effect on the very next request.

The full API documentation, with copy-paste examples in four languages, is at /developers.

## Notifications

<a id="notifications"></a>

### Email and notifications

*Setting up sending, choosing which events email whom, and turning them off.*

Nothing is emailed until an email provider is configured. Once it is, notification rules decide which events send mail and who receives it.

1. Open Settings, then Email, and enter your provider's details.
2. Send a test message. A provider that accepts the settings but then rejects the mail is the usual failure, and only a test finds it.
3. Open Notifications and check the rules: each names an event, a template and who is told.

**Recipient rule** — who gets told - the person who did it, the person holding the asset, everybody with a given permission, or named addresses.

Anybody can turn off individual notifications for themselves, so a rule is an offer rather than an obligation.

> **Note:** Turning a rule off stops the email but never stops the event being recorded. The asset's history stays complete whatever anybody chooses to be told about.
