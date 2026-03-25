const AIRLABS_API_KEY = process.env.AIRLABS_API_KEY;

const AIRCRAFT_LABELS = {
  A359: "Airbus A350-900",
  A35K: "Airbus A350-1000",
  A343: "Airbus A340-300",
  A306: "Airbus A300-600",
  A30B: "Airbus A300B4",
  L101: "Lockheed L-1011 TriStar",
  L10: "Lockheed L-1011 TriStar"
};

function sendJson(res, status, body) {
  res.status(status).setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(body));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Upstream request failed: ${response.status}`);
  }
  return response.json();
}

function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return days.map((d) => String(d).toLowerCase());
}

function dedupeRoutes(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    const key = [
      route.airlineIcao || "",
      route.flightNumber || "",
      route.origin || "",
      route.destination || "",
      route.aircraftIcao || "",
      route.depTime || ""
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.end();
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const icao = String(req.query.icao || "").trim().toUpperCase();

    if (!icao || icao.length !== 4) {
      return sendJson(res, 400, { error: "Invalid ICAO" });
    }

    if (!AIRLABS_API_KEY) {
      return sendJson(res, 500, { error: "Missing AIRLABS_API_KEY" });
    }

    const routesUrl =
      `https://airlabs.co/api/v9/routes?dep_icao=${encodeURIComponent(icao)}` +
      `&_fields=airline_iata,airline_icao,flight_number,flight_iata,flight_icao,dep_icao,dep_time,arr_icao,arr_time,days,aircraft_icao` +
      `&limit=100&api_key=${AIRLABS_API_KEY}`;

    const routesData = await fetchJson(routesUrl);
    const rawRoutes = Array.isArray(routesData?.response) ? routesData.response : [];

    const airlineIcaos = [...new Set(rawRoutes.map((r) => r.airline_icao).filter(Boolean))];
    const airlineMap = new Map();

    await Promise.all(
      airlineIcaos.map(async (icaoCode) => {
        try {
          const airlineUrl =
            `https://airlabs.co/api/v9/airlines?icao_code=${encodeURIComponent(icaoCode)}` +
            `&_fields=name,iata_code,icao_code,callsign&api_key=${AIRLABS_API_KEY}`;

          const airlineData = await fetchJson(airlineUrl);
          const airline = airlineData?.response?.[0];

          if (airline) {
            airlineMap.set(icaoCode, airline);
          }
        } catch (err) {
          // ignore individual airline lookup failure
        }
      })
    );

    const normalized = rawRoutes.map((route) => {
      const airline = airlineMap.get(route.airline_icao) || {};

      return {
        airlineName: airline.name || route.airline_icao || "Unknown Airline",
        airlineIcao: route.airline_icao || null,
        airlineIata: route.airline_iata || airline.iata_code || null,
        callsign: airline.callsign || null,
        flightNumber: route.flight_number || null,
        flightIcao: route.flight_icao || null,
        flightIata: route.flight_iata || null,
        origin: route.dep_icao || icao,
        destination: route.arr_icao || null,
        aircraftIcao: route.aircraft_icao || null,
        aircraftLabel:
          AIRCRAFT_LABELS[route.aircraft_icao] ||
          route.aircraft_icao ||
          "Unknown aircraft",
        days: normalizeDays(route.days),
        depTime: route.dep_time || null,
        arrTime: route.arr_time || null
      };
    });

    const routes = dedupeRoutes(normalized).sort((a, b) => {
      const airlineCompare = (a.airlineName || "").localeCompare(b.airlineName || "");
      if (airlineCompare !== 0) return airlineCompare;

      const destinationCompare = (a.destination || "").localeCompare(b.destination || "");
      if (destinationCompare !== 0) return destinationCompare;

      return (a.flightIcao || "").localeCompare(b.flightIcao || "");
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=21600");

    return sendJson(res, 200, {
      airport: icao,
      fetchedAt: new Date().toISOString(),
      routes
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: "Failed to fetch route data",
      detail: error.message
    });
  }
}
