/* One patient's results for one session, with a Progress button that opens a line graph
   of their success across sessions. Used by instructors and patients; a patient can only
   ever see their own results. */
(function () {
  'use strict';
  const account = CC.auth.require();
  if (!account) return;

  const { h, pad2, fmtDate, fmtDay, fmtTime, fmtExertion, plural } = CC.util;
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
    CC.util.fill(crumbs,
      h('a', { href: 'session-results.html?s=' + encodeURIComponent(session.id) }, 'All results'),
      h('span', { class: 'muted' }, `${i + 1} of ${people.length}`),
      i > 0 ? h('a', { href: to(people[i - 1]) }, 'Previous') : null,
      i < people.length - 1 ? h('a', { href: to(people[i + 1]) }, 'Next') : null);
  }

  // ---------- summary ----------

  const wheel = CC.ui.ring(240, 16);
  requestAnimationFrame(() => requestAnimationFrame(() => wheel.set(result.success, result.quality)));
  const completion = result.dose ? Math.round((result.reps / result.dose) * 100) : 0;

  const summary = h('section', { class: 'result' },
    h('div', { class: 'wheel' }, wheel.el,
      h('div', { class: 'wheel-text' },
        h('span', { class: 'wheel-pct' }, result.success + '%'),
        h('span', { class: 'wheel-reps' }, 'success'))),
    h('dl', { class: 'facts' },
      h('dt', null, 'exercise'), h('dd', null, CC.exerciseName(result.exercise)),
      h('dt', null, 'reps'), h('dd', null, `${result.reps} of ${result.dose} (${completion}% of the dose)`),
      h('dt', null, 'quality'), h('dd', null, result.quality == null ? '—' : `${result.quality}% on average`),
      h('dt', null, 'exertion'), h('dd', null, result.exertionAvg == null ? '—'
        : `${fmtExertion(result.exertionAvg)} of 10 on average, ${fmtExertion(result.exertionPeak)} at the hardest`)));

  // ---------- what went wrong ----------

  const items = [];
  const dose = CC.ui.doseNote(result);
  if (dose) {
    items.push(h('li', null, h('span', null, h('b', null, 'Dose'), ' ', dose),
      isPatient ? h('p', { class: 'cue' }, result.reps > result.dose
        ? 'Stopping at your dose protects you from overdoing it.'
        : 'Try to finish the whole dose next time, resting between reps if you need to.') : null));
  }
  if (result.exertionPeak != null && result.exertionPeak >= CC.LIMITS.exertionHigh) {
    items.push(h('li', null, h('span', null, h('b', null, 'Exertion'), ` reached ${fmtExertion(result.exertionPeak)} of 10`),
      isPatient ? h('p', { class: 'cue' }, 'If it feels very hard, slow down or rest.') : null));
  }
  for (const f of CC.ui.faultList(result)) {
    items.push(h('li', null,
      h('span', null, f.part ? h('b', null, f.part) : null, ' ', f.issue),
      h('span', { class: 'count' }, `${plural(f.count, 'rep')} of ${result.reps}`),
      isPatient && f.cue ? h('p', { class: 'cue' }, f.cue) : null));
  }
  const wrong = h('section', { class: 'wrong' },
    h('h2', null, 'What went wrong'),
    items.length ? h('ul', null, items) : h('p', { class: 'muted' }, 'Nothing was flagged this session.'));

  // ---------- progress ----------

  const history = CC.sessions.historyFor(pid);
  const points = history.map(({ session: s, result: r }) => ({
    at: new Date(s.startedAt),
    value: r.success,
    current: s.id === session.id,
    href: self(s.id),
    note: `${CC.exerciseName(r.exercise).toLowerCase()} · ${r.reps}/${r.dose} reps`,
  }));

  const panel = h('div', { class: 'progress-panel', id: 'progress-panel', hidden: true });
  const sign = h('span', { class: 'sign', 'aria-hidden': 'true' }, '+');
  const button = h('button', {
    type: 'button', class: 'btn progress-btn', 'aria-expanded': 'false', 'aria-controls': 'progress-panel',
  }, 'Progress', sign);
  let drawn = false;

  button.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    sign.textContent = open ? '−' : '+';
    if (open && !drawn) {
      drawn = true;
      drawProgress();
    }
  });

  function drawProgress() {
    const first = points[0];
    const best = points.reduce((a, b) => (b.value > a.value ? b : a), first);
    const here = points.find((p) => p.current) || points[points.length - 1];
    const change = here.value - first.value;
    const chartBox = h('div');

    panel.replaceChildren(
      h('dl', { class: 'progress-stats' },
        h('div', null, h('dt', null, 'sessions'), h('dd', null, String(points.length))),
        h('div', null, h('dt', null, `first, ${fmtDay(first.at)}`), h('dd', null, first.value + '%')),
        h('div', null, h('dt', null, `best, ${fmtDay(best.at)}`), h('dd', null, best.value + '%')),
        h('div', null, h('dt', null, 'this session'), h('dd', null, here.value + '%')),
        h('div', null, h('dt', null, 'change since first'),
          h('dd', null, `${change > 0 ? '+' : ''}${change} ${Math.abs(change) === 1 ? 'point' : 'points'}`))),
      chartBox,
      h('p', { class: 'progress-note mono muted' }, points.length > 1
        ? 'Hover or tap the graph to read a session. Click a square to open that session.'
        : 'This is the first session on record. The line appears after the next one.'));

    CC.progressChart(chartBox, points, { label: `${name}: success by session` });
  }

  const progress = h('section', { class: 'progress' }, button, panel);

  // ---------- how it's worked out ----------

  const how = h('section', { class: 'how' },
    h('h2', null, 'How success is worked out'),
    h('p', null,
      'Success is the share of the dose done, multiplied by the average movement quality of the reps. ',
      'Stopping short and going past the dose both count against it. ',
      'For example, 20 of 20 reps at 85% quality is 85%, and 15 of 20 or 25 of 20 at 85% quality is 64%.'));

  main.replaceChildren(
    crumbs,
    h('section', { class: 'result-head' },
      h('h1', null, name),
      h('p', { class: 'mono muted' },
        `${pad2(CC.slotNumber(pid))} · ${fmtDate(session.startedAt)}, ${fmtTime(session.startedAt)}`,
        session.mode === 'individual' ? (isPatient ? ' · on your own' : ' · on their own') : '',
        session.sample ? ' · sample data' : '')),
    summary,
    wrong,
    progress,
    how);
})();
