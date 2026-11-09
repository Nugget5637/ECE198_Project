/* Sign-in page: the account decides whether you land on the instructor or patient screen. */
(function () {
  'use strict';
  const { h } = CC.util;
  const form = document.getElementById('signin');
  const error = document.getElementById('error');

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
    const username = form.elements.username.value;
    const password = form.elements.password.value;
    if (!username.trim() || !password) {
      error.textContent = 'Enter your username and password.';
      return;
    }
    const account = CC.auth.signIn(username, password);
    if (!account) {
      error.textContent = 'That username and password don’t match an account.';
      form.elements.password.value = '';
      form.elements.password.focus();
      return;
    }
    location.href = CC.auth.home(account);
  });
})();
