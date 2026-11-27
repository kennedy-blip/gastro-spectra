<script>
  import { onMount } from 'svelte';
  import {
    fib4, nafldFibrosisScore, meld30, deRitis, rFactor, ROME_IV, CPT_CATALOG, auditBill
  } from '$lib/engines/hepatologyEndoscopyAuditorEngine.js';
  import { callPython } from '$lib/engines/pythonBridge.js';
  import { vaultPut } from '$lib/db/indexedDbGastroVault.js';
  import { rbac } from '$lib/gastroStore.js';

  let labs = { age: 54, ast: 38, alt: 44, platelets: 210, albumin: 4.1, bilirubin: 1.1, sodium: 137, inr: 1.05, creatinine: 0.9, bmi: 29, diabetes: false, female: false, dialysis: false, alp: 92, ulnAlt: 40, ulnAlp: 120 };
  let fib = fib4(labs);
  let nafld = nafldFibrosisScore({ ...labs, ast: labs.ast, alt: labs.alt });
  let meld = meld30(labs);
  let dr = deRitis(labs.ast, labs.alt);
  let rf = rFactor({ alt: labs.alt, ulnAlt: labs.ulnAlt, alp: labs.alp, ulnAlp: labs.ulnAlp });
  let engine = 'ES2024 local';
  let romeActive = ROME_IV[1];
  let symptom = { painDays: 1, loosePct: 30, hardPct: 20, straining: false, bloating: true };
  let bill = { procedureCode: CPT_CATALOG[0].code, billed: 6850, setting: 'HOPD', modifier33: false, modifierPT: false, preventive: true, oonAnesthesia: true, oonPathology: false };
  let audit = auditBill(bill);
  let saved = '';
  let feeOverrides = null;

  function recompute() {
    fib = fib4(labs);
    nafld = nafldFibrosisScore(labs);
    meld = meld30(labs);
    dr = deRitis(labs.ast, labs.alt);
    rf = rFactor({ alt: labs.alt, ulnAlt: labs.ulnAlt, alp: labs.alp, ulnAlp: labs.ulnAlp });
    audit = auditBill(bill);
  }

  onMount(recompute);

  async function runPython() {
    const py = await callPython('hepatology', {
      age: labs.age, ast: labs.ast, alt: labs.alt, platelets: labs.platelets,
      female: labs.female, bilirubin: labs.bilirubin, sodium: labs.sodium,
      inr: labs.inr, creatinine: labs.creatinine, albumin: labs.albumin,
      dialysis: labs.dialysis, ulnAlt: labs.ulnAlt, alp: labs.alp, ulnAlp: labs.ulnAlp
    });
    if (!py.fallback && py.data?.fib4) {
      fib = { value: py.data.fib4.fib4, stratum: py.data.fib4.stratum, severity: py.data.fib4.fib4 < 1.3 ? 'ok' : py.data.fib4.fib4 <= 2.67 ? 'warn' : 'bad' };
      meld = { value: py.data.meld.meld_3_0, raw: py.data.meld.raw };
      dr = { ratio: py.data.de_ritis.ast_alt_ratio, note: py.data.de_ritis.note };
      rf = { r: py.data.r_factor.r_factor, pattern: py.data.r_factor.pattern, severity: py.data.r_factor.r_factor < 2 ? 'warn' : 'ok' };
      engine = `Python 3.12 · ${py.latencyMs.toFixed(1)} ms`;
    } else {
      engine = `ES2024 mirror · ${py.latencyMs.toFixed(1)} ms`;
    }
  }

  async function save() {
    try {
      await vaultPut('optical_pigment_prep_audits', {
        kind: 'hepatology_quote', labs, fib4: fib.value, meld: meld.value,
        audit: audit.issues.map((i) => i.text), billed: bill.billed, corrected: audit.corrected
      });
      saved = `Hepatology + quote audit saved ${new Date().toLocaleTimeString()}`;
    } catch (e) { saved = `Vault error: ${e.message}`; }
  }

  $: labs, bill, recompute();

  const rome = (() => {
    const ibs = symptom.painDays >= 1 && (symptom.loosePct > 25 || symptom.hardPct > 25);
    const subtype = symptom.hardPct > 25 && symptom.loosePct > 25 ? 'IBS-M' : symptom.loosePct > 25 ? 'IBS-D' : 'IBS-C';
    return { ibs, subtype };
  })();
