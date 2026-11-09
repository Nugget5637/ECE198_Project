/* Shared interface pieces: page frame, the success wheel and the participant block. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { h, svg, clamp, pad2, fmtDate, fmtExertion, plural } = CC.util;

  // Movement quality -> one solid colour: red, orange, amber, yellow-green, green.
  // 50% or lower is fully red, 95% or higher fully green, and colours in between are
  // blended from the two nearest stops.
  const STOPS = [
    [198, 40, 40], // red
    [232, 113, 26], // orange
    [222, 168, 0], // amber
    [128, 172, 28], // yellow-green
    [35, 160, 69], // green
  ];
  const QUALITY_LOW = 50;
  const QUALITY_HIGH = 95;
  function qualityColor(q) {
    if (q == null) return 'transparent';
    const t = clamp((q - QUALITY_LOW) / (QUALITY_HIGH - QUALITY_LOW), 0, 1) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(t));
    const f = t - i;
    const [a, b] = [STOPS[i], STOPS[i + 1]];
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(', ')})`;
  }

  // Hollow wheel. Fills clockwise from 12 o'clock with success; its colour shows quality.
  function ring(size, stroke) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;
    const arc = svg('circle', {
      class: 'ring-arc', cx: mid, cy: mid, r, fill: 'none', 'stroke-width': stroke,
      'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': c.toFixed(2), transform: `rotate(-90 ${mid} ${mid})`,
    });
    const el = svg('svg', { class: 'ring', viewBox: `0 0 ${size} ${size}`, width: size, height: size, 'aria-hidden': 'true' },
      svg('circle', { class: 'ring-track', cx: mid, cy: mid, r, fill: 'none', 'stroke-width': stroke }),
      arc);
    return {
      el,
      set(value, quality) {
        const v = clamp(value || 0, 0, 100);
        arc.style.strokeDashoffset = (c * (1 - v / 100)).toFixed(2) + 'px';
        arc.style.stroke = qualityColor(quality);
      },
    };
  }

  // Small static wheel for tables.
  function miniRing(value, quality) {
    const r = ring(30, 4);
    r.el.classList.add('ring-static');
    r.set(value, quality);
    return r.el;
  }

  // The five colour stops as squares, for the legend.
  function swatches() {
    const step = (QUALITY_HIGH - QUALITY_LOW) / (STOPS.length - 1);
    return h('span', { class: 'swatches', 'aria-hidden': 'true' },
      STOPS.map((_, i) => h('i', { style: `background:${qualityColor(QUALITY_LOW + i * step)}` })));
  }

  function statusText(t) {
    if (t.reps === 0) return 'Waiting for the first rep';
    if (t.reps >= t.dose) return 'Dose complete';
    return 'Form looks good';
  }

  // A participant block: number, name, success wheel, live numbers and, along the bottom,
  // what is going wrong. audience 'patient' adds a cue to each issue and shows more lines.
  function block(slot, opts) {
    opts = opts || {};
    const large = opts.size === 'large';
    const patient = opts.audience === 'patient';
    const wheel = ring(large ? 260 : 112, large ? 18 : 9);
    const pct = h('span', { class: 'wheel-pct' }, '0%');
    const reps = h('span', { class: 'wheel-reps' }, `0/${slot.dose} reps`);
    const quality = h('dd', null, '—');
    const exertion = h('dd', null, '—');
    const issues = h('div', { class: 'issues' }, h('p', null, 'Waiting for the first rep'));
    if (patient) issues.setAttribute('aria-live', 'polite');
    const name = CC.displayName(slot);

    const el = h('article', { class: 'block' + (large ? ' block-large' : ''), id: 'block-' + slot.id, 'aria-label': name },
      h('div', { class: 'block-head' },
        h('span', { class: 'block-n' }, pad2(CC.slotNumber(slot.id))),
        h('span', null, `${CC.exerciseName(slot.exercise).toLowerCase()} · dose ${slot.dose}`)),
      h('h2', { class: 'block-name' }, name),
      h('div', { class: 'wheel' }, wheel.el, h('div', { class: 'wheel-text' }, pct, reps)),
      h('dl', { class: 'block-stats' },
        h('div', null, h('dt', null, 'quality'), quality),
        h('div', null, h('dt', null, 'exertion'), exertion)),
      issues);

    let lastKey = '';
    function renderIssues(list, t) {
      const key = list.length ? list.map((i) => i.part + i.issue).join('|') : 'ok:' + statusText(t);
      if (key === lastKey) return;
      lastKey = key;
      issues.classList.toggle('alert', list.length > 0);
      if (!list.length) {
        issues.classList.remove('two');
        issues.replaceChildren(h('p', null, statusText(t)));
        return;
      }
      const max = patient ? 3 : 2;
      const shown = list.slice(0, max);
      issues.classList.toggle('two', shown.length > 1);
      issues.replaceChildren(...shown.map((it, i) =>
        h('p', null,
          it.part ? h('b', null, it.part) : null, it.part ? ' ' : null, it.issue,
          !patient && i === shown.length - 1 && list.length > max ? h('span', { class: 'more' }, ` +${list.length - max}`) : null,
          patient && it.cue ? h('span', { class: 'cue' }, it.cue) : null)));
    }

    return {
      el,
      // Redraws from a Tracker. Returns the current issues so the page can list who needs attention.
      update(t, now) {
        const recent = t.recentQuality();
        const s = t.success();
        wheel.set(s, recent);
        pct.textContent = s + '%';
        reps.textContent = `${t.reps}/${t.dose} reps`;
        quality.textContent = recent == null ? '—' : recent + '%';
        exertion.textContent = t.exertion == null ? '—' : fmtExertion(t.exertion) + '/10';
        const list = t.issues(now);
        renderIssues(list, t);
        el.classList.toggle('needs-attention', list.length > 0);
        return list;
      },
      message(text) {
        lastKey = 'msg:' + text;
        issues.classList.remove('alert', 'two');
        issues.replaceChildren(h('p', null, text));
      },
    };
  }

  // Faults in a saved result, most frequent first.
  function faultList(result) {
    return Object.entries(result.faults || {})
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => Object.assign({ count }, CC.fault(result.exercise, code)));
  }

  // One line about the dose, or null when it was done exactly.
  function doseNote(result) {
    if (!result.reps) return `no reps recorded (dose ${result.dose})`;
    const d = result.reps - result.dose;
    if (d < 0) return `${plural(-d, 'rep')} short (${result.reps} of ${result.dose})`;
    if (d > 0) return `${plural(d, 'rep')} over (${result.reps} of ${result.dose})`;
    return null;
  }

  // Two-step button for things that can't be undone: the first press arms it, a second
  // press within four seconds confirms.
  function confirmButton(btn, armedText, onConfirm) {
    const label = btn.textContent;
    let timer = null;
    let armedAt = 0;
    btn.addEventListener('click', () => {
      if (timer) {
        if (Date.now() - armedAt < 300) return; // ignore an accidental double-click
        clearTimeout(timer);
        timer = null;
        onConfirm();
        return;
      }
      armedAt = Date.now();
      btn.textContent = armedText;
      btn.classList.add('btn-armed');
      timer = setTimeout(() => {
        timer = null;
        btn.textContent = label;
        btn.classList.remove('btn-armed');
      }, 4000);
    });
  }

  // Fills in the parts of the page header and footer that depend on who is signed in.
  function frame(account) {
    document.querySelectorAll('[data-who]').forEach((el) => (el.textContent = `${account.role} · ${account.username}`));
    document.querySelectorAll('[data-today]').forEach((el) => (el.textContent = fmtDate(new Date())));
    document.querySelectorAll('[data-signout]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        CC.auth.signOut();
      }));
    document.querySelectorAll('[data-reset]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Delete every session and name saved in this browser and start again with sample data?')) {
          CC.store.reset();
          location.href = CC.auth.home(account);
        }
      }));
  }

  CC.ui = { qualityColor, ring, miniRing, swatches, block, faultList, doseNote, confirmButton, frame };
})();
