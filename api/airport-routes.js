export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const icao = (req.query.icao || "UNKNOWN").toUpperCase();

  res.status(200).json({
    airport: icao,
    message: "API is working 🎉",
    routes: [
      {
        airlineName: "Emirates",
        callsign: "UAE",
        flightNumber: "UAE1",
        origin: icao,
        destination: "OMDB",
        aircraftLabel: "Airbus A350-900"
      }
    ]
  });
}