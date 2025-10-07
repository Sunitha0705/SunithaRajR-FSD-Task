const $ = (id) => document.getElementById(id);
const API_BASE = window.API_BASE || '';

function getInputsFromUI() {
  return {
    scenario_name: $('scenario_name').value.trim(),
    monthly_invoice_volume: Number($('monthly_invoice_volume').value || 0),
    num_ap_staff: Number($('num_ap_staff').value || 0),
    avg_hours_per_invoice: Number($('avg_hours_per_invoice').value || 0),
    hourly_wage: Number($('hourly_wage').value || 0),
    error_rate_manual: Number($('error_rate_manual').value || 0),
    error_cost: Number($('error_cost').value || 0),
    time_horizon_months: Number($('time_horizon_months').value || 36),
    one_time_implementation_cost: Number($('one_time_implementation_cost').value || 0)
  };
}

function formatCurrency(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function setKPIs(sim) {
  if (!sim || !sim.results) return;
  $('kpi_monthly_savings').textContent = formatCurrency(sim.results.monthly_savings);
  $('kpi_payback').textContent = sim.results.payback_months != null ? sim.results.payback_months : '-';
  $('kpi_roi').textContent = sim.results.roi_percentage != null ? sim.results.roi_percentage + '%' : '-';
  $('kpi_cumulative').textContent = formatCurrency(sim.results.cumulative_savings);
  $('detail_labor').textContent = formatCurrency(sim.results.labor_cost_manual);
  $('detail_auto').textContent = formatCurrency(sim.results.auto_cost);
  $('detail_error').textContent = formatCurrency(sim.results.error_savings);
}

let debounceTimer;
async function runSimulate() {
  const payload = getInputsFromUI();
  try {
    const res = await fetch(`${API_BASE}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    setKPIs(data);
  } catch (e) {
    console.error('Simulation failed', e);
  }
}

function debounceSim() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSimulate, 250);
}

async function refreshScenarios() {
  try {
    const res = await fetch(`${API_BASE}/scenarios`);
    const data = await res.json();
    const list = data.scenarios || [];

    const select = $('scenario_select');
    select.innerHTML = '';
    for (const sc of list) {
      const opt = document.createElement('option');
      opt.value = sc.id;
      opt.textContent = `${sc.scenario_name} (${new Date(sc.created_at).toLocaleString()})`;
      select.appendChild(opt);
    }

    const container = $('scenario_list');
    container.innerHTML = '';
    for (const sc of list) {
      const div = document.createElement('div');
      div.className = 'scenario-item';
      div.textContent = `${sc.scenario_name} — ${new Date(sc.created_at).toLocaleString()}`;
      container.appendChild(div);
    }
  } catch (e) {
    console.error('Failed to refresh scenarios', e);
  }
}

async function saveScenario() {
  const payload = getInputsFromUI();
  if (!payload.scenario_name) {
    alert('Please enter a scenario name');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/scenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await refreshScenarios();
    alert('Scenario saved');
  } catch (e) {
    alert('Failed to save scenario');
    console.error(e);
  }
}

async function loadSelectedScenario() {
  const id = $('scenario_select').value;
  if (!id) return;
  try {
    const res = await fetch(`${API_BASE}/scenarios/${id}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    // Populate inputs
    $('scenario_name').value = data.scenario_name || '';
    $('monthly_invoice_volume').value = data.inputs.monthly_invoice_volume;
    $('num_ap_staff').value = data.inputs.num_ap_staff;
    $('avg_hours_per_invoice').value = data.inputs.avg_hours_per_invoice;
    $('hourly_wage').value = data.inputs.hourly_wage;
    $('error_rate_manual').value = data.inputs.error_rate_manual;
    $('error_cost').value = data.inputs.error_cost;
    $('time_horizon_months').value = data.inputs.time_horizon_months;
    $('one_time_implementation_cost').value = data.inputs.one_time_implementation_cost;
    setKPIs({ results: data.results });
  } catch (e) {
    alert('Failed to load scenario');
    console.error(e);
  }
}

async function deleteSelectedScenario() {
  const id = $('scenario_select').value;
  if (!id) return;
  if (!confirm('Delete this scenario?')) return;
  try {
    const res = await fetch(`${API_BASE}/scenarios/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await refreshScenarios();
  } catch (e) {
    alert('Failed to delete scenario');
    console.error(e);
  }
}

async function generateReport() {
  const email = prompt('Enter your email to receive the report:');
  if (!email) return;
  const payload = { ...getInputsFromUI(), email };
  try {
    const res = await fetch(`${API_BASE}/report/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'Failed to generate report');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roi-report-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Failed to generate report');
    console.error(e);
  }
}

function bind() {
  const inputs = [
    'scenario_name', 'monthly_invoice_volume', 'num_ap_staff', 'avg_hours_per_invoice', 'hourly_wage',
    'error_rate_manual', 'error_cost', 'time_horizon_months', 'one_time_implementation_cost'
  ];
  for (const id of inputs) {
    $(id).addEventListener('input', debounceSim);
    $(id).addEventListener('change', debounceSim);
  }
  $('save_btn').addEventListener('click', saveScenario);
  $('report_btn').addEventListener('click', generateReport);
  $('load_btn').addEventListener('click', loadSelectedScenario);
  $('delete_btn').addEventListener('click', deleteSelectedScenario);
}

async function init() {
  bind();
  await refreshScenarios();
  await runSimulate();
}

init();


