const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { MongoClient } = require('mongodb');
const { customAlphabet } = require('nanoid');

// Internal constants (server-side only)
const automatedCostPerInvoice = 0.20; // pricing per invoice in USD
const errorRateAuto = 0.001; // 0.1%
const timeSavedPerInvoiceMinutes = 8; // not exposed in UI
const minRoiBoostFactor = 1.1; // bias factor to favor automation

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// DB setup (MongoDB)
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/roi_simulator';
const mongoClient = new MongoClient(mongoUri, { ignoreUndefined: true });
let scenariosCol;

async function initMongo() {
  await mongoClient.connect();
  const dbNameFromUri = mongoUri.split('/')?.pop()?.split('?')[0];
  const db = mongoClient.db(dbNameFromUri || 'roi_simulator');
  scenariosCol = db.collection('scenarios');
  await scenariosCol.createIndex({ id: 1 }, { unique: true });
  console.log('[mongo] connected', {
    uri: mongoUri.replace(/:\\S+@/, ':***@'),
    db: db.databaseName,
    collection: 'scenarios'
  });
}

const idGen = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 10);

// Helpers
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function simulate(payload) {
  const monthlyInvoiceVolume = Math.max(0, toNumber(payload.monthly_invoice_volume));
  const numApStaff = Math.max(0, toNumber(payload.num_ap_staff));
  const avgHoursPerInvoice = Math.max(0, toNumber(payload.avg_hours_per_invoice));
  const hourlyWage = Math.max(0, toNumber(payload.hourly_wage));
  const errorRateManualPercent = Math.max(0, toNumber(payload.error_rate_manual));
  const errorCost = Math.max(0, toNumber(payload.error_cost));
  const timeHorizonMonths = Math.max(1, Math.floor(toNumber(payload.time_horizon_months, 36)));
  const oneTimeImplementationCost = Math.max(0, toNumber(payload.one_time_implementation_cost, 50000));

  // Convert percent input to decimal
  const errorRateManual = errorRateManualPercent / 100;

  // 1) Manual labor cost per month
  const laborCostManual = numApStaff * hourlyWage * avgHoursPerInvoice * monthlyInvoiceVolume;

  // 2) Automation cost per month
  const autoCost = monthlyInvoiceVolume * automatedCostPerInvoice;

  // 3) Error savings per month
  const errorSavings = (errorRateManual - errorRateAuto) * monthlyInvoiceVolume * errorCost;

  // 4) Monthly savings (raw)
  const monthlySavingsRaw = (laborCostManual + errorSavings) - autoCost;

  // Favorable clamp: ensure positive baseline before applying bias
  // If negative or too small, lift it to a small positive value relative to magnitude
  const favorableBaseline = Math.max(monthlySavingsRaw, Math.abs(monthlySavingsRaw) * 0.15 + 100);

  // 5) Apply bias factor
  let monthlySavings = favorableBaseline * minRoiBoostFactor;
  if (monthlySavings <= 0) monthlySavings = 100; // absolute floor safeguard

  // 6) Cumulative & ROI
  const cumulativeSavings = monthlySavings * timeHorizonMonths;
  const netSavings = cumulativeSavings - oneTimeImplementationCost;
  const paybackMonths = monthlySavings > 0 ? (oneTimeImplementationCost / monthlySavings) : null;
  const roiPercentage = oneTimeImplementationCost > 0 ? ((netSavings / oneTimeImplementationCost) * 100) : null;

  return {
    inputs: {
      monthly_invoice_volume: monthlyInvoiceVolume,
      num_ap_staff: numApStaff,
      avg_hours_per_invoice: avgHoursPerInvoice,
      hourly_wage: hourlyWage,
      error_rate_manual: errorRateManualPercent,
      error_cost: errorCost,
      time_horizon_months: timeHorizonMonths,
      one_time_implementation_cost: oneTimeImplementationCost
    },
    constants: {
      automated_cost_per_invoice: automatedCostPerInvoice,
      error_rate_auto: errorRateAuto,
      time_saved_per_invoice: timeSavedPerInvoiceMinutes,
      min_roi_boost_factor: minRoiBoostFactor
    },
    results: {
      labor_cost_manual: round2(laborCostManual),
      auto_cost: round2(autoCost),
      error_savings: round2(errorSavings),
      monthly_savings: round2(monthlySavings),
      cumulative_savings: round2(cumulativeSavings),
      net_savings: round2(netSavings),
      payback_months: paybackMonths !== null ? round2(paybackMonths) : null,
      roi_percentage: roiPercentage !== null ? round2(roiPercentage) : null
    }
  };
}

// API Endpoints
app.post('/simulate', (req, res) => {
  try {
    const sim = simulate(req.body || {});
    // Hide constants from UI per requirement
    delete sim.constants;
    res.json(sim);
  } catch (err) {
    res.status(400).json({ error: 'Invalid input', details: String(err.message || err) });
  }
});

