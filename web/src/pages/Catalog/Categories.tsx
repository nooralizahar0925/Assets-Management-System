import { useCallback, useEffect, useState } from "react";
import EmptyState from "../../components/common/EmptyState";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import FieldSchemaEditor from "../../components/catalog/FieldSchemaEditor";
import DepreciationFields, {
  NO_DEPRECIATION, type DepreciationPolicy,
} from "../../components/catalog/DepreciationFields";
import { Modal } from "../../components/ui/modal";
import { useModal } from "../../hooks/useModal";
import { useAuth } from "../../context/AuthContext";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { Category, FieldDef } from "../../api/types";

const KINDS = [
  { value: "it", label: "IT equipment" },
  { value: "equipment", label: "Plant & equipment" },
  { value: "media", label: "Digital media" },
] as const;

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function Categories() {
  const dialog = useModal();
  const { can } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("it");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [policy, setPolicy] = useState<DepreciationPolicy>(NO_DEPRECIATION);
  const [error, setError] = useState<string | null>(null);

  const canWrite = can("categories:write");

  const load = useCallback(() => {
    void catalogApi.categories().then(setCategories).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  function open(category: Category | null) {
    setEditing(category);
    setName(category?.name ?? "");
    setKind(category?.kind ?? "it");
    setFields(category?.field_schema.fields ?? []);
    setPolicy(category ? {
      method: category.depreciation_method,
      useful_life_months: category.useful_life_months,
      salvage_pct: Number(category.salvage_pct ?? 0),
      declining_rate_pct: category.declining_rate_pct === null
        ? null : Number(category.declining_rate_pct),
    } : NO_DEPRECIATION);
    setError(null);
    dialog.openModal();
  }

  async function save() {
    setError(null);
    // A category carries the policy as flat columns, so it is spelled out
    // rather than spread - `method` is not a field the API knows.
    const payload = {
      name, kind, field_schema: { fields },
      depreciation_method: policy.method,
      useful_life_months: policy.useful_life_months,
      salvage_pct: policy.salvage_pct,
      declining_rate_pct: policy.declining_rate_pct,
    };
    try {
      if (editing) await catalogApi.updateCategory(editing.id, payload as never);
      else await catalogApi.createCategory(payload as never);
      dialog.closeModal();
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not save this category.",
      );
    }
  }

  return (
    <>
      <PageMeta title="Categories | AMS" description="Asset categories and custom fields" />
      <PageBreadcrumb pageTitle="Categories" />

      <ComponentCard
        title="Categories"
        desc="Each category defines the extra fields its assets carry. Changing them takes effect immediately — no release needed."
      >
        {canWrite && (
          <div className="mb-4">
            <button
              type="button" onClick={() => open(null)}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add category
            </button>
          </div>
        )}

        {categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description={
              canWrite
                ? "Categories decide which extra fields an asset carries - a warranty date for laptops, running hours for machinery - and hold the depreciation policy those assets inherit."
                : "Nobody has set up categories yet. Once somebody does, assets can carry the extra fields their kind needs."
            }
            actionLabel={canWrite ? "Create a category" : undefined}
            onAction={canWrite ? () => open(null) : undefined}
          />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {categories.map((category) => (
              <li key={category.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {category.name}
                    </span>
                    <Badge color="light" size="sm">
                      {KINDS.find((k) => k.value === category.kind)?.label ?? category.kind}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                    {category.field_schema.fields.length} custom field
                    {category.field_schema.fields.length === 1 ? "" : "s"} ·{" "}
                    {category.asset_count ?? 0} asset
                    {category.asset_count === 1 ? "" : "s"}
                  </p>
                </div>
                {canWrite && (
                  <button
                    type="button" onClick={() => open(category)}
                    className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
                  >
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </ComponentCard>

      <Modal
        isOpen={dialog.isOpen} onClose={dialog.closeModal}
        className="max-h-[90vh] max-w-2xl overflow-y-auto p-6"
      >
        <h3 className="mb-5 text-lg font-medium text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.name}` : "New category"}
        </h3>

        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category-name">Name</Label>
              <Input id="category-name" type="text" value={name}
                     onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="category-kind">Kind</Label>
              <select
                id="category-kind" className={selectClass} value={kind}
                onChange={(e) => setKind(e.target.value as Category["kind"])}
              >
                {KINDS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
              Depreciation
            </h4>
            <DepreciationFields
              value={policy}
              onChange={(next) => setPolicy(next ?? NO_DEPRECIATION)}
            />
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
              Custom fields
            </h4>
            <FieldSchemaEditor fields={fields} onChange={setFields} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button" onClick={dialog.closeModal}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Cancel
            </button>
            <button
              type="button" onClick={() => void save()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Save category
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
