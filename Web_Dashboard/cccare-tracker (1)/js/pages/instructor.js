/* Instructor: set up the class and each person's workout, watch everyone live, end the session. */
(function () {
  'use strict';
  const account = CC.auth.require('instructor');
  if (!account) return;

  const { h, fill, pad2, toInt, fmtDate, fmtTime, fmtClock, mean, firstName, deepCopy } = CC.util;
  CC.ui.frame(account);

  const MAX = CC.MAX_PARTICIPANTS;
  const LIM = CC.WORKOUT_LIMITS;
  const roster = CC.roster.all();
  const setupEl = document.getElementById('setup');
  const liveEl = document.getElementById('live');
  const tbody = document.getElementById('roster');
  const countInput = document.getElementById('count');
  let count = toInt(CC.store.lastCount(), 1, MAX, 12);

  // ---------- set-up ----------

  const exerciseOptions = (selected) =>
    Object.entries(CC.EXERCISES).map(([code, ex]) => h('option', { value: code, selected: code === selected }, ex.name));

  // The first exercise not already in the workout.
  function nextExercise(workout) {
    const used = new Set(workout.map((w) => w.exercise));
    const code = Object.keys(CC.EXERCISES).find((c) => !used.has(c)) || Object.keys(CC.EXERCISES)[0];
    return { exercise: code, sets: 2, reps: 10 };
  }

  function numberInput(value, max, label, onChange) {
    const input = h('input', { type: 'number', min: 1, max, value, inputmode: 'numeric', 'aria-label': label });
    input.addEventListener('change', () => {
      const v = toInt(input.value, 1, max, value);
      input.value = v;
      value = v;
      onChange(v);
    });
    return input;
  }

  // One participant: a row with the name and workout, and a hidden row below it with the
  // workout editor.
  function rowFor(slot) {
    const n = CC.slotNumber(slot.id);
    const summary = h('span', { class: 'wk-summary' });
    const refresh = () => (summary.textContent = CC.describeWorkout(slot.workout));
    const nameInput = h('input', {
      type: 'text', name: 'name', value: slot.name, placeholder: CC.defaultName(slot.id),
      maxlength: 40, autocomplete: 'off', 'aria-label': `Name, participant ${n}`,
    });
    nameInput.addEventListener('input', () => (slot.name = nameInput.value.trim().slice(0, 40)));
    const editBtn = h('button', { type: 'button', class: 'link-btn', 'aria-expanded': 'false' }, 'Edit');
    const editor = h('div', { class: 'wk', id: 'wk-' + slot.id });
    editBtn.setAttribute('aria-controls', editor.id);
    const row = h('tr', null,
      h('td', null, pad2(n)),
      h('td', null, nameInput),
      h('td', null, summary),
      h('td', null, editBtn));
    const editorRow = h('tr', { class: 'wk-row', hidden: true }, h('td'), h('td', { colspan: 3 }, editor));

    function renderEditor() {
      const lines = slot.workout.map((w, i) => {
        const label = `exercise ${i + 1}, participant ${n}`;
        const select = h('select', { 'aria-label': `Exercise, ${label}` }, exerciseOptions(w.exercise));
        select.addEventListener('change', () => {
          w.exercise = select.value;
          refresh();
        });
        const sets = numberInput(w.sets, LIM.sets, `Sets, ${label}`, (v) => {
          w.sets = v;
          refresh();
        });
        const reps = numberInput(w.reps, LIM.reps, `Reps per set, ${label}`, (v) => {
          w.reps = v;
          refresh();
        });
        const remove = h('button', {
          type: 'button', class: 'link-btn', disabled: slot.workout.length === 1, 'aria-label': `Remove ${label}`,
        }, 'Remove');
        remove.addEventListener('click', () => {
          slot.workout.splice(i, 1);
          refresh();
          renderEditor();
        });
        return h('div', { class: 'wk-line' }, h('div', { class: 'select' }, select), sets, reps, remove);
      });

      const add = h('button', { type: 'button', class: 'btn btn-light', disabled: slot.workout.length >= LIM.exercises }, 'Add exercise');
      add.addEventListener('click', () => {
        slot.workout.push(nextExercise(slot.workout));
        refresh();
        renderEditor();
        const lines = editor.querySelectorAll('.wk-line select');
        if (lines.length) lines[lines.length - 1].focus();
      });
      const copy = h('button', { type: 'button', class: 'btn btn-light' }, `Copy to all ${count}`);
      CC.ui.confirmButton(copy, `Press again to copy to all ${count}`, () => {
        roster.slice(0, count).forEach((s) => {
          if (s !== slot) s.workout = deepCopy(slot.workout);
        });
        setCount(count, slot.id);
      });
      const done = h('button', { type: 'button', class: 'btn' }, 'Done');
      done.addEventListener('click', () => {
        toggle(false);
        editBtn.focus();
      });

      fill(editor,
        h('div', { class: 'wk-labels mono muted', 'aria-hidden': 'true' },
          h('span', null, 'exercise'), h('span', null, 'sets'), h('span', null, 'reps per set'), h('span')),
        lines,
        h('div', { class: 'wk-actions' }, add, copy, done));
    }

    function toggle(open) {
      editorRow.hidden = !open;
      editBtn.setAttribute('aria-expanded', String(open));
      editBtn.textContent = open ? 'Close' : 'Edit';
      if (open) renderEditor();
    }
    editBtn.addEventListener('click', () => toggle(editorRow.hidden));

    refresh();
    return { slot, rows: [row, editorRow], open: () => toggle(true) };
  }

  // Shows the first n participants. openId keeps that participant's editor open.
  function setCount(n, openId) {
    count = toInt(n, 1, MAX, count);
    countInput.value = count;
    const built = roster.slice(0, count).map(rowFor);
    tbody.replaceChildren(...built.flatMap((b) => b.rows));
    const keep = built.find((b) => b.slot.id === openId);
    if (keep) keep.open();
  }

  document.querySelectorAll('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => setCount(count + Number(btn.dataset.step))));
  countInput.addEventListener('change', () => setCount(countInput.value));
  setCount(count);

  document.getElementById('start').addEventListener('click', () => {
    CC.roster.save(roster);
    CC.store.setLastCount(count);
    startLive(CC.roster.all().slice(0, count));
  });

  function renderRecent() {
    const list = CC.sessions.all().slice(-6).reverse();
    document.getElementById('recent').replaceChildren(...list.map((s) => {
      const avg = Math.round(mean(s.participants.map((p) => p.success)) || 0);
      return h('li', null, h('a', { href: 'session-results.html?s=' + encodeURIComponent(s.id) },
        h('span', { class: 'mono' }, `${fmtDate(s.startedAt)}, ${fmtTime(s.startedAt)}`),
        h('span', null, `${s.participants.length} participants`),
        h('span', { class: 'mono' }, `avg ${avg}%`),
        h('span', { class: 'mono muted' }, s.sample ? 'sample' : '')));
    }));
  }
  renderRecent();

  // ---------- live ----------

  // Label in the "needs attention" list: number and first name, or just the number.
  function attentionLabel(t) {
    const num = pad2(CC.slotNumber(t.id));
    const first = firstName(t.name);
    return first ? `${num} ${first}` : num;
  }

  function startLive(slots) {
    const startedAt = Date.now();
    const sessionId = CC.sessions.newId(startedAt);
    const blocks = new Map(slots.map((s) => [s.id, CC.ui.block(s, { audience: 'instructor' })]));
    const grid = document.getElementById('grid');
    const clock = document.getElementById('clock');
    const feedEl = document.getElementById('feed');
    const attention = document.getElementById('attention');

    document.getElementById('legend').append(' 0% ', CC.ui.swatches(), ' 100%');
    grid.replaceChildren(...[...blocks.values()].map((b) => b.el));
    grid.classList.toggle('grid-dense', slots.length > 16);
    document.getElementById('live-count').textContent = slots.length;
    setupEl.hidden = true;
    liveEl.hidden = false;
    window.scrollTo(0, 0);

    // The feed is created first because the trackers need its speed. Its events only
    // start arriving after feed.start(), by which time the trackers exist.
    const feed = CC.feed.create(
      slots,
      (ev) => {
        const t = trackers.get(ev.pid);
        if (t) t.apply(ev, Date.now());
      },
      (status) => (feedEl.textContent = `${feed.label}, ${status}`));
    const trackers = new Map(slots.map((s) => [s.id, new CC.Tracker(s, startedAt, feed.speed)]));
    feedEl.textContent = feed.label;

    let running = true;
    let flaggedKey = null;
    function draw() {
      const now = Date.now();
      clock.textContent = fmtClock(now - startedAt);
      const snapshots = {};
      const flagged = [];
      for (const [id, t] of trackers) {
        const snap = t.snapshot(now);
        snapshots[id] = snap;
        blocks.get(id).update(snap);
        if (snap.issues.length) flagged.push(t);
      }
      // Patient pages open in this browser show their own block from this.
      CC.live.write({ state: 'live', id: sessionId, startedAt, updatedAt: now, participants: snapshots });

      const key = flagged.map((t) => t.id).join(',');
      if (key === flaggedKey) return;
      flaggedKey = key;
      fill(attention, ...(flagged.length
        ? [h('b', null, `Needs attention (${flagged.length})`),
          ...flagged.map((t) => h('a', { href: '#block-' + t.id }, attentionLabel(t)))]
        : [h('span', { class: 'muted' }, 'Nobody needs attention right now.')]));
    }

    draw();
    const timer = setInterval(draw, 500);
    feed.start();

    const guard = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    // Leaving the page mid-session stops it for patients too.
    window.addEventListener('pagehide', () => {
      if (running) CC.live.write({ state: 'abandoned', id: sessionId, updatedAt: Date.now() });
    });

    CC.ui.confirmButton(document.getElementById('end'), 'Press again to end', () => {
      running = false;
      clearInterval(timer);
      feed.stop();
      const endedAt = Date.now();
      CC.sessions.add({
        id: sessionId,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        participants: [...trackers.values()].map((t) => t.result()),
      });
      // Tells patient pages the results are saved, so they can open them.
      CC.live.write({ state: 'ended', id: sessionId, updatedAt: endedAt });
      window.removeEventListener('beforeunload', guard);
      location.href = 'session-results.html?s=' + encodeURIComponent(sessionId);
    });
  }
})();
