import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

export default function Authentication() {
  return (
    <Prose>
      <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
        Authentication
      </h1>

      <p>
        Machine access uses an API key as a bearer token. Browser sessions use a
        cookie and are not part of this contract — they exist for the
        application itself.
      </p>

      <CodeBlock
        label="Every request"
        code={`Authorization: Bearer ams_live_3f9a1c2...`}
      />

      <h2>Creating a key</h2>

      <p>
        Settings → API keys. Choose the narrowest scopes the integration needs:
      </p>

      <table>
        <thead>
          <tr><th>Scope</th><th>Allows</th></tr>
        </thead>
        <tbody>
          <tr><td><code>assets:read</code></td><td>Read the register, run reports</td></tr>
          <tr><td><code>assets:write</code></td><td>Create and change assets, issue and receive them</td></tr>
          <tr><td><code>reports:read</code></td><td>Run and download reports</td></tr>
          <tr><td><code>admin</code></td><td>Everything, including settings and keys</td></tr>
        </tbody>
      </table>

      <p>
        <strong>The key is shown once.</strong> Only a hash is stored, so it
        cannot be recovered — if it is lost, revoke it and mint another.
        Revoking takes effect immediately.
      </p>

      <h2>Rate limits</h2>

      <p>
        Limits apply per key, not per organisation, so one integration cannot
        exhaust another's budget. Exceeding one returns{" "}
        <code>429</code> with a <code>Retry-After</code> header saying how many
        seconds to wait. Treat that number as authoritative rather than backing
        off on a guess.
      </p>

      <h2>What a key cannot do</h2>

      <p>
        A key belongs to one organisation and can never see another's data —
        that boundary is enforced in the database, not in application code. Keys
        also cannot be limited to particular branches; if an integration should
        only see one site, filter by <code>location_id</code> in your own
        requests, or use a user account with a branch-scoped role.
      </p>
    </Prose>
  );
}
