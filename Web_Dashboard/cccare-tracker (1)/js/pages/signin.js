/* Sign-in page: choose Instructor or Patient, then enter that account's details. */
(function () {
  'use strict';
  const { h } = CC.util;
  const form = document.getElementById('signin');
  const error = document.getElementById('error');
  const title = document.getElementById('form-title');
  const buttons = document.querySelectorAll('.role');
  const NAMES = { instructor: 'Instructor', patient: 'Patient' };
  let role = null;

  function choose(next) {
    role = next;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === role)));
    title.textContent = `${NAMES[role]} sign-in`;
    error.textContent = '';
    form.hidden = false;
    form.elements.username.focus();
  }
  buttons.forEach((b) => b.addEventListener('click', () => choose(b.dataset.role)));

  const current = CC.auth.current();
  if (current) {
    const note = document.getElementById('already');
    note.hidden = false;
    note.replaceChildren(
      `Signed in as ${current.username}. `,
      h('a', { href: CC.auth.home(current) }, 'Continue'),
      ', or sign in with another account.');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!role) return;
    const username = form.elements.username.value;
    const password = form.elements.password.value;
    if (!username.trim() || !password) {
      error.textContent = 'Enter your username and password.';
      return;
    }
    const outcome = CC.auth.signIn(username, password, role);
    if (outcome && outcome.account) {
      location.href = CC.auth.home(outcome.account);
      return;
    }
    error.textContent = outcome && outcome.wrongRole
      ? `That’s ${outcome.wrongRole === 'instructor' ? 'an instructor' : 'a patient'} account. Choose ${NAMES[outcome.wrongRole]} above.`
      : 'That username and password don’t match an account.';
    form.elements.password.value = '';
    form.elements.password.focus();
  });
})();
