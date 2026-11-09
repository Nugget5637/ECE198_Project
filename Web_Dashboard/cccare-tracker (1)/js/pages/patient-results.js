/* One patient's results for one session: overall success, each exercise, what went wrong,
   and a Progress button with a line graph across sessions (overall or one exercise).
   Used by instructors and patients; a patient can only ever see their own results. */
(function () {
  'use strict';
  const account = CC.auth.require();
  if (!account) return;

  const { h, fill, pad2, fmtDate, fmtDay, fmtTime, fmtExertion, plural } = CC.util;
  const score = CC.score;
  CC.ui.frame(account);

  const isPatient = account.role === 'patient';
  const pid = isPatient ? account.participantId : CC.util.param('p');
  const main = document.getElementById('main');
  document.getElementById('home').href = CC.auth.home(account);

  const wanted = CC.util.param('s');
  let session = wanted ? CC.sessions.get(wanted) : null;
  if (!session || !session.participants.some((p) => p.id === pid)) session = pid ? CC.sessions.latestFor(pid) : null;
  const result = session && session.participants.find((p) => p.id === pid);

  if (!result) {
    main.replaceChildren(h('section', { class: 'empty' },
      h('h1', null, 'No results yet'),
      h('p', null, 'Results appear here after a session ends. ',
        h('a', { href: CC.auth.home(account) }, isPatient ? 'Back to today' : 'Back to sessions'))));
    return;
  }

  const name = CC.displayName(result);
  const self = (sid) => `patient-results.html?s=${encodeURIComponent(sid)}` + (isPatient ? '' : `&p=${encodeURIComponent(pid)}`);
  document.title = `${name}, ${fmtDate(session.startedAt)} · CCCARE exercise tracking`;

  // ---------- navigation ----------

  const crumbs = h('nav', { class: 'crumbs mono', 'aria-label': 'Results navigation' });
  if (isPatient) {
    crumbs.append(h('a', { href: 'patient.html' }, 'Back to today'));
  } else {
    const people = session.participants.slice().sort((a, b) => CC.slotNumber(a.id) - CC.slotNumber(b.id));
    const i = people.findIndex((p) => p.id === pid);
    const to = (p) => `patient-results.html?s=${encodeURIComponent(session.id)}&p=${encodeURIComponent(p.id)}`;
    fill(crumbs,
      h('a', { href: 'session-results.html?s=' + encodeURIComponent(session.id) }, 'All results'),
      h('span', { class: 'muted' }, `${i + 1} of ${people.length}`),
      i > 0 ? h('a', { href: to(people[i - 1]) }, 'Previous') : null,
      i < people.length - 1 ? h('a', { href: to(people[i + 1]) }, 'Next') : null);
  }

  // ---------- summary ----------

  const wheel = CC.ui.ring(240, 16);
  requestAnimationFrame(() => requestAnimationFrame(() => wheel.set(result.success)));
  const completion = result.repsPlanned ? Math.round((result.repsDone / result.repsPlanned) * 100) : 0;

  const summary = h('section', { class: 'result' },
    h('div', { class: 'wheel' }, wheel.el,
      h('div', { class: 'wheel-text' },
        h('span', { class: 'wheel-pct' }, result.success + '%'),
        h('span', { class: 'wheel-reps' }, 'success'))),
    h('dl', { class: 'facts' },
      h('dt', null, 'workout'), h('dd', null, `${plural(result.exercises.length, 'exercise')}, ${result.setsDone} of ${result.setsPlanned} sets finished`),
      h('dt', null, 'reps'), h('dd', null, `${result.repsDone} of ${result.repsPlanned} (${completion}% of the plan)`),
      h('dt', null, 'quality'), h('dd', null, result.quality == null ? '—' : `${result.quality}% on average`),
      h('dt', null, 'exertion'), h('dd', null, result.exertionAvg == null ? '—'
        : `${fmtExertion(result.exertionAvg)} of 10 on average, ${fmtExertion(result.exertionPeak)} at the hardest`)));

  // ---------- each exercise ----------

  const exercises = h('section', { class: 'exercises' },
    h('h2', null, 'Exercises'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'ex-table' },
        h('thead', null, h('tr', null,
          ['Exercise', 'Plan', 'Reps in each set', 'Reps', 'Quality', 'Success'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, result.exercises.map((e) => h('tr', null,
          h('td', null, CC.exerciseName(e.exercise)),
          h('td', { class: 'mono' }, `${e.sets} × ${e.reps}`),
          h('td', { class: 'mono' }, e.done.join(' · ') + (e.extra ? ` + ${e.extra} extra` : '')),
          h('td', { class: 'mono' }, `${score.repsDone(e)}/${score.planned(e)}`),
          h('td', { class: 'mono' }, e.quality == null ? '—' : e.quality + '%'),
          h('td', null, h('span', { class: 'cell-success' }, CC.ui.miniRing(e.success), e.success + '%'))))))));

  // ---------- what went wrong ----------

  const items = CC.ui.whatWentWrong(result).map((it) =>
    h('li', null,
      h('span', null, it.message),
      it.detail ? h('span', { class: 'count' }, it.detail) : h('span'),
      isPatient && it.cue ? h('p', { class: 'cue' }, it.cue) : null));
  const wrong = h('section', { class: 'wrong' },
    h('h2', null, 'What went wrong'),
    items.length ? h('ul', null, items) : h('p', { class: 'muted' }, 'Nothing was flagged this session.'));

  // ---------- progress ----------

  const history = CC.sessions.historyFor(pid);
  const codes = [];
  history.forEach(({ result: r }) => r.exercises.forEach((e) => {
    if (!codes.includes(e.exercise)) codes.push(e.exercise);
  }));

  // Points for the graph: overall success (code null) or one exercise's success.
  function pointsFor(code) {
    return history.map(({ session: s, result: r }) => {
      const base = { at: new Date(s.startedAt), current: s.id === session.id, href: self(s.id) };
      if (!code) {
        return Object.assign(base, { value: r.success, note: `${plural(r.exercises.length, 'exercise')} · ${r.repsDone}/${r.repsPlanned} reps` });
      }
      const e = r.exercises.find((x) => x.exercise === code);
      if (!e) return null;
      return Object.assign(base, { value: e.success, note: `${e.sets} × ${e.reps} · ${score.repsDone(e)}/${score.planned(e)} reps` });
    }).filter(Boolean);
  }

  const panel = h('div', { class: 'progress-panel', id: 'progress-panel', hidden: true });
  const sign = h('span', { class: 'sign', 'aria-hidden': 'true' }, '+');
  const button = h('button', {
    type: 'button', class: 'btn progress-btn', 'aria-expanded': 'false', 'aria-controls': 'progress-panel',
  }, 'Progress', sign);
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Show progress for' });
  const statsBox = h('div');
  const chartBox = h('div');
  const note = h('p', { class: 'progress-note mono muted' });
  let selected = null;
  let drawn = false;

  function renderFilters() {
    fill(filters, [null, ...codes].map((code) => {
      const b = h('button', { type: 'button', class: 'filter', 'aria-pressed': String(code === selected) },
        code ? CC.exerciseName(code) : 'All exercises');
      b.addEventListener('click', () => {
        selected = code;
        renderFilters();
        drawProgress();
      });
      return b;
    }));
  }

  function drawProgress() {
    const points = pointsFor(selected);
    const label = selected ? CC.exerciseName(selected) : 'Overall';
    if (!points.length) {
      fill(statsBox);
      fill(chartBox, h('p', { class: 'muted' }, 'No sessions with this exercise yet.'));
      note.textContent = '';
      return;
    }
    const first = points[0];
    const best = points.reduce((a, b) => (b.value > a.value ? b : a), first);
    const here = points.find((p) => p.current);
    const end = here || points[points.length - 1];
    const change = end.value - first.value;
    fill(statsBox, h('dl', { class: 'progress-stats' },
      h('div', null, h('dt', null, 'sessions'), h('dd', null, String(points.length))),
      h('div', null, h('dt', null, `first, ${fmtDay(first.at)}`), h('dd', null, first.value + '%')),
      h('div', null, h('dt', null, `best, ${fmtDay(best.at)}`), h('dd', null, best.value + '%')),
      h('div', null, h('dt', null, 'this session'), h('dd', null, here ? here.value + '%' : 'not done')),
      h('div', null, h('dt', null, 'change since first'),
        h('dd', null, `${change > 0 ? '+' : ''}${change} ${Math.abs(change) === 1 ? 'point' : 'points'}`))));
    CC.progressChart(chartBox, points, { label: `${name}: ${label.toLowerCase()} success by session` });
    note.textContent = points.length > 1
      ? 'Hover or tap the graph to read a session. Click a square to open that session.'
      : 'Only one session so far. The line appears after the next one.';
  }

  button.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    sign.textContent = open ? '−' : '+';
    if (open && !drawn) {
      drawn = true;
      fill(panel, codes.length > 1 ? filters : null, statsBox, chartBox, note);
      renderFilters();
      drawProgress();
    }
  });

  const progress = h('section', { class: 'progress' }, button, panel);

  // ---------- how it's worked out ----------

  const how = h('section', { class: 'how' },
    h('h2', null, 'How success is worked out'),
    h('p', null,
      'Each exercise scores the share of its planned reps that were done as planned, multiplied by the average movement quality of its reps. ',
      'Stopping a set short and going past it both count against it. ',
      'The overall score combines the exercises, weighted by how many reps each one plans. ',
      'For example, 2 sets of 10 done as 10 and 10 at 85% quality scores 85%. Done as 10 and 5, or as 10 and 15, at 85% quality it scores 64%.'));

  main.replaceChildren(
    crumbs,
    h('section', { class: 'result-head' },
      h('h1', null, name),
      h('p', { class: 'mono muted' },
        `${pad2(CC.slotNumber(pid))} · ${fmtDate(session.startedAt)}, ${fmtTime(session.startedAt)}`,
        session.sample ? ' · sample data' : '')),
    summary,
    exercises,
    wrong,
    progress,
    how);
})();
