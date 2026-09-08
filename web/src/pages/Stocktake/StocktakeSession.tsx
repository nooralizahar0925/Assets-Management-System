import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import Badge from "../../components/ui/badge/Badge";
import { useAuth } from "../../context/AuthContext";
import { useHidScanner } from "../../hooks/useHidScanner";
import {
  stocktakeApi, type CountResult, type Reconciliation, type StocktakeSession as Session,
} from "../../api/stocktake";
import { ApiError } from "../../api/client";
import { formatDateTime } from "../../lib/datetime";

/**
 * What the counter is told after each scan.
 *
 * Wording matters more than usual here: someone working through two hundred
 * items cannot read a sentence per item, and needs to know which asset
 * registered rather than only that something did.
 */
function describeOutcome(result: CountResult): { tone: string; text: string } {
  const name = result.asset ? `${result.asset.name} (${result.asset.asset_tag})` : "";
  switch (result.outcome) {
    case "expected":
      return { tone: "success", text: `Counted ${name}` };
    case "unexpected":
      return {
        tone: "warning",
        text: `${name} — not expected here. Recorded anyway.`,
      };
    case "already_counted":
      return { tone: "info", text: `${name} was already counted` };
    default:
      return { tone: "error", text: "No asset carries that tag" };
  }
}

const TONE_CLASS: Record<string, string> = {
  success: "border-success-500 bg-success-50 text-success-600 dark:bg-success-500/10",
  warning: "border-warning-500 bg-warning-50 text-warning-600 dark:bg-warning-500/10",
  info: "border-blue-light-500 bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-500/10",
  error: "border-error-500 bg-error-50 text-error-600 dark:bg-error-500/10",
};

export default function StocktakeSession() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [session, setSession] = useState<Session | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [tag, setTag] = useState("");
  const [last, setLast] = useState<{ tone: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canCount = can("stocktake:write");

  const load = useCallback(() => {
    if (!id) return;
    void stocktakeApi.get(id)
      .then(({ session: s, reconciliation: r }) => {
        setSession(s);
        setReconciliation(r);
      })
      .catch(() => setError("Could not load this stock-take."));
  }, [id]);

  useEffect(load, [load]);

  const submitTag = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const result = await stocktakeApi.count(id, trimmed);
      setLast(describeOutcome(result));
      setTag("");
      load();
    } catch (err) {
      setLast({
        tone: "error",
        text: err instanceof ApiError ? err.message : "That scan did not register.",
      });
    } finally {
      setBusy(false);
    }
  }, [id, busy, load]);

  // A handheld scanner types the tag and presses Enter, with nothing focused.
  // This screen is used walking, one-handed, so that has to work without the
  // counter tapping into a field first.
  useHidScanner((scanned) => { void submitTag(scanned); }, canCount);

  const open = session?.status === "open";

  async function close(adjust: boolean) {
    if (adjust && !window.confirm(
      `Mark ${reconciliation?.missing.length ?? 0} uncounted asset(s) as lost? `
      + "This changes the register and cannot be undone from here.",
    )) return;

    try {
      await stocktakeApi.close(id, adjust);
      navigate("/stocktakes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close this count.");
    }
  }

  if (error && !session) {
    return (
      <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
        {error}
      </div>
    );
  }
  if (!session || !reconciliation) {
    return <p className="p-8 text-sm text-gray-500">Loading the count…</p>;
  }

  return (
    <>
      <PageMeta title={`${session.name} | AMS`} description="Stock-take in progress" />
      <PageBreadcrumb pageTitle={session.name} />

      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          {/* The breadcrumb already carries the session's name; repeating it
              in a heading gives the page two identical titles. */}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {session.location_name ?? "Unknown location"} ·{" "}
            opened {formatDateTime(session.opened_at)}
          </p>
          <Badge color={open ? "info" : "light"} size="sm">
            {open ? "In progress" : "Closed"}
          </Badge>
          <span className="ml-auto text-title-sm font-bold text-gray-800 dark:text-white/90">
            {reconciliation.counted} of {reconciliation.expected}
          </span>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        {canCount && open && (
          <ComponentCard title="Scan" desc="Use a handheld scanner, or type a tag.">
            {/* Announced politely rather than as an alert: this changes on
                every scan, and an assertive region would interrupt constantly. */}
            {last && (
              <div
                role="status"
                className={`mb-4 rounded-lg border px-4 py-3 text-sm ${TONE_CLASS[last.tone]}`}
              >
                {last.text}
              </div>
            )}

            <form
              className="flex items-end gap-2"
              onSubmit={(e: FormEvent) => { e.preventDefault(); void submitTag(tag); }}
            >
              <div className="flex-1">
                <Label htmlFor="stocktake-tag">Asset tag</Label>
                <Input
                  id="stocktake-tag" type="text" value={tag}
                  placeholder="AMS-000123"
                  onChange={(e) => setTag(e.target.value)}
                />
              </div>
              <button
                type="submit" disabled={busy}
                className="h-11 rounded-lg bg-brand-500 px-6 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                Count
              </button>
            </form>
          </ComponentCard>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <ComponentCard
            title={`Still to find (${reconciliation.missing.length})`}
            desc="Expected here, not yet counted."
          >
            {reconciliation.missing.length === 0 ? (
              <p className="py-6 text-center text-sm text-success-600">
                Everything expected has been found.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {reconciliation.missing.map((asset) => (
                  <li key={asset.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                    <Link
                      to={`/assets/${asset.id}`}
                      className="text-sm text-gray-800 hover:text-brand-500 dark:text-white/90"
                    >
                      {asset.name}
                    </Link>
                    <span className="ml-auto font-mono text-theme-xs text-gray-400">
                      {asset.asset_tag}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ComponentCard>

          <ComponentCard
            title={`Found here unexpectedly (${reconciliation.unexpected.length})`}
            desc="Counted here, but the register places them elsewhere."
          >
            {reconciliation.unexpected.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                Nothing unexpected so far.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {reconciliation.unexpected.map((asset) => (
                  <li key={asset.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                    <Link
                      to={`/assets/${asset.id}`}
                      className="text-sm text-gray-800 hover:text-brand-500 dark:text-white/90"
                    >
                      {asset.name}
                    </Link>
                    <span className="ml-auto font-mono text-theme-xs text-gray-400">
                      {asset.asset_tag}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ComponentCard>
        </div>

        {canCount && open && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button" onClick={() => void close(true)}
              className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Close and write off what is missing
            </button>
            <button
              type="button" onClick={() => void close(false)}
              className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Close without changing anything
            </button>
          </div>
        )}
      </div>
    </>
  );
}
