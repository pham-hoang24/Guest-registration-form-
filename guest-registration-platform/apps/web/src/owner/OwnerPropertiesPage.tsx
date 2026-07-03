import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";
import OwnerLayout from "./OwnerLayout.js";

type Property = {
  id: string;
  name: string;
  addressLine1: string;
  postalCode: string;
  city: string;
};

export default function OwnerPropertiesPage() {
  const { token } = useOwnerAuth();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<{ properties: Property[] }>("/v1/owner/properties", token!)
      .then((data) => setProperties(data.properties))
      .catch(() => setError(true));
  }, [token]);

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
            <Link
              to={`/owner/properties/${property.id}/submissions`}
              className="font-semibold text-blue-700 hover:underline"
            >
              {property.name}
            </Link>
            <p className="text-sm text-slate-500">
              {property.addressLine1}, {property.postalCode} {property.city}
            </p>
          </li>
        ))}
      </ul>
    </OwnerLayout>
  );
}
