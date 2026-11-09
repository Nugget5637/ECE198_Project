/* Instructor: set up the class, watch everyone live, end the session. */
(function () {
  'use strict';
  const account = CC.auth.require('instructor');
  if (!account) return;

  const { h, pad2, toInt, fmtDate, fmtTime, fmtClock, mean } = CC.util;
  CC.ui.frame(account);

  const MAX = CC.MAX_PARTICIPANTS;
  const roster = CC.roster.all();
  const setupEl = document.getElementById('setup');
  const liveEl = document.getElementById('live');
  const tbody = document.getElementById('roster');
  const countInput = document.getElementById('count');
  let count = toInt(CC.store.lastCount(), 1, MAX, 12);

  // ---------- set-up ----------

  function rowFor(slot) {
    const n = CC.slotNumber(slot.id);
    const exercises = Object.entries(CC.EXERCISES).map(([code, ex]) =>
      h('option', { value: code, selected: code === slot.exercise }, ex.name));
    return h('tr', { 'data-id': slot.id },
      h('td', null, pad2(n)),
      h('td', null, h('input', {
        type: 'text', name: 'name', value: slot.name, placeholder: CC.defaultName(slot.id),
        maxlength: 40, autocomplete: 'off', 'aria-label': `Name, participant ${n}`,
      })),
      h('td', null, h('div', { class: 'select' },
        h('select', { name: 'exercise', 'aria-label': `Exercise, participant ${n}` }, exercises))),
      h('td', null, h('input', {
        type: 'number', name: 'dose', min: 1, max: 100, value: slot.dose, inputmode: 'numeric',
        'aria-label': `Dose in reps, participant ${n}`,
      })));
  }

  // Copies what has been typed in the table back into the roster.
  function readRows() {
    for (const tr of tbody.rows) {
      const slot = roster.find((s) => s.id === tr.dataset.id);
      slot.name = tr.querySelector('[name=name]').value.trim().slice(0, 40);
      slot.exercise = tr.querySelector('[name=exercise]').value;
      slot.dose = toInt(tr.querySelector('[name=dose]').value, 1, 100, slot.dose);
    }
  }

  function setCount(n) {
    readRows();
    count = toInt(n, 1, MAX, count);
    countInput.value = count;
    tbody.replaceChildren(...roster.slice(0, count).map(rowFor));
  }

  document.querySelectorAll('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => setCount(count + Number(btn.dataset.step))));
  countInput.addEventListener('change', () => setCount(countInput.value));
  setCount(count);

  document.getElementById('start').addEventListener('click', () => {
    readRows();
    CC.roster.save(roster);
    CC.store.setLastCount(count);
    startLive(roster.slice(0, count).map((slot) => Object.assign({}, slot)));
  });

  function renderRecent() {
    const list = CC.sessions.all().slice(-6).reverse();
    document.getElementById('recent').replaceChildren(...list.map((s) => {
      const avg = Math.round(mean(s.participants.map((p) => p.success)) || 0);
      const who = s.mode === 'individual'
        ? `${CC.displayName(s.participants[0])}, on their own`
        : `${s.participants.length} participants`;
      return h('li', null, h('a', { href: 'session-results.html?s=' + encodeURIComponent(s.id) },
        h('span', { class: 'mono' }, `${fmtDate(s.startedAt)}, ${fmtTime(s.startedAt)}`),
        h('span', null, who),
        h('span', { class: 'mono' }, `avg ${avg}%`),
        h('span', { class: 'mono muted' }, s.sample ? 'sample' : '')));
    }));
  }
  renderRecent();

  // ---------- live ----------

  function startLive(slots) {
    const startedAt = Date.now();
    const trackers = new Map(slots.map((s) => [s.id, new CC.Tracker(s, startedAt)]));
    const blocks = new Map(slots.map((s) => [s.id, CC.ui.block(s, { audience: 'instructor' })]));
    const grid = document.getElementById('grid');
    const clock = document.getElementById('clock');
    const feedEl = document.getElementById('feed');
    const attention = document.getElementById('attention');

    document.getElementById('legend').append(' ', CC.ui.swatches());
    grid.replaceChildren(...[...blocks.values()].map((b) => b.el));
    grid.classList.toggle('grid-dense', slots.length > 16);
    document.getElementById('live-count').textContent = slots.length;
    setupEl.hidden = true;
    liveEl.hidden = false;
    window.scrollTo(0, 0);

    const feed = CC.feed.create(
      slots,
      (ev) => {
        const t = trackers.get(ev.pid);
        if (t) t.apply(ev, Date.now());
      },
      (status) => (feedEl.textContent = `${feed.label}, ${status}`));
    feedEl.textContent = feed.label;

    let flaggedKey = null;
    function draw() {
      const now = Date.now();
      clock.textContent = fmtClock(now - startedAt);
      const flagged = [];
      for (const [id, block] of blocks) {
        if (block.update(trackers.get(id), now).length) flagged.push(id);
      }
      const key = flagged.join(',');
      if (key === flaggedKey) return;
      flaggedKey = key;
      attention.replaceChildren(...(flagged.length
        ? [h('b', null, `Needs attention (${flagged.length})`),
          ...flagged.map((id) => h('a', { href: '#block-' + id }, `${pad2(CC.slotNumber(id))} ${CC.displayName(trackers.get(id))}`))]
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

    CC.ui.confirmButton(document.getElementById('end'), 'Press again to end', () => {
      clearInterval(timer);
      feed.stop();
      const session = {
        id: CC.sessions.newId(startedAt),
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        mode: 'class',
        participants: [...trackers.values()].map((t) => t.result()),
      };
      CC.sessions.add(session);
      window.removeEventListener('beforeunload', guard);
      location.href = 'session-results.html?s=' + encodeURIComponent(session.id);
    });
  }
})();
