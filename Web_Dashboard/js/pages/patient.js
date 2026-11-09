/* Patient: one block for the signed-in participant, then their results. */
(function () {
  'use strict';
  const account = CC.auth.require('patient');
  if (!account) return;

  const { h, fmtDate } = CC.util;
  CC.ui.frame(account);

  const pid = account.participantId;
  const slot = CC.roster.get(pid);
  const name = CC.displayName(slot);
  document.getElementById('name').textContent = name;
  document.getElementById('plan').textContent =
    `Today: ${CC.exerciseName(slot.exercise).toLowerCase()}, ${slot.dose} reps.`;

  const block = CC.ui.block(slot, { audience: 'patient', size: 'large' });
  block.message('Press Start when you’re ready.');
  document.getElementById('slot').append(block.el);

  const last = CC.sessions.latestFor(pid);
  if (last) {
    const r = last.participants.find((p) => p.id === pid);
    document.getElementById('last').replaceChildren(
      `Last session, ${fmtDate(last.startedAt)}: ${r.success}%. `,
      h('a', { href: 'patient-results.html?s=' + encodeURIComponent(last.id) }, 'See results and progress'));
  }

  const startBtn = document.getElementById('start');
  const endBtn = document.getElementById('end');
  const feedEl = document.getElementById('feed');

  startBtn.addEventListener('click', () => {
    const startedAt = Date.now();
    const tracker = new CC.Tracker(slot, startedAt);
    const feed = CC.feed.create(
      [slot],
      (ev) => tracker.apply(ev, Date.now()),
      (status) => (feedEl.textContent = `feed: ${feed.label}, ${status}`),
      { planWeights: { complete: 0.8, under: 0.1, over: 0.1 } });

    startBtn.hidden = true;
    endBtn.hidden = false;
    feedEl.hidden = false;
    feedEl.textContent = 'feed: ' + feed.label;
    document.getElementById('note').textContent =
      'Your reps, quality and exertion update as you go. The strip under the wheel tells you what to fix.';

    const draw = () => block.update(tracker, Date.now());
    draw();
    const timer = setInterval(draw, 500);
    feed.start();

    const guard = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);

    CC.ui.confirmButton(endBtn, 'Press again to end', () => {
      clearInterval(timer);
      feed.stop();
      const session = {
        id: CC.sessions.newId(startedAt),
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        mode: 'individual',
        participants: [tracker.result()],
      };
      CC.sessions.add(session);
      window.removeEventListener('beforeunload', guard);
      location.href = 'patient-results.html?s=' + encodeURIComponent(session.id);
    });
  });
})();
