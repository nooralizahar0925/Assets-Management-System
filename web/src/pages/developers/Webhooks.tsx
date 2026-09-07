import { useEffect, useState } from "react";
import { Link } from "react-router";
import { developersApi, webhookEventsIn } from "../../api/developers";
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

/**
 * What each event means. The list of events themselves is read from the
 * published document, so this page can never advertise one the server would
 * refuse - an unknown event still renders, with its name and no description,
 * rather than disappearing.
 */
const MEANING: Record<string, string> = {
  "asset.created": "An asset was registered through the API or the application.",
  "asset.updated": "A field on an asset changed, including its custom fields.",
  "asset.deleted": "An asset was deleted. It is soft-deleted and keeps its history.",
  "asset.checked_out": "Custody passed to a user, a location or an external party.",
  "asset.checked_in": "An open assignment was closed and the asset came back.",
  "asset.overdue": "An assignment passed its due date without being checked in.",
  "maintenance.due": "A maintenance schedule reached its next service date.",
  "warranty.expiring": "An asset's warranty is within its warning window.",
  "licence.expiring": "A licence is within its warning window.",
  "import.completed": "A committed spreadsheet import finished, with its counts.",
};

export default function Webhooks() {
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    developersApi
      .openapi()
      .then((doc) => { if (live) setEvents(webhookEventsIn(doc)); })
      .catch(() => { if (live) setEvents(Object.keys(MEANING)); });
    return () => { live = false; };
  }, []);

  return (
    <div>
      <Prose>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Webhooks
        </h1>
        <p>
          Subscribe an endpoint under <code>POST /api/v1/webhooks</code> or in{" "}
          <strong>Settings → Webhooks</strong>. Each delivery is a{" "}
          <code>POST</code> of <code>application/json</code>, signed so you can
          prove it came from us. The signing secret is returned exactly once, at
          subscription.
        </p>

        <h2>Events</h2>
      </Prose>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-theme-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="py-2 pr-4 font-medium text-gray-500">Event</th>
              <th className="py-2 font-medium text-gray-500">Fires when</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event} className="border-b border-gray-100 dark:border-gray-800/60">
                <td className="py-2 pr-4 align-top">
                  <code className="text-gray-800 dark:text-gray-200">{event}</code>
                </td>
                <td className="py-2 text-gray-600 dark:text-gray-400">
                  {MEANING[event] ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <p className="mt-4">
          <strong>Imports do not fan out.</strong> A spreadsheet that creates a
          thousand assets sends one <code>import.completed</code>, not a
          thousand <code>asset.created</code> deliveries. If you are mirroring
          the register, treat <code>import.completed</code> as a signal to
          re-read the list rather than as a per-asset event.
        </p>

        <h2>What arrives</h2>

        <CodeBlock
          label="A delivery body"
          code={`{
  "id": "0f2c9c58-6d3a-4e1b-9c2e-6b1f4f6f9a11",
  "event": "asset.checked_out",
  "delivered_at": "2026-09-04T08:15:00.123Z",
  "data": {
    "asset_id": "3f7c…",
    "asset": { "name": "ThinkPad X1", "asset_tag": "AMS-000123", "status": "in_use" },
    "assignment": { "assignee_label": "Rina", "due_at": "2026-10-01T09:00:00Z" }
  }
}`}
        />

        <p>
          Two headers travel with it: <code>X-AMS-Event</code>, repeating the
          event name, and <code>X-AMS-Signature</code>.
        </p>

        <h2>Verifying the signature</h2>

        <p>
          The signature is <code>sha256=&lt;hex&gt;</code>, an HMAC-SHA256 of the{" "}
          <strong>raw request body</strong> under your endpoint's secret. Hash
          the bytes you received, before parsing: re-serialising the parsed JSON
          produces different bytes and the signature will never match. Compare
          in constant time.
        </p>

        <CodeBlock
          label="Node"
          code={`import crypto from "node:crypto";

// express.raw({ type: "application/json" }) — req.body must stay a Buffer.
function verify(rawBody, header, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`}
        />

        <CodeBlock
          label="Python"
          code={`import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header or "")`}
        />

        <CodeBlock
          label="PHP"
          code={`<?php
function verify(string $rawBody, ?string $header, string $secret): bool {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $header ?? '');
}`}
        />

        <h2>Retries, and why you need the id</h2>

        <p>
          Answer <code>2xx</code> within <strong>10 seconds</strong>. Anything
          else — a non-2xx status, a timeout, a refused connection — is retried
          after <strong>1, 5 and 30 minutes</strong>, four attempts in total,
          then abandoned.
        </p>

        <p>
          That makes delivery <em>at least once</em>. An endpoint that does the
          work and then answers slowly will receive the same event again, so
          record the delivery <code>id</code> and ignore one you have already
          processed. The id is stable across retries; <code>delivered_at</code>{" "}
          is not.
        </p>

        <p>
          A failing endpoint costs you deliveries, not data:{" "}
          <Link to="/developers/recipes">re-reading the register</Link> after an
          outage is always safe.
        </p>
      </Prose>
    </div>
  );
}
