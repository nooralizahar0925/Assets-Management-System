import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { assetsApi } from "../../api/assets";

/** Where a scanned QR code lands. Resolves the tag and forwards to the asset. */
export default function TagRedirect() {
  const { tag = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    assetsApi.lookup(tag)
      .then((asset) => navigate(`/assets/${asset.id}`, { replace: true }))
      .catch(() => setError(`No asset is registered with the tag "${tag}".`));
  }, [tag, navigate]);

  if (!error) {
    return <p className="p-8 text-sm text-gray-500">Looking up {tag}…</p>;
  }
  return (
    <div className="p-8">
      <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
        Tag not found
      </h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error}</p>
      <Link to="/assets" className="mt-4 inline-block text-sm text-brand-500">
        Search the register instead
      </Link>
    </div>
  );
}
