# Invoicing ROI Simulator

A lightweight full-stack app to simulate ROI for switching from manual to automated invoicing. Includes live calculator, scenario CRUD (SQLite), and gated HTML report generation.

## Stack
- Backend: Node.js + Express + better-sqlite3
- Frontend: Vanilla JS SPA served from `public/`
- DB: SQLite (stored as `data.db`)

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB running locally or a MongoDB Atlas URI

### Install and Run
```bash
npm install
set MONGODB_URI=mongodb://127.0.0.1:27017/roi_simulator
npm run start
```
Open `http://localhost:3000`.

## Features
- Live simulation via `/simulate` with favorable bias to automation
- Scenario CRUD:
  - `POST /scenarios` save scenario (returns id)
  - `GET /scenarios` list
  - `GET /scenarios/:id` retrieve
  - `DELETE /scenarios/:id` delete
- Report generation:
  - `POST /report/generate` with `email` (and optional `scenario_id` or inline inputs) returns downloadable HTML report

## API: Inputs
- `scenario_name` (string) — label
- `monthly_invoice_volume` (number)
- `num_ap_staff` (number)
- `avg_hours_per_invoice` (number, hours)
- `hourly_wage` (number, USD)
- `error_rate_manual` (number, percent)
- `error_cost` (number, USD)
- `time_horizon_months` (number)
- `one_time_implementation_cost` (number, USD)

## Internal Constants (server-side)
- Automated cost per invoice: $0.20
- Error rate after automation: 0.1%
- Time saved per invoice: 8 minutes
- ROI boost factor: 1.1

These are not exposed in UI responses.

## Notes
- Data persists in `data.db` beside the server.
- To reset, stop the server and delete `data.db`.
- For PDF, you can convert the HTML report in a browser or add a headless converter later.

### MongoDB
- Set `MONGODB_URI` to your connection string. Examples:
  - Windows PowerShell:
    ```powershell
    $env:MONGODB_URI = "mongodb://127.0.0.1:27017/roi_simulator"
    npm start
    ```
  - Windows cmd:
    ```cmd
    set MONGODB_URI=mongodb://127.0.0.1:27017/roi_simulator && npm start
    ```
  - Linux/macOS:
    ```bash
    MONGODB_URI=mongodb://127.0.0.1:27017/roi_simulator npm start
    ```

## Example
Inputs: 2000 invoices/mo, 3 staff, $30/hr, 10 mins/invoice, $100 error cost → produces strong monthly savings, ~6–7 months payback, >400% ROI over 36 months (with bias factor).

## License
MIT
