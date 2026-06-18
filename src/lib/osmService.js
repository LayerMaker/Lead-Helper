export async function geocodeAddress(address, options = {}) {
  const query = String(address || "").trim();
  if (!query) {
    throw new Error("Enter an address before geocoding.");
  }

  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(options.limit || 3),
    addressdetails: "1",
    countrycodes: options.countryCode || "gb",
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`OSM geocoding failed (${response.status})`);
  }

  const results = await response.json();
  if (!Array.isArray(results) || !results.length) {
    throw new Error("No map match found for that address.");
  }

  return results.map((item) => ({
    lat: Number(item.lat),
    lng: Number(item.lon),
    displayName: item.display_name || query,
  }));
}
