import { useEffect, useState } from "react";
import { Link } from "react-router";
import { platformApi, type AttentionItem, type ReasonKind } from "../api/platform";

/**
 * What needs a decision today.
 *
 * Not a dashboard. The operator's question is "who do I need to do something
 * about", and a chart never answers it - so this is a list of customers, each
 * with the reasons beside them, most to discuss first.
 */

const KIND_LABEL: Record<ReasonKind, string> = {
  "over-limit": "Over their limit",
  "trial-ending": "Trial",
  "renewal-due": "Renewal",
  "no-plan": "No plan",
  "long-suspended": "Suspended",
  dormant: "Dormant",
};

// Being over a limit means their writes are being refused right now, so it
// reads as urgent. The rest are conversations, not incidents.
const KIND_STYLE: Record<ReasonKind, string> = {
  "over-limit": "bg-error-500/15 text-error-300",
  "trial-ending": "bg-warning-500/15 text-warning-300",
  "renewal-due": "bg-blue-light-500/15 text-blue-light-300",
  "no-plan": "bg-gray-500/15 text-gray-300",
  "long-suspended": "bg-gray-500/15 text-gray-300",
  dormant: "bg-gray-500/15 text-gray-300",
};

export default function Attention() {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    platformApi.attention()
      .then((body) => { if (live) setItems(body.data); })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  if (failed) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-error-500/40 bg-error-500/10 px-4 py-3 text-sm text-error-300"
      >
        This could not be loaded.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-title-sm font-bold text-white">Needs attention</h1>
        {loaded && items.length > 0 && (
          <span className="text-sm text-gray-400">
            {items.length} customer{items.length === 1 ? "" : "s"}
          </span>
        )}
        <Link
          to="/platform/customers"
          className="ml-auto text-theme-xs font-medium text-brand-400 hover:text-brand-300"
        >
          All customers →
        </Link>
      </div>

      {loaded && items.length === 0 && (
        // An empty list is the right answer, not a page of zeroes.
        <div className="rounded-xl border border-gray-800 bg-gray-800/50 px-6 py-16 text-center">
          <h2 className="text-base font-semibold text-white">
            Nothing needs deciding
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
            No trials about to lapse, no renewals due, nobody over a limit or
            sitting without a plan. Come back when something changes.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.org_id}
            className="rounded-xl border border-gray-800 p-4 hover:border-gray-700"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={`/platform/${item.org_id}`}
                className="text-sm font-medium text-gray-100 hover:text-brand-300"
              >
                {item.name}
              </Link>
              <span className="text-theme-xs text-gray-500">{item.slug}</span>
            </div>

            <ul className="mt-3 space-y-1">
              {item.reasons.map((reason, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-theme-xs font-medium ${KIND_STYLE[reason.kind]}`}
                  >
                    {KIND_LABEL[reason.kind]}
                  </span>
                  <span className="text-theme-xs text-gray-400">
                    {reason.detail}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
