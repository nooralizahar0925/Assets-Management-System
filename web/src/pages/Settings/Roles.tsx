import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import TextArea from "../../components/form/input/TextArea";
import { Modal } from "../../components/ui/modal";
import { useModal } from "../../hooks/useModal";
import { useAuth } from "../../context/AuthContext";
import { rolesApi } from "../../api/admin";
import { ApiError } from "../../api/client";
import type { PermissionGroup, Role } from "../../api/types";

export default function Roles() {
  const { can } = useAuth();
  const dialog = useModal();
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canRead = can("roles:read");
  const canWrite = can("roles:write");

  const load = useCallback(() => {
    if (!canRead) return;
    void rolesApi.list().then(setRoles).catch(() => undefined);
    void rolesApi.permissions().then(setGroups).catch(() => undefined);
  }, [canRead]);

  useEffect(load, [load]);

  function open(role: Role | null) {
    setEditing(role);
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setPermissions(role?.permissions ?? []);
    setError(null);
    dialog.openModal();
  }

  const toggle = (key: string) =>
    setPermissions((current) =>
      current.includes(key) ? current.filter((p) => p !== key) : [...current, key],
    );

  function toggleGroup(group: PermissionGroup, on: boolean) {
    const keys = group.permissions.map((p) => p.key);
    setPermissions((current) =>
      on
        ? [...new Set([...current, ...keys])]
        : current.filter((p) => !keys.includes(p)),
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = { name, description: description || null, permissions };
      if (editing) await rolesApi.update(editing.id, payload);
      else await rolesApi.create(payload);
      dialog.closeModal();
      load();
    } catch (err) {
      // 409 carries the guards worth reading aloud: the last administrator
      // rule, and a duplicate name.
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not save this role.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(role: Role) {
    if (!window.confirm(
      `Delete the role "${role.name}"? This cannot be undone.`,
    )) return;
    setListError(null);
    try {
      await rolesApi.remove(role.id);
      load();
    } catch (err) {
      // A role still held by somebody, or one the product ships with, is
      // refused with a reason; showing it beats a silent no-op.
      setListError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not delete this role.",
      );
    }
  }

  if (!canRead) {
    return (
      <>
        <PageMeta title="Roles | AMS" description="Roles and permissions" />
        <PageBreadcrumb pageTitle="Roles" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Roles are managed by an administrator
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include viewing or changing what other roles can do.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Roles | AMS" description="Roles and permissions" />
      <PageBreadcrumb pageTitle="Roles" />

      <ComponentCard
        title="Roles"
        desc="Each person holds exactly one role. Rename these, or add your own, to match how your organisation actually works."
      >
        {listError && (
          <div role="alert" className="mb-4 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {listError}
          </div>
        )}

        {canWrite && (
          <div className="mb-4">
            <button
              type="button" onClick={() => open(null)}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add role
            </button>
          </div>
        )}

        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {roles.map((role) => (
            <li key={role.id} className="flex flex-wrap items-center gap-3 py-4 first:pt-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {role.name}
                  </span>
                  {role.is_system && <Badge color="light" size="sm">Built in</Badge>}
                  <Badge color={role.user_count > 0 ? "info" : "light"} size="sm">
                    {role.user_count} {role.user_count === 1 ? "person" : "people"}
                  </Badge>
                </div>
                {role.description && (
                  <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                    {role.description}
                  </p>
                )}
                <p className="mt-0.5 text-theme-xs text-gray-400">
                  {role.permissions.length} permission
                  {role.permissions.length === 1 ? "" : "s"}
                </p>
              </div>

              {canWrite && (
                <div className="ml-auto flex gap-2">
                  <button
                    type="button" onClick={() => open(role)}
                    className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
                  >
                    Edit
                  </button>
                  {/* The roles the product ships with cannot be deleted, and the
                      API refuses it - so the button is not offered. */}
                  {!role.is_system && (
                    <button
                      type="button" onClick={() => void remove(role)}
                      className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-400 hover:text-error-500"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </ComponentCard>

      <Modal
        isOpen={dialog.isOpen} onClose={dialog.closeModal}
        className="max-h-[90vh] max-w-2xl overflow-y-auto p-6"
      >
        <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.name}` : "New role"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Tick everything this role should be able to do. A role needs at least one
          permission.
        </p>

        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" type="text" value={name}
                   placeholder="Warehouse supervisor"
                   onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="role-description">Description</Label>
            <TextArea value={description} onChange={setDescription} rows={2} />
          </div>

          <div className="space-y-4">
            {groups.map((group) => {
              const keys = group.permissions.map((p) => p.key);
              const all = keys.every((key) => permissions.includes(key));
              return (
                <fieldset
                  key={group.group}
                  className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                >
                  <legend className="flex items-center gap-3 px-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {group.group}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group, !all)}
                      className="text-theme-xs text-brand-500 hover:text-brand-600"
                    >
                      {all ? "Clear all" : "Select all"}
                    </button>
                  </legend>

                  <div className="space-y-2">
                    {group.permissions.map((permission) => (
                      <label
                        key={permission.key}
                        className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                      >
                        <input
                          type="checkbox"
                          checked={permissions.includes(permission.key)}
                          onChange={() => toggle(permission.key)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                        />
                        <span>
                          {permission.label}
                          {permission.description && (
                            <span className="block text-theme-xs text-gray-400">
                              {permission.description}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
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
              disabled={saving || !name.trim() || permissions.length === 0}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save role"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
