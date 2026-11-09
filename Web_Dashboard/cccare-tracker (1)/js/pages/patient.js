/* Patient: one block for the signed-in participant. It follows the instructor's session:
   it goes live when the instructor starts, and opens the results when the instructor ends.
   The patient can't start or end a session. */
(function () {
  'use strict';
  const account = CC.auth.require('patient');
  if (!account) return;

  const { h, fill, fmtDate } = CC.util;
  CC.ui.frame(account);

  // If the instructor's page stops updating for this long, say so.
  const STALE_MS = 90 * 1000;

  const pid = account.participantId;
  const slot = CC.roster.get(pid);
  const nameEl = document.getElementById('name');
  const planEl = document.getElementById('plan');
  const stateEl = document.getElementById('state');
  const lastEl = document.getElementById('last');

  nameEl.textContent = CC.displayName(slot);
  planEl.textContent = `Today’s workout: ${CC.describeWorkout(slot.workout, true).toLowerCase()}.`;

  const block = CC.ui.block(slot, { audience: 'patient', size: 'large' });
  block.message('Waiting for your instructor to start the session.');
  document.getElementById('slot').append(block.el);

  const last = CC.sessions.latestFor(pid);
  if (last) {
    const r = last.participants.find((p) => p.id === pid);
    fill(lastEl,
      `Last session, ${fmtDate(last.startedAt)}: ${r.success}%. `,
      h('a', { href: 'patient-results.html?s=' + encodeURIComponent(last.id) }, 'See results and progress'));
  }

  let watching = null; // id of the session this page has shown live
  let shown = '';

  function setState(text, key) {
    if (shown === key) return;
    shown = key;
    stateEl.textContent = text;
  }

  function check() {
    const live = CC.live.read();
    const now = Date.now();

    if (live && live.state === 'live' && now - live.updatedAt < STALE_MS) {
      const snap = live.participants && live.participants[pid];
      if (!snap) {
        setState('A session is running, but you’re not in it. Ask your instructor to add you.', 'not-in');
        return;
      }
      if (watching !== live.id) {
        watching = live.id;
        planEl.textContent = `Today’s workout: ${CC.describeWorkout(snap.exercises, true).toLowerCase()}.`;
      }
      if (snap.name) nameEl.textContent = snap.name; // the instructor may have named them
      setState('Your session is running.', 'live');
      block.update(snap);
      return;
    }

    if (live && live.state === 'ended' && watching && live.id === watching) {
      setState('Session over. Opening your results…', 'ended');
      location.href = 'patient-results.html?s=' + encodeURIComponent(live.id);
      return;
    }

    if (watching) {
      watching = null;
      const text = live && live.state === 'abandoned'
        ? 'Your instructor’s session stopped before it finished.'
        : 'Lost contact with your instructor’s screen.';
      block.message(text);
      setState(text + ' Waiting for the next session.', 'lost');
      return;
    }

    if (!shown) setState('Waiting for your instructor to start the session.', 'waiting');
  }

  // The instructor's page writes to localStorage twice a second. Other tabs hear about it
  // through the storage event; the one-second check also notices when updates stop.
  window.addEventListener('storage', (e) => {
    if (e.key === CC.live.key) check();
  });
  setInterval(check, 1000);
  check();
})();
