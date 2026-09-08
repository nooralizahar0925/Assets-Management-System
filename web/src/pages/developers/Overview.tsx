import { Link } from "react-router";
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

export default function Overview() {
  return (
    <Prose>
      <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
        The Assets Management System API
      </h1>

      <p>
        Everything the application does, your own systems can do. The register,
        custody, imports, reports, stock-takes and maintenance are all reachable
        over HTTP, and every change the API makes is recorded in the same audit
        trail as a change made by hand.
      </p>

      <h2>Where to start</h2>

      <p>
        Create an API key under <strong>Settings → API keys</strong>, give it the
        narrowest scopes the integration needs, and read one asset:
      </p>

      <CodeBlock
        label="curl"
        code={`curl https://your-host/api/v1/assets?per_page=1 \
  -H "Authorization: Bearer ams_live_..."`}
      />

      <p>
        Every response is JSON. Every failure is a{" "}
        <a href="https://www.rfc-editor.org/rfc/rfc9457" target="_blank" rel="noreferrer">
          problem document
        </a>{" "}
        with the same shape, so errors can be handled in one place rather than
        per endpoint — see <Link to="/developers/errors">Errors</Link> for the
        full list and what to do about each one.
      </p>

      <h2>What is worth knowing before you build</h2>

      <ul>
        <li>
          <strong>Retries are safe if you ask for them.</strong> Send an{" "}
          <code>Idempotency-Key</code> on a create or a check-out and a repeat
          returns the original result rather than making a second asset.
        </li>
        <li>
          <strong>You can be told instead of polling.</strong> Subscribe a{" "}
          webhook endpoint and receive signed deliveries when something happens.
        </li>
        <li>
          <strong>Keys are scoped and rate limited per key.</strong> Give each
          integration its own, so one noisy job cannot exhaust another's budget
          or read more than it needs.
        </li>
        <li>
          <strong>Reports come in six formats</strong> from one endpoint: JSON,
          CSV, XLSX, PDF, SVG and PNG.
        </li>
      </ul>

      <h2>Versioning</h2>

      <p>
        The API is versioned in its path. <code>/api/v1</code> will not change
        incompatibly: fields may be added, but nothing published here will be
        removed or repurposed without a new version. The{" "}
        <code>GET /api/version</code> endpoint reports which build you are
        talking to, which is the first thing to quote in a support conversation.
      </p>
    </Prose>
  );
}