</script>

<section>
  <div class="grid-2" style="align-items:start;">
    <div class="glass-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div class="kpi-label">Module 5 · Hepatobiliary & Endoscopy Economics</div>
          <h2 style="margin:4px 0 0; font-size:20px;">FIB-4 · MELD 3.0 · CPT Quote Auditor</h2>
        </div>
        <span class="pill ok"><span class="dot"></span>{engine}</span>
      </div>

      <div class="grid-3" style="margin-top:12px; gap:8px;">
        {#each [['age', 'Age (y)'], ['ast', 'AST (U/L)'], ['alt', 'ALT (U/L)'], ['platelets', 'Platelets (10⁹/L)'], ['albumin', 'Albumin (g/dL)'], ['bilirubin', 'Bilirubin (mg/dL)'], ['sodium', 'Sodium (mEq/L)'], ['inr', 'INR'], ['creatinine', 'Creatinine (mg/dL)'], ['bmi', 'BMI'], ['alp', 'ALP (U/L)'], ['ulnAlt', 'ULN ALT']] as f}
          <div>
            <label for={f[0]}>{f[1]}</label>
            <input id={f[0]} type="number" step="0.01" bind:value={labs[f[0]]} />
          </div>
        {/each}
      </div>
      <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:10px;">
        <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={labs.female} /> Female (MELD 3.0 +1.33)</label>
        <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={labs.diabetes} /> Diabetes</label>
        <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={labs.dialysis} /> Dialysis (Cr fixed 4.0)</label>
      </div>

      <div class="grid-4" style="margin-top:14px;">
        <div>
          <div class="kpi-label">FIB-4</div>
          <div class="kpi" style="color:{fib.severity === 'bad' ? 'var(--danger)' : fib.severity === 'warn' ? 'var(--amber)' : 'var(--accent)'};">{fib.value.toFixed(2)}</div>
        </div>
        <div>
          <div class="kpi-label">MELD 3.0</div>
          <div class="kpi" style="color:var(--accent-2);">{meld.value}</div>
        </div>
        <div>
          <div class="kpi-label">AST/ALT</div>
          <div class="kpi">{dr.ratio.toFixed(2)}</div>
        </div>
        <div>
          <div class="kpi-label">R-factor</div>
          <div class="kpi" style="color:var(--amber);">{rf.r.toFixed(1)}</div>
        </div>
      </div>

      <div class="alert-box {fib.severity === 'bad' ? 'bad' : fib.severity === 'warn' ? 'warn' : 'ok'}" style="margin-top:10px;">
        <strong>FIB-4:</strong> {fib.stratum}
        <div class="small" style="margin-top:4px;">NAFLD Fibrosis Score {nafld.value.toFixed(2)} → {nafld.stratum}</div>
        <div class="small" style="margin-top:4px;">{dr.note} · R-factor pattern: <strong>{rf.pattern}</strong> (R &gt; 5 hepatocellular, 2–5 mixed, &lt; 2 cholestatic)</div>
      </div>

      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn" on:click={runPython}>Verify with Python 3.12</button>
        <button class="btn ghost" on:click={() => { labs = { age: 58, ast: 62, alt: 48, platelets: 96, albumin: 3.0, bilirubin: 2.4, sodium: 131, inr: 1.7, creatinine: 1.5, bmi: 33, diabetes: true, female: true, dialysis: false, alp: 148, ulnAlt: 40, ulnAlp: 120 }; }}>Load MASLD cirrhosis case</button>
      </div>
    </div>

    <div>
      <div class="glass-card">
        <div class="kpi-label">Rome IV diagnostic matrix</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
          {#each ROME_IV as r}
            <button class="btn ghost" class:active={romeActive.disorder === r.disorder} on:click={() => (romeActive = r)}>{r.disorder}</button>
          {/each}
        </div>
        <div class="small muted" style="margin-top:8px;">{romeActive.criteria}</div>
        <div class="grid-2" style="margin-top:10px; gap:8px;">
          <div><div class="lbl">Pain days / week</div><input type="number" min="0" max="7" bind:value={symptom.painDays} /></div>
          <div><div class="lbl">Loose stool %</div><input type="number" min="0" max="100" bind:value={symptom.loosePct} /></div>
          <div><div class="lbl">Hard stool %</div><input type="number" min="0" max="100" bind:value={symptom.hardPct} /></div>
          <div style="display:flex; align-items:flex-end;">
            <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={symptom.straining} /> Straining</label>
          </div>
        </div>
        <div class="alert-box {rome.ibs ? 'warn' : 'ok'}" style="margin-top:10px;">
          <strong>{rome.ibs ? `Rome IV IBS criteria met — ${rome.subtype} pattern` : 'Rome IV IBS criteria not met'}</strong>
          <div class="small" style="margin-top:4px;">Recurrent pain ≥1 day/week with ≥25% loose or hard stools over the last 3 months.</div>
        </div>
      </div>

      <div class="glass-card" style="margin-top:14px;">
        <div class="kpi-label">GI endoscopy CPT quote auditor</div>
        <div class="grid-2" style="margin-top:8px; gap:8px;">
          <div>
            <div class="lbl">Procedure</div>
            <select bind:value={bill.procedureCode}>
              {#each CPT_CATALOG as c}<option value={c.code}>{c.code} — {c.name}</option>{/each}
            </select>
          </div>
          <div><div class="lbl">Billed amount ($)</div><input type="number" bind:value={bill.billed} /></div>
          <div>
            <div class="lbl">Setting</div>
            <select bind:value={bill.setting}><option>HOPD</option><option>ASC</option></select>
          </div>
          <div style="display:grid; gap:4px; align-content:end;">
            <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={bill.preventive} /> Preventive screening</label>
            <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={bill.modifier33} /> Modifier 33</label>
            <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={bill.modifierPT} /> Modifier PT</label>
          </div>
        </div>
        <div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:8px;">
          <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={bill.oonAnesthesia} /> OON anesthesia</label>
          <label style="display:flex; gap:6px; align-items:center;"><input type="checkbox" bind:checked={bill.oonPathology} /> OON pathology</label>
        </div>

        <div class="grid-3" style="margin-top:10px;">
          <div><div class="kpi-label">Billed</div><div class="kpi" style="font-size:20px;">${Number(bill.billed).toLocaleString()}</div></div>
          <div><div class="kpi-label">Corrected liability</div><div class="kpi" style="font-size:20px; color:{audit.corrected === 0 ? 'var(--accent)' : 'var(--amber)'};">${audit.corrected.toLocaleString()}</div></div>
          <div><div class="kpi-label">ASC vs HOPD</div><div class="kpi" style="font-size:20px; color:var(--accent-2);">${audit.savings.toLocaleString()}</div></div>
        </div>

        <div style="margin-top:10px; display:grid; gap:8px;">
          {#each audit.issues as issue}
            <div class="alert-box {issue.type}">{issue.text}</div>
          {/each}
        </div>

        {#if $rbac !== 'patient'}
          <div class="grid-2" style="margin-top:10px; gap:8px;">
            <div><div class="lbl">ASC facility fee override ($)</div><input type="number" placeholder={String(audit.catalog.asc)} on:input={(e) => { feeOverrides = { asc: Number(e.currentTarget.value) }; }} /></div>
            <div class="small muted" style="align-self:end;">Commercial/Medicare regional override (Pro tier).</div>
          </div>
        {/if}

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn primary" on:click={save}>Save audit</button>
        </div>
        {#if saved}<div class="small muted" style="margin-top:8px;">{saved}</div>{/if}
      </div>
    </div>
  </div>
</section>
