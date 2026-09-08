import { Link } from "react-router";
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

export default function Conventions() {
  return (
    <Prose>
      <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
        Conventions
      </h1>

      <p>
        The rules that hold everywhere, so each endpoint does not have to
        restate them.
      </p>

      <h2>Lists are paginated</h2>

      <p>
        A collection returns its rows in <code>data</code> and its counts in{" "}
        <code>meta</code>. Ask for a page with <code>page</code> and{" "}
        <code>per_page</code>; <code>per_page</code> is capped at 200.
      </p>

      <CodeBlock
        label="GET /api/v1/assets?page=2&per_page=50"
        code={`{
  "data": [ { "id": "…", "name": "ThinkPad T14", "status": "in_use" } ],
  "meta": { "page": 2, "per_page": 50, "total": 1284, "total_pages": 26 }
}`}
      />

      <p>
        Sort with <code>sort</code>, prefixed with <code>-</code> for
        descending: <code>sort=-purchase_cost</code>.
      </p>

      <h2>Money is read as a string and written as a number</h2>

      <p>
        Amounts come back as decimal strings — <code>"24500000.00"</code> — so
        no precision is lost on the way to you. Parse them with a decimal
        library, or leave them as strings if you are only displaying them.
      </p>

      <p>
        Writes are the other way round: <code>purchase_cost</code> is sent as a
        JSON number. That asymmetry is worth knowing before you echo a value
        straight back — sending the string you were given is rejected with a{" "}
        <code>422</code>.
      </p>

      <h2>Dates and times</h2>

      <p>
        Dates are <code>YYYY-MM-DD</code>. Timestamps are ISO 8601 in UTC. A due
        date sent without a time is treated as the end of that day, so an asset
        due back "on the 12th" is not overdue at one minute past midnight.
      </p>

      <h2>Retrying safely</h2>

      <p>
        A timeout tells you nothing about whether the write happened. Send an{" "}
        <code>Idempotency-Key</code> and a retry returns the original response
        instead of doing the work twice:
      </p>

      <CodeBlock
        label="A retryable create"
        code={`curl -X POST https://your-host/api/v1/assets \
  -H "Authorization: Bearer ams_live_..." \
  -H "Idempotency-Key: 8f14e45f-ceea-467a-9f0b-1c2d3e4f5a6b" \
  -H "Content-Type: application/json" \
  -d '{"name": "ThinkPad T14"}'`}
      />

      <p>
        The replay carries <code>Idempotent-Replay: true</code> so you can tell
        it was not fresh work. Keys are remembered for 24 hours and are scoped
        to your organisation. Only successful responses are stored — a failure
        can always be retried.
      </p>

      <h2>Being told rather than polling</h2>

      <p>
        Subscribe an endpoint under <code>/api/v1/webhooks</code> and receive a
        signed <code>POST</code> when something happens. Each delivery carries{" "}
        <code>X-AMS-Event</code> and <code>X-AMS-Signature</code>, the latter an
        HMAC-SHA256 of the exact request body:
      </p>

      <CodeBlock
        label="Verifying a delivery (Node)"
        code={`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, signature) {
  const expected = "sha256=" +
    createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}`}
      />

      <p>
        Verify against the <strong>raw body</strong>, before parsing: re-encoding
        the JSON produces different bytes and the signature will not match. A
        failed delivery is retried after 1, 5 and 30 minutes, then given up on,
        so an endpoint that is briefly down loses nothing.
      </p>

      <h2>Errors</h2>

      <p>
        Every failure is a problem document with a stable <code>type</code> URI.
        Branch on that rather than on the status code or the message — see{" "}
        <Link to="/developers/errors">Errors</Link>.
      </p>

      <h2>Tracing a request</h2>

      <p>
        Every response carries <code>X-Request-Id</code>. Send your own and it
        is echoed; otherwise one is generated. Quote it when reporting a problem
        and it identifies the exact request in the server logs.
      </p>
    </Prose>
  );
}
