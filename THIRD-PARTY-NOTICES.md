# Third-party notices

| Component | Version / source | License | Use / modifications |
| --- | --- | --- | --- |
| [12306-mcp](https://github.com/Joooook/12306-mcp) | 0.3.10 | MIT | MCP ticket queries and interline hub discovery; package code unmodified |
| [chinese-railway-gtfs](https://github.com/wensimehrp/chinese-railway-gtfs) by wensimehrp and contributors | gtfs-20261024-052143 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Converted stops, service dates and times into a local JSON index; added city association and stop call counts. No fares or inventory supplied by this dataset. See data/rail-index.json metadata and licenses/rail-GTFS-CC-BY-4.0.txt |
| [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) | Coordinates distributed in upstream GTFS | ODbL 1.0 | WGS84 station coordinates; used to rank candidate hubs. Attribution retained; no endorsement implied |
| [airportsdata](https://github.com/mborsetti/airportsdata) by Marco Borsetti and contributors | CSV SHA-256 in data/airports.json | MIT | Selected CN airports with IATA codes; mapped names to project cities with explicit served-city overrides. English source city/name retained. See licenses/airportsdata-MIT.txt |
| [p-queue](https://github.com/sindresorhus/p-queue) | 10.0.0 | MIT | Search pacing and per-session serialization |
| [Comlink](https://github.com/GoogleChromeLabs/comlink) | 4.4.2 | Apache-2.0 | Unmodified ESM served locally for Web Worker RPC; see licenses/comlink-Apache-2.0.txt |
| [MSW](https://github.com/mswjs/msw) | 3.0.3 | MIT | Development tests only; mock HTTP responses, no browser production worker |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.3 | MIT | Offline GTFS ZIP extraction |
| [csv-parse](https://github.com/adaltas/node-csv) | 7.0.3 | MIT | Offline CSV import |

Package license texts remain in node_modules after installation; redistributors must retain applicable notices. Additional existing dependencies are listed in package.json/package-lock.json and keep their own licenses. This notice does not grant commercial access to upstream ticketing services.
