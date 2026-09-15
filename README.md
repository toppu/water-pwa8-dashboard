# Water PWA8 Dashboard

ระบบติดตามสถานะแหล่งน้ำ ประปาส่วนภูมิภาค เขต 8 (Real-Time Water Source Monitoring Dashboard for PWA Region 8, Ubon Ratchathani Province)

A client-side web dashboard for monitoring and tracking the status of raw water sources for the Provincial Waterworks Authority (PWA), Region 8. The system displays real-time water levels, capacity, forecasted supply duration, and drought-watch alerts across water source branches.

## Features

- **Overview Cards** — Total water sources, branches under drought watch, critical sources (raw water remaining < 120 days), and flagged/abnormal forecast data.
- **Interactive Map** — Leaflet-based map showing water source locations, color-coded by raw water days remaining or water capacity percentage. Supports small/medium/large/hidden sizing and fullscreen view.
- **Data Table** — Sortable and filterable table with per-column filters (name, branch, capacity %, current volume, forecast, production, demand, days remaining, status), plus pagination.
- **Charts** — Pie/statistical charts (via Chart.js) summarizing water source status, drought-watch branch proportions, and raw water source breakdowns (reservoirs vs. rivers/streams).
- **Search** — Quick search by water source name or service branch.
- **Print & PDF Export** — Print the full dashboard (A4 landscape), print the map only (A3 landscape), or download the dashboard as a PDF.
- **Auto-refresh** — Data automatically updates periodically, sourced via Google Sheets API.

## Tech Stack

- **HTML5 / CSS3** — Semantic markup and responsive styling.
- **JavaScript (vanilla)** — Application logic, data fetching, filtering, and rendering (`script.js`).
- **[Leaflet](https://leafletjs.com/)** — Interactive maps.
- **[Chart.js](https://www.chartjs.org/)** — Data visualization/charts.
- **[html2pdf.js](https://github.com/eKoopmans/html2pdf.js)** — Client-side PDF export.
- **Font Awesome** — Icons.
- **Google Fonts (Sarabun)** — Thai-language typography.
- Data source: **Google Sheets API**.

## Project Structure
