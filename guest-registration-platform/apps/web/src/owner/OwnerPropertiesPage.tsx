import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client.js";
import OwnerLayout from "./OwnerLayout.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";
import RegistrationLinkDialog from "./RegistrationLinkDialog.js";

type Property = {
  id: string;
  name: string;
  addressLine1: string;
  postalCode: string;
  city: string;
};

export default function OwnerPropertiesPage() {
  const { user } = useOwnerAuth();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState(false);
  const [dialogProperty, setDialogProperty] = useState<Property | null>(null);

  // Only OWNER/MANAGER may create or replace a registration link.
  const canManageLinks = user?.role === "OWNER" || user?.role === "MANAGER";

  useEffect(() => {
    apiGet<{ properties: Property[] }>("/v1/owner/properties")
      .then((data) => setProperties(data.properties))
      .catch(() => setError(true));
  }, []);

  return (
    <OwnerLayout title="Properties">
      {error && <p className="text-red-600">Failed to load properties.</p>}
      {!properties && !error && <p className="text-slate-500">Loading…</p>}
      {properties && properties.length === 0 && (
        <p className="text-slate-500">No properties yet.</p>
      )}
      <ul className="space-y-3">
        {properties?.map((property) => (
          <li key={property.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Link
                  to={`/owner/properties/${property.id}/submissions`}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  {property.name}
                </Link>
                <p className="text-sm text-slate-500">
                  {property.addressLine1}, {property.postalCode} {property.city}
                </p>
              </div>
              {canManageLinks && (
                <button
                  onClick={() => setDialogProperty(property)}
                  className="shrink-0 rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
                >
                  Create / replace link
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {dialogProperty && (
        <RegistrationLinkDialog
          propertyId={dialogProperty.id}
          propertyName={dialogProperty.name}
          onClose={() => setDialogProperty(null)}
        />
      )}
    </OwnerLayout>
  );
}
