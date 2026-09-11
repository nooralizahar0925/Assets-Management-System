import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import Label from "../components/form/Label";
import Input from "../components/form/input/InputField";
import { platformApi, type Plan, type ProvisionedOrganisation } from "../api/platform";
import { ApiError } from "../api/client";

/**
 * Taking on a customer.
 *
 * One screen, because this is the thing an operator does least often and most
 * nervously. It ends with a password shown exactly once - which is why the
 * confirmation is a page of its own rather than a toast that can be dismissed
 * by a stray click before anybody has written it down.
 */

/** `Acme Ltd` becomes `acme-ltd`, which is what most people would have typed. */
const slugify = (name: string) =>
  name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export default function NewOrganisation() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [trialDays, setTrialDays] = useState("");

  const [created, setCreated] = useState<ProvisionedOrganisation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    platformApi.plans()
      .then((body) => { if (live) setPlans(body.data.filter((p) => p.active)); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  // Suggested from the name until the operator touches it, then left alone:
  // silently rewriting something somebody has typed is worse than a suggestion
  // that stops being helpful.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  const ready = name.trim() && slug.trim() && adminName.trim()
    && adminEmail.trim() && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setCreated(await platformApi.provision({
        name: name.trim(),
        slug: slug.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        planCode: planCode || null,
        trialDays: trialDays ? Number(trialDays) : null,
      }));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "That customer could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-title-sm font-bold text-white">{name} is set up</h1>
        <p className="mt-2 text-sm text-gray-400">
          Hand these to their administrator. The password is shown here once and
          is not stored anywhere - if it is lost, they can be invited again or
          the password reset, but it cannot be looked up.
        </p>

        <dl className="mt-6 space-y-4 rounded-xl border border-warning-500/40 bg-warning-500/5 p-5">
          <div>
            <dt className="text-theme-xs uppercase tracking-wide text-gray-400">
              Sign in as
            </dt>
            <dd className="mt-1 font-mono text-sm text-gray-100">
              {created.adminEmail}
            </dd>
          </div>
          <div>
            <dt className="text-theme-xs uppercase tracking-wide text-gray-400">
              Password
            </dt>
            <dd className="mt-1 flex items-center gap-3">
              <code className="flex-1 rounded-lg bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100">
                {created.password}
              </code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.password);
                  setCopied(true);
                }}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => navigate("/platform")}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-title-sm font-bold text-white">New customer</h1>
      <p className="mt-2 text-sm text-gray-400">
        Creates the organisation, its roles, its notification rules and one
        administrator who can sign in immediately.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="org-name">Organisation name</Label>
          <Input
            id="org-name" type="text" value={name} placeholder="Acme Ltd"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="org-slug">Slug</Label>
          <Input
            id="org-slug" type="text" value={slug}
            onChange={(e) => { setSlugEdited(true); setSlug(e.target.value); }}
          />
          <p className="mt-1 text-theme-xs text-gray-500">
            Appears in URLs and in exports they keep. It cannot be changed later.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="admin-name">Their administrator</Label>
            <Input
              id="admin-name" type="text" value={adminName} placeholder="Ayu Lestari"
              onChange={(e) => setAdminName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="admin-email">Their email</Label>
            <Input
              id="admin-email" type="text" value={adminEmail}
              placeholder="ayu@acme.example"
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="org-plan">Plan</Label>
            <select
              id="org-plan"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
            >
              <option value="">No plan yet</option>
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>{plan.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="org-trial">Trial days</Label>
            <Input
              id="org-trial" type="text" value={trialDays} placeholder="30"
              onChange={(e) => setTrialDays(e.target.value.replace(/\D/g, ""))}
            />
            <p className="mt-1 text-theme-xs text-gray-500">
              Leave empty for none. A lapsed trial is shown to you; nothing is
              suspended automatically.
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-error-500/40 bg-error-500/10 px-3 py-2 text-sm text-error-300"
          >
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={!ready}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create customer"}
          </button>
          <Link
            to="/platform"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 ring-1 ring-inset ring-gray-700 hover:bg-white/5"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
