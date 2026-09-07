import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import { Modal } from "../../components/ui/modal";
import { useModal } from "../../hooks/useModal";
import { useAuth } from "../../context/AuthContext";
import { membersApi, rolesApi } from "../../api/admin";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { LocationNode, OrgMember, Role } from "../../api/types";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function Users() {
  const { can } = useAuth();
  const dialog = useModal();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [editing, setEditing] = useState<OrgMember | null>(null);
  const [roleId, setRoleId] = useState("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canRead = can("users:read");
  const canAssign = can("users:write") && can("roles:read");

  const load = useCallback(() => {
    if (!canRead) return;
    void membersApi.list().then(setMembers).catch(() => undefined);
    if (canAssign) {
      void rolesApi.list().then(setRoles).catch(() => undefined);
      void catalogApi.locations().then(setLocations).catch(() => undefined);
    }
  }, [canRead, canAssign]);

  useEffect(load, [load]);

  function open(member: OrgMember) {
    setEditing(member);
    setRoleId(member.role_id ?? "");
    setLocationIds(member.location_ids);
    setError(null);
    dialog.openModal();
  }

  async function save() {
    if (!editing || !roleId) return;
    setError(null);
    try {
      await membersApi.setRole(editing.id, roleId, locationIds);
      dialog.closeModal();
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not change this person's role.",
      );
    }
  }

  if (!canRead) {
    return (
      <>
        <PageMeta title="People | AMS" description="People in this organisation" />
        <PageBreadcrumb pageTitle="People" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            People are managed by an administrator
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include viewing the people in this organisation.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="People | AMS" description="People in this organisation" />
      <PageBreadcrumb pageTitle="People" />

      <ComponentCard
        title="People"
        desc="Everyone with an account. One role each, optionally limited to particular branches."
      >
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {member.name}
                </p>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {member.email}
                </p>
              </div>

              <Badge color={member.role_name ? "info" : "light"} size="sm">
                {member.role_name ?? "No role"}
              </Badge>
              {member.location_ids.length > 0 && (
                <Badge color="light" size="sm">
                  {member.location_ids.length} branch
                  {member.location_ids.length === 1 ? "" : "es"}
                </Badge>
              )}

              <Link
                to={`/assets?assignee_id=${member.id}`}
                className="ml-auto text-theme-xs text-brand-500 hover:text-brand-600"
              >
                {member.assigned_count} asset{member.assigned_count === 1 ? "" : "s"}
              </Link>

              {canAssign && (
                <button
                  type="button" onClick={() => open(member)}
                  className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
                >
                  Change role
                </button>
              )}
            </li>
          ))}
        </ul>
      </ComponentCard>

      <Modal
        isOpen={dialog.isOpen} onClose={dialog.closeModal}
        className="max-h-[90vh] max-w-lg overflow-y-auto p-6"
      >
        <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
          {editing ? `Role for ${editing.name}` : "Role"}
        </h3>
        <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
          Everyone holds exactly one role. Leaving the branch list empty gives access to
          the whole organisation.
        </p>

        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="member-role">Role</Label>
            <select
              id="member-role" className={selectClass} value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
            >
              <option value="">Choose a role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              Limit to branches
            </legend>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-gray-200 p-3 dark:border-gray-800">
              {locations.length === 0 && (
                <p className="text-theme-xs text-gray-400">No locations yet.</p>
              )}
              {locations.map((location) => (
                <label
                  key={location.id}
                  className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                >
                  <input
                    type="checkbox"
                    checked={locationIds.includes(location.id)}
                    onChange={(e) =>
                      setLocationIds((current) =>
                        e.target.checked
                          ? [...current, location.id]
                          : current.filter((id) => id !== location.id),
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  {location.path}
                </label>
              ))}
            </div>
            <p className="mt-1 text-theme-xs text-gray-400">
              None ticked means the whole organisation.
            </p>
          </fieldset>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button" onClick={dialog.closeModal}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Cancel
            </button>
            <button
              type="button" onClick={() => void save()} disabled={!roleId}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Save role
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
