import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import TextArea from "../../components/form/input/TextArea";
import CustomFields from "../../components/assets/CustomFields";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import type { Category, LocationNode, AssetStatus } from "../../api/types";

const STATUSES: AssetStatus[] = [
  "available", "in_use", "maintenance", "retired", "lost",
];

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface FormState {
  name: string;
  asset_tag: string;
  serial_no: string;
  description: string;
  category_id: string;
  status: AssetStatus;
  location_id: string;
  purchase_date: string;
  purchase_cost: string;
  currency: string;
  custom: Record<string, unknown>;
}

const EMPTY: FormState = {
  name: "", asset_tag: "", serial_no: "", description: "", category_id: "",
  status: "available", location_id: "", purchase_date: "", purchase_cost: "",
  currency: "IDR", custom: {},
};

export default function AssetForm({ mode }: { mode: "create" | "edit" }) {
  const { id } = useParams();
  const { can, user } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);

  /**
   * A branch-limited person can only file an asset in a branch they can see.
   * Offering the whole tree would let them pick a location the API refuses, and
   * an asset filed outside their scope is one they immediately lose sight of.
   */
  const selectableLocations = user?.location_scope
    ? locations.filter((l) => user.location_scope!.includes(l.id))
    : locations;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([catalogApi.categories(), catalogApi.locations()])
      .then(([c, l]) => { setCategories(c); setLocations(l); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    void assetsApi.get(id).then((asset) => setForm({
      name: asset.name,
      asset_tag: asset.asset_tag,
      serial_no: asset.serial_no ?? "",
      description: asset.description ?? "",
      category_id: asset.category_id ?? "",
      status: asset.status,
      location_id: asset.location_id ?? "",
      purchase_date: asset.purchase_date ?? "",
      purchase_cost: asset.purchase_cost ?? "",
      currency: asset.currency,
      custom: asset.custom,
    }));
  }, [mode, id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const schema =
    categories.find((c) => c.id === form.category_id)?.field_schema.fields ?? [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setBanner(null);

    // Empty strings mean "not set", not "set to empty" — send null instead.
    const payload = {
      name: form.name,
      asset_tag: form.asset_tag || undefined,
      serial_no: form.serial_no || null,
      description: form.description || null,
      category_id: form.category_id || null,
      status: form.status,
      location_id: form.location_id || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost === "" ? null : Number(form.purchase_cost),
      currency: form.currency,
      custom: form.custom,
    };

    try {
      const saved = mode === "create"
        ? await assetsApi.create(payload as never)
        : await assetsApi.update(id!, payload as never);
      navigate(`/assets/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setBanner(err.problem.detail ?? err.message);
      } else {
        setBanner("Could not save this asset.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Guarding here rather than only on submit: filling in a form the API will
  // refuse wastes the person's work and tells them nothing until the end.
  if (!can("assets:write")) {
    return (
      <>
        <PageMeta title="Not permitted | Assets" description="Not permitted" />
        <PageBreadcrumb pageTitle={mode === "create" ? "New asset" : "Edit asset"} />
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="mb-2 font-semibold text-gray-800 dark:text-white/90">
            You cannot change assets
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your role does not include editing the register. Ask an administrator
            if you need it.
          </p>
          <Link to="/assets" className="mt-4 inline-block text-sm text-brand-500">
            Back to the register
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={`${mode === "create" ? "New asset" : "Edit asset"} | AMS`}
        description="Create or edit an asset"
      />
      <PageBreadcrumb pageTitle={mode === "create" ? "New asset" : "Edit asset"} />

      <form onSubmit={onSubmit} className="space-y-5">
        {banner && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
            {banner}
          </div>
        )}

        <ComponentCard title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">Name<span className="text-error-500">*</span></Label>
              <Input
                id="name" type="text" value={form.name} error={Boolean(errors.name)}
                placeholder="Dell Latitude 5540"
                onChange={(e) => set("name", e.target.value)}
              />
              {errors.name && <p className="mt-1 text-theme-xs text-error-500">{errors.name}</p>}
            </div>
            <div>
              <Label htmlFor="asset_tag">Asset tag</Label>
              <Input
                id="asset_tag" type="text" value={form.asset_tag}
                error={Boolean(errors.asset_tag)}
                placeholder="Generated automatically if left blank"
                onChange={(e) => set("asset_tag", e.target.value)}
              />
              {errors.asset_tag && (
                <p className="mt-1 text-theme-xs text-error-500">{errors.asset_tag}</p>
              )}
            </div>
            <div>
              <Label htmlFor="serial_no">Serial number</Label>
              <Input
                id="serial_no" type="text" value={form.serial_no}
                error={Boolean(errors.serial_no)}
                onChange={(e) => set("serial_no", e.target.value)}
              />
              {errors.serial_no && (
                <p className="mt-1 text-theme-xs text-error-500">{errors.serial_no}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <TextArea
                value={form.description}
                onChange={(value: string) => set("description", value)}
                rows={3}
              />
            </div>
          </div>
        </ComponentCard>

        <ComponentCard title="Classification">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category_id">Category</Label>
              <select
                id="category_id" className={selectClass} value={form.category_id}
                onChange={(e) => {
                  // Switching category changes which custom fields apply; drop the
                  // old values rather than sending fields the new schema rejects.
                  set("category_id", e.target.value);
                  set("custom", {});
                }}
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <select
                id="status" className={selectClass} value={form.status}
                onChange={(e) => set("status", e.target.value as AssetStatus)}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="location_id">Location</Label>
              <select
                id="location_id" className={selectClass} value={form.location_id}
                onChange={(e) => set("location_id", e.target.value)}
              >
                <option value="">Unassigned</option>
                {selectableLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {" ".repeat(l.depth * 2)}{l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </ComponentCard>

        <ComponentCard title="Purchase">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="purchase_date">Purchase date</Label>
              <Input
                id="purchase_date" type="date" value={form.purchase_date}
                onChange={(e) => set("purchase_date", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="purchase_cost">Purchase cost</Label>
              <Input
                id="purchase_cost" type="number" step={1} value={form.purchase_cost}
                error={Boolean(errors.purchase_cost)}
                onChange={(e) => set("purchase_cost", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency" type="text" value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
              />
            </div>
          </div>
        </ComponentCard>

        <ComponentCard
          title={`${categories.find((c) => c.id === form.category_id)?.name ?? "Category"} fields`}
          desc="Defined by the asset's category."
        >
          <CustomFields
            schema={schema}
            value={form.custom}
            errors={errors}
            onChange={(key, value) =>
              set("custom", { ...form.custom, [key]: value })
            }
          />
        </ComponentCard>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "create" ? "Create asset" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