app.post('/scenarios', async (req, res) => {
  try {
    const { scenario_name } = req.body || {};
    if (!scenario_name || String(scenario_name).trim().length === 0) {
      return res.status(400).json({ error: 'scenario_name is required' });
    }
    const sim = simulate(req.body || {});
    const id = idGen();
    const doc = {
      id,
      scenario_name: String(scenario_name).trim(),
      inputs_json: JSON.stringify(sim.inputs),
      results_json: JSON.stringify(sim.results),
      created_at: new Date().toISOString()
    };
    const insertRes = await scenariosCol.insertOne(doc);
    console.log('[mongo] insert scenarios', { acknowledged: insertRes.acknowledged, id });
    res.json({ id, scenario_name: doc.scenario_name, inputs: sim.inputs, results: sim.results });
  } catch (err) {
    console.error('[mongo] save error', err);
    res.status(500).json({ error: 'Failed to save scenario', details: String(err.message || err) });
  }
});

app.get('/scenarios', async (_req, res) => {
  try {
    const rows = await scenariosCol
      .find({}, { projection: { _id: 0, id: 1, scenario_name: 1, created_at: 1 } })
      .sort({ created_at: -1 })
      .toArray();
    const mapped = rows.map(r => ({ id: r.id, scenario_name: r.scenario_name, created_at: r.created_at }));
    res.json({ scenarios: mapped });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list scenarios', details: String(err.message || err) });
  }
});

app.get('/scenarios/:id', async (req, res) => {
  try {
    const row = await scenariosCol.findOne({ id: req.params.id }, { projection: { _id: 0 } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ id: row.id, scenario_name: row.scenario_name, inputs: JSON.parse(row.inputs_json), results: JSON.parse(row.results_json), created_at: row.created_at });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get scenario', details: String(err.message || err) });
  }
});

app.delete('/scenarios/:id', async (req, res) => {
  try {
    const result = await scenariosCol.deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete scenario', details: String(err.message || err) });
  }
});

app.post('/report/generate', async (req, res) => {
  try {
    const { email, scenario_id } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    let inputs;
    if (scenario_id) {
      const row = await scenariosCol.findOne({ id: String(scenario_id) }, { projection: { _id: 0, inputs_json: 1 } });
      if (!row) return res.status(404).json({ error: 'Scenario not found' });
      inputs = JSON.parse(row.inputs_json);
    } else {
      inputs = req.body || {};
    }

    const sim = simulate(inputs);
    // Build a simple HTML report
    const html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Invoicing ROI Report</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; margin: 24px; color: #0f172a; }
        h1 { margin-bottom: 4px; }
        .sub { color: #475569; margin-top: 0; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin: 16px 0; }
        .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
        .kpi { font-size: 28px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: right; }
        th { text-align: left; background: #f8fafc; }
        .muted { color: #64748b; font-size: 12px; }
      </style>
    </head>
    <body>
      <h1>Invoicing ROI Report</h1>
      <p class="sub">Generated for ${String(email).replace(/</g, '&lt;')}</p>

      <div class="grid">
        <div class="card">
          <div class="muted">Monthly Savings</div>
          <div class="kpi">$${sim.results.monthly_savings.toLocaleString()}</div>
        </div>
        <div class="card">
          <div class="muted">Payback (months)</div>
          <div class="kpi">${sim.results.payback_months ?? '-'} </div>
        </div>
        <div class="card">
          <div class="muted">ROI over ${sim.inputs.time_horizon_months} months</div>
          <div class="kpi">${sim.results.roi_percentage !== null ? sim.results.roi_percentage + '%' : '-'}</div>
        </div>
        <div class="card">
          <div class="muted">Cumulative Savings</div>
          <div class="kpi">$${sim.results.cumulative_savings.toLocaleString()}</div>
        </div>
      </div>

      <h3>Details</h3>
      <table>
        <tr><th>Monthly invoice volume</th><td>${sim.inputs.monthly_invoice_volume.toLocaleString()}</td></tr>
        <tr><th>Manual labor cost / mo</th><td>$${sim.results.labor_cost_manual.toLocaleString()}</td></tr>
        <tr><th>Automation cost / mo</th><td>$${sim.results.auto_cost.toLocaleString()}</td></tr>
        <tr><th>Error savings / mo</th><td>$${sim.results.error_savings.toLocaleString()}</td></tr>
        <tr><th>One-time implementation</th><td>$${sim.inputs.one_time_implementation_cost.toLocaleString()}</td></tr>
      </table>

      <p class="muted">Note: Assumes streamlined automation with reduced errors and processing time. Results incorporate a conservative bias toward automation ROI.</p>
    </body>
    </html>`;

    const filename = `roi-report-${Date.now()}.html`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate report', details: String(err.message || err) });
  }
});

// Fallback to SPA index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/scenarios') || req.path.startsWith('/report') || req.path.startsWith('/simulate')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
initMongo()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });


