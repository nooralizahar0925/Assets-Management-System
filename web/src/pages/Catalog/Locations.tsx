import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { useAuth } from "../../context/AuthContext";
import { catalogApi } from "../../api/catalog";
import type { LocationNode } from "../../api/types";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function Locations() {
  const { can } = useAuth();
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [address, setAddress] = useState("");

  const canWrite = can("locations:write");

  const load = useCallback(() => {
    void catalogApi.locations().then(setLocations).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  async function add() {
    if (!name.trim()) return;
    await catalogApi.createLocation({
      name, parent_id: parentId || null, address: address || null,
    });
    setName("");
    setAddress("");
    load();
  }

  return (
    <>
      <PageMeta title="Locations | AMS" description="Sites and sub-locations" />
      <PageBreadcrumb pageTitle="Locations" />

      <div className={canWrite ? "grid gap-5 lg:grid-cols-3" : ""}>
        <div className={canWrite ? "lg:col-span-2" : ""}>
          <ComponentCard title="Locations" desc="Sites, buildings, rooms — nested as deep as you need.">
            {locations.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {canWrite
                  ? "No locations yet. Add your first site on the right."
                  : "No locations have been set up yet."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {locations.map((location) => (
                  <li key={location.id} className="flex items-center gap-3 py-3 first:pt-0">
                    <span
                      className="text-sm text-gray-800 dark:text-white/90"
                      style={{ paddingLeft: `${location.depth * 20}px` }}
                    >
                      {location.depth > 0 && (
                        <span aria-hidden className="mr-2 text-gray-300">└</span>
                      )}
                      {location.name}
                      {location.address && (
                        <span className="ml-2 text-theme-xs text-gray-400">
                          {location.address}
                        </span>
                      )}
                    </span>
                    <Link
                      to={`/assets?location_id=${location.id}`}
                      className="ml-auto text-theme-xs text-brand-500 hover:text-brand-600"
                    >
                      {location.asset_count} asset{location.asset_count === 1 ? "" : "s"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ComponentCard>
        </div>

        {canWrite && (
          <ComponentCard title="Add a location">
            <div className="space-y-4">
              <div>
                <Label htmlFor="location-name">Name</Label>
                <Input id="location-name" type="text" value={name}
                       onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="location-parent">Inside</Label>
                <select
                  id="location-parent" className={selectClass} value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">Top level</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.path}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="location-address">Address</Label>
                <Input id="location-address" type="text" value={address}
                       onChange={(e) => setAddress(e.target.value)} />
              </div>
              <button
                type="button" onClick={() => void add()}
                className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              >
                Add location
              </button>
            </div>
          </ComponentCard>
        )}
      </div>
    </>
  );
}
