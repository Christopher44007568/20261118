const markup = `
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">IK</div>
        <div>
          <p class="eyebrow">KINEMATICS LAB · 05</p>
          <h1>Two-Bone <span>IK</span></h1>
        </div>
      </div>
      <div class="live-chip">
        <span class="live-dot"></span>
        <span id="solverState">SOLVER ONLINE</span>
      </div>
    </header>

    <aside class="telemetry" aria-label="IK telemetry">
      <div class="telemetry-head">
        <p class="panel-kicker">LIVE TELEMETRY · ANALYTIC</p>
        <span class="state-pill" id="statePill">TRACKING</span>
      </div>
      <div class="error-block">
        <span class="field-label error-label">END EFFECTOR ERROR</span>
        <strong id="errorValue">0.0</strong>
        <small>mm</small>
      </div>
      <div class="target-grid">
        <div class="target-card">
          <span class="field-label">TARGET · WORLD</span>
          <div class="target-value orange" id="targetValue">0.00 / 0.00 / 0.00</div>
        </div>
        <div class="target-card">
          <span class="field-label">REACH · PLANAR</span>
          <div class="target-value" id="reachValue">0.00 / 2.95 m</div>
        </div>
      </div>
      <div class="joints">
        <div class="joints-head">
          <p class="panel-kicker">JOINT ANGLES · LIMITED</p>
          <p class="joint-limit">LIMIT RANGE</p>
        </div>
        <div class="joint">
          <span class="joint-name">Hip flex</span>
          <span class="joint-value" id="hipValue">0.0°</span>
          <span class="joint-track"><span class="joint-fill" id="hipFill"></span></span>
        </div>
        <div class="joint-limit"><span>-55°</span><span>82°</span></div>
        <div class="joint">
          <span class="joint-name">Knee flex</span>
          <span class="joint-value" id="kneeValue">0.0°</span>
          <span class="joint-track"><span class="joint-fill" id="kneeFill"></span></span>
        </div>
        <div class="joint-limit"><span>0°</span><span>145°</span></div>
        <div class="joint">
          <span class="joint-name">Ankle</span>
          <span class="joint-value" id="ankleValue">0.0°</span>
          <span class="joint-track"><span class="joint-fill" id="ankleFill"></span></span>
        </div>
        <div class="joint-limit"><span>58°</span><span>124°</span></div>
      </div>
      <div class="integrity-strip">
        <div class="integrity-card">
          <span class="field-label">BONE LOCK</span>
          <div class="integrity-value" id="lengthValue">0.000 mm</div>
        </div>
        <div class="integrity-card">
          <span class="field-label">KNEE POLE</span>
          <div class="integrity-value ok" id="poleValue">+Z</div>
        </div>
        <div class="integrity-card">
          <span class="field-label">DAMPING</span>
          <div class="integrity-value ok" id="dampingValue">0.00</div>
        </div>
      </div>
    </aside>

    <section class="mode-panel" aria-label="Validation actions">
      <div class="panel-topline">
        <p class="panel-kicker">VALIDATION ACTIONS · TWO CASES</p>
        <span class="pipeline-state" id="pipelineState">IDLE</span>
      </div>
      <div class="mode-selector" role="tablist" aria-label="Animation mode">
        <button class="mode-button active" data-mode="ground" role="tab" aria-selected="true">
          <span class="mode-index">01</span>
          <strong>Ground Walk</strong>
          <span>TREADMILL GAIT · CONTACT</span>
        </button>
        <button class="mode-button" data-mode="air" role="tab" aria-selected="false">
          <span class="mode-index">02</span>
          <strong>Air Extension</strong>
          <span>FREE LEG · OVERREACH</span>
        </button>
      </div>
      <div class="validation-grid">
        <div class="validation-card" id="validation-ground">
          <div class="validation-title">
            <span>GROUND WALK</span>
            <span class="validation-status">PENDING</span>
          </div>
          <div class="validation-check" data-check="tracking">
            <span class="check-icon">✓</span> target tracking
          </div>
          <div class="validation-check" data-check="length">
            <span class="check-icon">✓</span> fixed bone length
          </div>
          <div class="validation-check" data-check="pole">
            <span class="check-icon">✓</span> knee pole +Z
          </div>
        </div>
        <div class="validation-card" id="validation-air">
          <div class="validation-title">
            <span>AIR EXTENSION</span>
            <span class="validation-status">PENDING</span>
          </div>
          <div class="validation-check" data-check="overreach">
            <span class="check-icon">✓</span> overreach straight
          </div>
          <div class="validation-check" data-check="jitter">
            <span class="check-icon">✓</span> no boundary jitter
          </div>
          <div class="validation-check" data-check="damping">
            <span class="check-icon">✓</span> adaptive damping
          </div>
        </div>
      </div>
      <div class="toolbar">
        <label class="toggle">
          <input id="dampingToggle" type="checkbox" checked />
          <span class="toggle-track"></span>
          <span>ADAPTIVE DAMPING</span>
        </label>
        <div class="toolbar-actions">
          <button class="icon-button" id="resetButton" title="Reset scene">↺</button>
          <button class="icon-button" id="pauseButton" title="Pause (Space)">Ⅱ</button>
          <button class="primary-button" id="runValidation">RUN VALIDATION</button>
        </div>
      </div>
    </section>

    <div class="hint">DRAG TO ORBIT · SCROLL TO ZOOM · 1 / 2 SWITCH ACTION</div>
    <div class="legend">
      <span class="legend-item"><span class="legend-dot orange"></span>TARGET</span>
      <span class="legend-item"><span class="legend-dot outline"></span>DAMPED TARGET</span>
      <span class="legend-item"><span class="legend-dot"></span>KNEE POLE</span>
    </div>
    <div class="toast" id="toast"></div>
  </div>
`;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function createUI({ onMode, onPause, onReset, onDamping, onValidate }) {
  document.getElementById('app').innerHTML = markup;

  const refs = {
    statePill: document.getElementById('statePill'),
    solverState: document.getElementById('solverState'),
    errorValue: document.getElementById('errorValue'),
    targetValue: document.getElementById('targetValue'),
    reachValue: document.getElementById('reachValue'),
    hipValue: document.getElementById('hipValue'),
    kneeValue: document.getElementById('kneeValue'),
    ankleValue: document.getElementById('ankleValue'),
    hipFill: document.getElementById('hipFill'),
    kneeFill: document.getElementById('kneeFill'),
    ankleFill: document.getElementById('ankleFill'),
    lengthValue: document.getElementById('lengthValue'),
    poleValue: document.getElementById('poleValue'),
    dampingValue: document.getElementById('dampingValue'),
    persistence: document.getElementById('pipelineState'),
    toast: document.getElementById('toast'),
    pauseButton: document.getElementById('pauseButton'),
    dampingToggle: document.getElementById('dampingToggle'),
    runValidation: document.getElementById('runValidation'),
    modeButtons: [...document.querySelectorAll('.mode-button')],
    validationGround: document.getElementById('validation-ground'),
    validationAir: document.getElementById('validation-air'),
  };

  refs.modeButtons.forEach((button) => {
    button.addEventListener('click', () => onMode(button.dataset.mode));
  });
  document.getElementById('resetButton').addEventListener('click', onReset);
  refs.pauseButton.addEventListener('click', onPause);
  refs.dampingToggle.addEventListener('change', onDamping);
  refs.runValidation.addEventListener('click', onValidate);

  let toastTimer;
  const ui = {
    refs,
    setMode(mode) {
      refs.modeButtons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
    },
    setPaused(paused) {
      refs.pauseButton.textContent = paused ? '▶' : 'Ⅱ';
      refs.solverState.textContent = paused ? 'SOLVER PAUSED' : 'SOLVER ONLINE';
    },
    setPipeline(text, running = false) {
      refs.persistence.textContent = text;
      refs.runValidation.classList.toggle('running', running);
      refs.runValidation.textContent = running ? 'VALIDATING…' : 'RUN VALIDATION';
    },
    toast(message) {
      refs.toast.textContent = message;
      refs.toast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        refs.toast.classList.remove('visible');
      }, 2200);
    },
    updateTelemetry(state) {
      const errorMm = state.error * 1000;
      refs.errorValue.textContent = errorMm.toFixed(errorMm >= 100 ? 0 : 1);
      refs.targetValue.textContent = `${state.target.x.toFixed(2)} / ${state.target.y.toFixed(2)} / ${state.target.z.toFixed(2)}`;
      refs.reachValue.textContent = `${state.distance.toFixed(2)} / ${state.maxReach.toFixed(2)} m`;

      refs.hipValue.textContent = `${state.hipDeg.toFixed(1)}°`;
      refs.kneeValue.textContent = `${state.kneeDeg.toFixed(1)}°`;
      refs.ankleValue.textContent = `${state.ankleDeg.toFixed(1)}°`;
      refs.hipFill.style.width = `${clamp01((state.hipDeg + 55) / 137) * 100}%`;
      refs.kneeFill.style.width = `${clamp01(state.kneeDeg / 145) * 100}%`;
      refs.ankleFill.style.width = `${clamp01((state.ankleDeg - 58) / 66) * 100}%`;

      refs.lengthValue.textContent = `${(state.maxLengthError * 1000).toFixed(3)} mm`;
      refs.lengthValue.classList.toggle('ok', state.maxLengthError < 1e-6);
      refs.poleValue.textContent = state.poleStable ? '+Z OK' : 'DRIFT';
      refs.poleValue.classList.toggle('ok', state.poleStable);
      refs.dampingValue.textContent = state.damping.toFixed(2);
      refs.dampingValue.classList.toggle('ok', state.damping < 0.05);

      let status = 'TRACKING';
      let limited = false;
      if (state.outOfReach) {
        status = 'OVERREACH · STRAIGHT';
        limited = true;
      } else if (state.jointClamped) {
        status = 'JOINT LIMIT';
        limited = true;
      } else if (state.damping > 0.08) {
        status = 'DAMPED';
      }
      refs.statePill.textContent = status;
      refs.statePill.classList.toggle('limit', limited);
    },
    updateValidation(records) {
      for (const [mode, record] of Object.entries(records)) {
        const card =
          mode === 'ground' ? refs.validationGround : refs.validationAir;
        card.classList.toggle('pass', record.pass);
        card.querySelector('.validation-status').textContent = record.pass
          ? 'PASS'
          : record.frames > 0
            ? 'CHECKING'
            : 'PENDING';
        card.querySelectorAll('.validation-check').forEach((check) => {
          const name = check.dataset.check;
          check.querySelector('.check-icon').style.color =
            record.checks[name] ? 'var(--mint)' : 'transparent';
        });
      }
    },
  };

  return ui;
}
