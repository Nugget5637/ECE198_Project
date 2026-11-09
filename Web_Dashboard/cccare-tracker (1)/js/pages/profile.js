/* Profile for whoever is signed in: a picture, a birthday and a short biography.
   The picture is cropped to a square and shrunk to 256 pixels before it's saved, so it
   fits in the browser's storage. */
(function () {
  'use strict';
  const account = CC.auth.require();
  if (!account) return;

  const { fill, fmtDate } = CC.util;
  CC.ui.frame(account);

  const home = CC.auth.home(account);
  document.getElementById('home').href = home;
  document.getElementById('back').href = home;

  const form = document.getElementById('profile');
  const error = document.getElementById('error');
  const saved = document.getElementById('saved');
  const bioCount = document.getElementById('bio-count');
  const PHOTO_PX = 256;
  const FILE_MAX = 15 * 1024 * 1024; // larger files are refused before they're opened

  let profile = CC.profiles.get(account.username);
  let photo = profile.photo;

  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  form.elements.birthday.max = iso(today);
  form.elements.birthday.min = '1900-01-01';
  form.elements.birthday.value = profile.birthday;
  form.elements.bio.value = profile.bio;

  function age(birthday) {
    const [y, m, d] = birthday.split('-').map(Number);
    let years = today.getFullYear() - y;
    if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) years -= 1;
    return years;
  }

  // The card at the top shows the profile as others would see it, including unsaved edits.
  function renderCard() {
    const birthday = form.elements.birthday.value;
    const bio = form.elements.bio.value.trim();
    fill(document.getElementById('card-photo'), CC.ui.avatar(account.username, photo, 128));
    document.getElementById('card-name').textContent = account.username;
    const meta = [account.role];
    if (account.participantId) meta.push('block ' + CC.slotNumber(account.participantId));
    if (birthday) meta.push(`born ${fmtDate(birthday + 'T12:00:00')} (age ${age(birthday)})`);
    document.getElementById('card-meta').textContent = meta.join(' · ');
    const bioEl = document.getElementById('card-bio');
    bioEl.textContent = bio || 'No biography yet.';
    bioEl.classList.toggle('muted', !bio);
    bioCount.textContent = `${form.elements.bio.value.length} of ${CC.profiles.BIO_MAX} characters`;
    document.getElementById('remove-photo').disabled = !photo;
  }

  function changed() {
    saved.textContent = '';
    error.textContent = '';
    renderCard();
  }
  form.elements.bio.addEventListener('input', changed);
  form.elements.birthday.addEventListener('change', changed);

  // Center-crops the image to a square and redraws it at PHOTO_PX as a JPEG.
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = PHOTO_PX;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, PHOTO_PX, PHOTO_PX);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('not an image'));
      };
      img.src = url;
    });
  }

  form.elements.photo.addEventListener('change', async () => {
    const file = form.elements.photo.files[0];
    error.textContent = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      error.textContent = 'Choose a PNG, JPEG, WebP or GIF picture.';
      return;
    }
    if (file.size > FILE_MAX) {
      error.textContent = 'That picture is too large. Choose one under 15 MB.';
      return;
    }
    try {
      photo = await shrink(file);
      changed();
    } catch (e) {
      error.textContent = 'That file couldn’t be opened as a picture.';
    }
  });

  document.getElementById('remove-photo').addEventListener('click', () => {
    photo = '';
    form.elements.photo.value = '';
    changed();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    error.textContent = '';
    const birthday = form.elements.birthday.value;
    if (birthday && (birthday > iso(today) || birthday < '1900-01-01')) {
      error.textContent = 'Enter a birthday between 1900 and today.';
      return;
    }
    const next = { bio: form.elements.bio.value.trim(), birthday, photo };
    if (!CC.profiles.save(account.username, next)) {
      error.textContent = 'Could not save. The browser’s storage may be full; try a smaller picture.';
      return;
    }
    profile = CC.profiles.get(account.username);
    saved.textContent = 'Saved.';
    // Updates the picture in the header.
    document.querySelectorAll('.profile-link .avatar').forEach((el) =>
      el.replaceWith(CC.ui.avatar(account.username, profile.photo, 24)));
  });

  renderCard();
})();
