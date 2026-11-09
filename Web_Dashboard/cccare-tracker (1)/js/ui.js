/* Shared interface pieces: page frame, the success wheel and the participant block. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { h, svg, fill, clamp, pad2, fmtDate, fmtExertion, plural } = CC.util;

  // A percentage as a colour: 0% red, 50% yellow, 100% green, blending smoothly in between.
  // Every wheel and bar is coloured by the same percentage it shows.
  function percentColor(p) {
    if (p == null) return 'transparent';
    return `hsl(${Math.round(clamp(p, 0, 100) * 1.2)}, 72%, 41%)`;
  }

  // Hollow wheel. Fills clockwise from 12 o'clock.
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
      set(value) {
        const v = clamp(value || 0, 0, 100);
        arc.style.strokeDashoffset = (c * (1 - v / 100)).toFixed(2) + 'px';
        arc.style.stroke = percentColor(v);
      },
    };
  }

  // Small static wheel for tables.
  function miniRing(value) {
    const r = ring(30, 4);
    r.el.classList.add('ring-static');
    r.set(value);
    return r.el;
  }

  // Thin bar filled to a percentage, in that percentage's colour.
  function bar(value) {
    const inner = h('i');
    const el = h('span', { class: 'bar', 'aria-hidden': 'true' }, inner);
    const set = (v) => {
      inner.style.width = clamp(v || 0, 0, 100) + '%';
      inner.style.background = percentColor(v || 0);
    };
    set(value);
    return { el, set };
  }

  // Squares at 0, 25, 50, 75 and 100% for the legend.
  function swatches() {
    return h('span', { class: 'swatches', 'aria-hidden': 'true' },
      [0, 25, 50, 75, 100].map((p) => h('i', { style: `background:${percentColor(p)}` })));
  }

  // A participant block: number, name, success wheel, live numbers, one row per exercise
  // and, along the bottom, what is going wrong. audience 'patient' adds a cue to each issue.
  // update() takes a snapshot from Tracker.snapshot().
  function block(slot, opts) {
    opts = opts || {};
    const large = opts.size === 'large';
    const patient = opts.audience === 'patient';
    const wheel = ring(large ? 260 : 112, large ? 18 : 9);
    const pct = h('span', { class: 'wheel-pct' }, '0%');
    const total = h('span', { class: 'wheel-reps' }, '0 reps');
    const quality = h('dd', null, '—');
    const exertion = h('dd', null, '—');
    const state = h('span', { class: 'block-state' }, 'starting');
    const nameEl = h('h2', { class: 'block-name' }, CC.displayName(slot));
    const exList = h('ol', { class: 'block-ex' });
    const issues = h('div', { class: 'issues' }, h('p', null, 'Waiting for the first rep'));
    if (patient) issues.setAttribute('aria-live', 'polite');

    const el = h('article', { class: 'block' + (large ? ' block-large' : ''), id: 'block-' + slot.id, 'aria-label': CC.displayName(slot) },
      h('div', { class: 'block-head' }, h('span', { class: 'block-n' }, pad2(CC.slotNumber(slot.id))), state),
      nameEl,
      h('div', { class: 'wheel' }, wheel.el, h('div', { class: 'wheel-text' }, pct, total)),
      h('dl', { class: 'block-stats' },
        h('div', null, h('dt', null, 'quality'), quality),
        h('div', null, h('dt', null, 'exertion'), exertion)),
      exList,
      issues);

    let exKey = '';
    let rows = [];
    function renderExercises(list) {
      const key = list.map((e) => `${e.exercise}:${e.sets}x${e.reps}`).join('|');
      if (key !== exKey) {
        exKey = key;
        rows = list.map((e) => {
          const count = h('span', { class: 'ex-count' });
          const b = bar(0);
          const li = h('li', null,
            h('span', { class: 'ex-line' },
              h('span', { class: 'ex-name' }, CC.exerciseName(e.exercise),
                large ? h('span', { class: 'ex-plan' }, ` ${e.sets}×${e.reps}`) : null),
              count),
            b.el);
          li.title = `${CC.exerciseName(e.exercise)}: ${e.sets} ${e.sets === 1 ? 'set' : 'sets'} of ${e.reps}`;
          return { li, count, bar: b };
        });
        exList.replaceChildren(...rows.map((r) => r.li));
      }
      list.forEach((e, i) => {
        rows[i].count.textContent = `${e.done}/${e.planned}`;
        rows[i].bar.set(e.success);
        rows[i].li.classList.toggle('current', !!e.current);
      });
    }

    let lastKey = '';
    function renderIssues(list, status) {
      const key = list.length ? list.map((i) => i.message).join('|') : 'ok:' + status;
      if (key === lastKey) return;
      lastKey = key;
      issues.classList.toggle('alert', list.length > 0);
      if (!list.length) {
        issues.classList.remove('two');
        fill(issues, h('p', null, status));
        return;
      }
      const max = patient ? 3 : 2;
      const shown = list.slice(0, max);
      issues.classList.toggle('two', shown.length > 1);
      fill(issues, ...shown.map((it, i) =>
        h('p', null, it.message,
          !patient && i === shown.length - 1 && list.length > max ? h('span', { class: 'more' }, ` +${list.length - max}`) : null,
          patient && it.cue ? h('span', { class: 'cue' }, it.cue) : null)));
    }

    // Before the session starts: the plan with nothing done yet.
    renderExercises(slot.workout.map((w, i) => ({
      exercise: w.exercise, sets: w.sets, reps: w.reps, done: 0, planned: w.sets * w.reps, success: 0, current: i === 0,
    })));
    total.textContent = `0/${slot.workout.reduce((n, w) => n + w.sets * w.reps, 0)} reps`;

    return {
      el,
      update(snap) {
        wheel.set(snap.success);
        pct.textContent = snap.success + '%';
        total.textContent = `${snap.repsDone}/${snap.repsPlanned} reps`;
        quality.textContent = snap.quality == null ? '—' : snap.quality + '%';
        exertion.textContent = snap.exertion == null ? '—' : fmtExertion(snap.exertion) + '/10';
        state.textContent = snap.head;
        nameEl.textContent = CC.displayName(snap);
        renderExercises(snap.exercises);
        renderIssues(snap.issues, snap.status);
        el.classList.toggle('needs-attention', snap.issues.length > 0);
      },
      message(text) {
        lastKey = 'msg:' + text;
        issues.classList.remove('alert', 'two');
        fill(issues, h('p', null, text));
      },
    };
  }

  // Faults across all exercises of a saved result, most frequent first.
  function faultList(result) {
    const list = [];
    for (const e of result.exercises) {
      for (const [code, count] of Object.entries(e.faults || {})) {
        list.push(Object.assign({ count, exercise: e.exercise, of: CC.score.repsDone(e) }, CC.fault(e.exercise, code)));
      }
    }
    return list.sort((a, b) => b.count - a.count);
  }

  // Everything that went wrong in a saved result: { message, detail, cue }.
  function whatWentWrong(result) {
    const items = [];
    for (const e of result.exercises) {
      const name = CC.exerciseName(e.exercise);
      if (!CC.score.repsDone(e)) {
        items.push({ message: `${name} not started`, detail: `0 of ${e.sets * e.reps} reps`, cue: 'Try to get to every exercise next time.' });
        continue;
      }
      e.done.forEach((d, k) => {
        if (d === 0) {
          items.push({ message: `${name} set ${k + 1} not done`, detail: `0 of ${e.reps} reps`, cue: 'Try to finish every set, resting between them if you need to.' });
        } else if (d < e.reps) {
          items.push({ message: `${name} set ${k + 1} stopped ${plural(e.reps - d, 'rep')} short`, detail: `${d} of ${e.reps} reps`, cue: 'Rest for a moment if you need to, then finish the set.' });
        } else if (d > e.reps) {
          items.push({ message: `${name} set ${k + 1} went ${plural(d - e.reps, 'rep')} over`, detail: `${d} of ${e.reps} reps`, cue: 'Stop when you reach the reps for the set.' });
        }
      });
      if (e.extra) {
        items.push({ message: `${name}: ${plural(e.extra, 'rep')} past the last set`, detail: `${e.sets} ${e.sets === 1 ? 'set' : 'sets'} planned`, cue: 'Stopping when the sets are done protects you from overdoing it.' });
      }
    }
    if (result.exertionPeak != null && result.exertionPeak >= CC.LIMITS.exertionHigh) {
      items.push({ message: `Exertion reached ${fmtExertion(result.exertionPeak)} of 10`, detail: '', cue: 'If it feels very hard, slow down or rest.' });
    }
    for (const f of faultList(result)) {
      items.push({
        message: f.message,
        detail: `${CC.exerciseName(f.exercise).toLowerCase()}, ${f.count} of ${f.of} reps`,
        cue: f.cue,
      });
    }
    return items;
  }

  // Two-step button for things that can't be undone: the first press arms it, a second
  // press within four seconds confirms.
  function confirmButton(btn, armedText, onConfirm) {
    let label = btn.textContent;
    let timer = null;
    let armedAt = 0;
    btn.addEventListener('click', () => {
      if (timer) {
        if (Date.now() - armedAt < 300) return; // ignore an accidental double-click
        clearTimeout(timer);
        timer = null;
        btn.textContent = label;
        btn.classList.remove('btn-armed');
        onConfirm();
        return;
      }
      label = btn.textContent;
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
        if (confirm('Delete every session, name and workout saved in this browser and start again with sample data?')) {
          CC.store.reset();
          location.href = CC.auth.home(account);
        }
      }));
  }

  CC.ui = { percentColor, ring, miniRing, bar, swatches, block, faultList, whatWentWrong, confirmButton, frame };
})();
