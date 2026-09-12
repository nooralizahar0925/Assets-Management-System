import { describe, it, expect } from "vitest";
import { WEBHOOK_EVENTS } from "./webhooks";
import { sources, withoutComments } from "../../test/sources";



/**
 * Every event name the system actually dispatches, read out of the source.
 *
 * A subscription that never fires is the worst kind of integration bug: the
 * customer's code is correct, our UI accepted the subscription, and nothing
 * ever arrives - and "no deliveries" looks exactly like "nothing happened
 * yet", so nobody reports it. Reading the dispatch calls rather than trusting
 * the published list turns that into a failing build.
 */
async function dispatchedEvents(): Promise<Set<string>> {
  const events = new Set<string>();
  for (const source of await sources()) {
    const text = withoutComments(source.text);

    for (const match of text.matchAll(/\bdispatch\(\s*\w+\s*,\s*"([a-z._]+)"/g)) {
      events.add(match[1]);
    }

    // The expiring sweep dispatches from a table of jobs rather than a string
    // literal, so its table is read too - but only in a file that actually
    // dispatches from one. Scanning every `event:` key would also collect
    // audit-trail names and notification-rule defaults, and this test would
    // pass without a single webhook ever being sent.
    if (/\bdispatch\(\s*\w+\s*,\s*\w+\.event\b/.test(text)) {
      for (const match of text.matchAll(/\bevent:\s*"([a-z._]+)"/g)) {
        events.add(match[1]);
      }
    }
  }
  return events;
}

describe("the published webhook events", () => {
  it("are all actually dispatched somewhere", async () => {
    const dispatched = await dispatchedEvents();
    const dead = WEBHOOK_EVENTS.filter((event) => !dispatched.has(event));
    expect(dead, `subscribable but never fired: ${dead.join(", ")}`).toEqual([]);
  });

  it("found a believable number of dispatch sites, so the scanner still works", async () => {
    // Without this, the test above passes vacuously the day the regex breaks.
    expect((await dispatchedEvents()).size).toBeGreaterThan(4);
  });
});
