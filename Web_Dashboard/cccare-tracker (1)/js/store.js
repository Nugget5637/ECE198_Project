/* Accounts, the class roster, saved sessions and the live session shared with the
   patient's screen. Everything is kept in this browser (sessionStorage for the sign-in,
   localStorage for data) so the prototype runs without a server. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { mulberry32, gauss, clamp, round1, half, pad2, pick, shuffle, toInt, deepCopy } = CC.util;

  const MAX = 30;
  const DATA_VERSION = '2';
  const KEY = {
    auth: 'cccare.auth',
    feed: 'cccare.feed',
    roster: 'cccare.roster',
    sessions: 'cccare.sessions',
    version: 'cccare.version',
    lastCount: 'cccare.lastCount',
    live: 'cccare.live',
    accounts: 'cccare.accounts',
    profiles: 'cccare.profiles',
  };

  // Sample accounts from the brief. Hard-coded passwords are only acceptable in a
  // prototype; a real deployment has to check them on a server.
  const ACCOUNTS = [
    { username: 'InsU', password: 'InsP', role: 'instructor' },
    { username: 'PatU', password: 'PatP', role: 'patient', participantId: 'P01' },
  ];

  function read(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('Could not save', key, e);
      return false;
    }
  }

  // ---------- participants ----------

  const pid = (n) => 'P' + pad2(n);
  const slotNumber = (id) => parseInt(String(id).slice(1), 10);
  const defaultName = (id) => 'Patient ' + slotNumber(id);

  // ---------- sign-in ----------

  // Accounts made on the sign-up page, kept in localStorage alongside the sample ones.
  // Like the sample accounts, the password is stored as typed: fine for a prototype only.
  function savedAccounts() {
    const list = read(localStorage, KEY.accounts, []);
    return Array.isArray(list)
      ? list.filter((a) => a && typeof a.username === 'string' && typeof a.password === 'string' &&
        (a.role === 'instructor' || a.role === 'patient'))
      : [];
  }
  const allAccounts = () => ACCOUNTS.concat(savedAccounts());
  const findAccount = (username) => {
    const u = String(username || '').trim().toLowerCase();
    return allAccounts().find((a) => a.username.toLowerCase() === u) || null;
  };

  function startSession(account) {
    const signedIn = { username: account.username, role: account.role, participantId: account.participantId || null };
    write(sessionStorage, KEY.auth, signedIn);
    return signedIn;
  }

  const USERNAME = /^[A-Za-z0-9._-]{3,24}$/;

  const auth = {
    // Returns { account } on success, or null. The account decides whether this is an
    // instructor or a patient.
    signIn(username, password) {
      const account = findAccount(username);
      if (!account || account.password !== password) return null;
      return { account: startSession(account) };
    },
    // Makes a new account and signs in with it. Returns { account } or { error }.
    // A patient account is linked to the first block number no other account uses.
    signUp(username, password, role) {
      const name = String(username || '').trim();
      if (!USERNAME.test(name)) return { error: 'Usernames are 3 to 24 letters, numbers, dots, dashes or underscores.' };
      if (findAccount(name)) return { error: 'That username is taken. Choose another.' };
      if (String(password || '').length < 4) return { error: 'Use a password of at least 4 characters.' };
      if (role !== 'instructor' && role !== 'patient') return { error: 'Choose instructor or patient.' };
      const account = { username: name, password, role };
      if (role === 'patient') {
        const used = new Set(allAccounts().map((a) => a.participantId).filter(Boolean));
        let n = 1;
        while (n <= MAX && used.has(pid(n))) n++;
        if (n > MAX) return { error: `All ${MAX} patient places are taken.` };
        account.participantId = pid(n);
        // Shows the new patient's username on the instructor's roster until a name is set.
        const slot = roster.get(account.participantId);
        if (slot && !slot.name) {
          slot.name = name;
          roster.save([slot]);
        }
      }
      if (!write(localStorage, KEY.accounts, savedAccounts().concat([account]))) {
        return { error: 'Could not save the account in this browser.' };
      }
      return { account: startSession(account) };
    },
    current() {
      const a = read(sessionStorage, KEY.auth, null);
      return a && (a.role === 'instructor' || a.role === 'patient') ? a : null;
    },
    home(account) {
      return account.role === 'instructor' ? 'instructor.html' : 'patient.html';
    },
    // Sends anyone not signed in to the sign-in page, and anyone with the wrong role home.
    require(role) {
      const a = auth.current();
      if (!a) {
        location.replace('index.html');
        return null;
      }
      if (role && a.role !== role) {
        location.replace(auth.home(a));
        return null;
      }
      return a;
    },
    signOut() {
      sessionStorage.removeItem(KEY.auth);
      location.href = 'index.html';
    },
  };

  // ---------- roster ----------

  const defaultWorkout = (n) => deepCopy(CC.WORKOUTS[(n - 1) % CC.WORKOUTS.length]);

  // Names start blank, and a blank name shows as "Patient <number>".
  function defaultRoster() {
    const list = [];
    for (let n = 1; n <= MAX; n++) list.push({ id: pid(n), name: '', workout: defaultWorkout(n) });
    return list;
  }

  function cleanWorkout(list, fallback) {
    if (!Array.isArray(list)) return fallback;
    const L = CC.WORKOUT_LIMITS;
    const out = list
      .filter((w) => w && typeof w === 'object' && CC.EXERCISES[w.exercise])
      .slice(0, L.exercises)
      .map((w) => ({
        exercise: w.exercise,
        sets: toInt(w.sets, 1, L.sets, 2),
        reps: toInt(w.reps, 1, L.reps, 10),
        rest: toInt(w.rest, L.restMin, L.restMax, L.rest),
      }));
    return out.length ? out : fallback;
  }

  function cleanSlot(slot, fallback) {
    return {
      id: fallback.id,
      name: String(slot.name || '').trim().slice(0, 40),
      workout: cleanWorkout(slot.workout, fallback.workout),
    };
  }

  let rosterCache = null;
  const roster = {
    all() {
      if (!rosterCache) {
        const saved = read(localStorage, KEY.roster, null);
        rosterCache = defaultRoster().map((slot, i) =>
          Array.isArray(saved) && saved[i] && typeof saved[i] === 'object' ? cleanSlot(saved[i], slot) : slot
        );
      }
      return deepCopy(rosterCache);
    },
    get(id) {
      return roster.all().find((s) => s.id === id) || null;
    },
    save(list) {
      const base = defaultRoster();
      const current = rosterCache || base;
      rosterCache = base.map((slot) => {
        const given = list.find((s) => s.id === slot.id);
        return given ? cleanSlot(given, slot) : current.find((s) => s.id === slot.id);
      });
      write(localStorage, KEY.roster, rosterCache);
    },
  };

  // The name to show for a participant: the name recorded with the result, then the
  // current roster name, then "Patient <number>".
  function displayName(entry) {
    if (entry && entry.name && String(entry.name).trim()) return String(entry.name).trim();
    const slot = roster.get(entry.id);
    return (slot && slot.name) || defaultName(entry.id);
  }

  // ---------- sessions ----------

  function newId(date, suffix) {
    const d = new Date(date);
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    return `S${stamp}-${suffix || Math.random().toString(36).slice(2, 6)}`;
  }

  // Sample results so the progress graphs have something to show on day one.
  function sampleExercise(w, p, k, rnd) {
    const habits = p.habits[w.exercise];
    const codes = Object.keys(CC.EXERCISES[w.exercise].faults);
    const quality = Math.round(clamp(p.quality + p.gain * k + p.offset[w.exercise] + gauss(rnd) * 5, 30, 98));
    const under = p.under * Math.max(0.2, 1 - k / 18);
    const done = [];
    for (let s = 0; s < w.sets; s++) {
      const r = rnd();
      if (r < under) done.push(Math.max(1, w.reps - 1 - Math.floor(rnd() * 3)));
      else if (r < under + p.over) done.push(w.reps + 1 + Math.floor(rnd() * 3));
      else done.push(w.reps);
    }
    const extra = rnd() < 0.03 ? 2 + Math.floor(rnd() * 4) : 0;
    const total = done.reduce((a, b) => a + b, 0) + extra;

    // Spread the weaker reps over this person's usual faults, plus the odd other one.
    const faults = {};
    let weak = Math.round(total * (1 - quality / 100) * 1.5);
    while (weak > 0) {
      const code = rnd() < 0.8 ? pick(habits, rnd) : pick(codes, rnd);
      const n = Math.min(weak, 1 + Math.floor(rnd() * 3));
      faults[code] = Math.min(total, (faults[code] || 0) + n);
      weak -= n;
    }
    const e = { exercise: w.exercise, sets: w.sets, reps: w.reps, done, extra, quality, faults };
    e.success = CC.score.exerciseSuccess(e);
    return e;
  }

  function skippedExercise(w) {
    return {
      exercise: w.exercise, sets: w.sets, reps: w.reps, done: new Array(w.sets).fill(0),
      extra: 0, quality: null, faults: {}, success: 0,
    };
  }

  function sampleResult(slot, p, k, rnd) {
    const last = slot.workout.length - 1;
    const exercises = slot.workout.map((w, i) =>
      i === last && last > 0 && rnd() < 0.05 ? skippedExercise(w) : sampleExercise(w, p, k, rnd));
    const score = CC.score;
    const repsDone = exercises.reduce((n, e) => n + score.repsDone(e), 0);
    let qualitySum = 0;
    exercises.forEach((e) => {
      if (e.quality != null) qualitySum += e.quality * score.repsDone(e);
    });
    const exertionAvg = round1(clamp(3 + rnd() * 2.5 + p.over * 6, 0, 10));
    return {
      id: slot.id,
      name: '',
      exercises,
      repsDone,
      repsPlanned: exercises.reduce((n, e) => n + score.planned(e), 0),
      setsDone: exercises.reduce((n, e) => n + e.done.filter((d) => d >= e.reps).length, 0),
      setsPlanned: exercises.reduce((n, e) => n + e.sets, 0),
      quality: repsDone ? Math.round(qualitySum / repsDone) : null,
      exertionAvg,
      exertionPeak: half(clamp(exertionAvg + 1 + rnd() * 2.5, 0, 10)),
      success: score.workoutSuccess(exercises),
    };
  }

  function sampleSessions() {
    const rnd = mulberry32(20261108);
    const slots = defaultRoster();
    const profiles = slots.map((slot, i) => {
      const habits = {};
      const offset = {};
      for (const w of slot.workout) {
        habits[w.exercise] = shuffle(Object.keys(CC.EXERCISES[w.exercise].faults), rnd).slice(0, 2);
        offset[w.exercise] = (rnd() - 0.5) * 12;
      }
      return {
        quality: 56 + rnd() * 26, // movement quality at the first session
        gain: 0.5 + rnd() * 1.5, // quality points gained per session
        attendance: i < 12 ? 0.82 + rnd() * 0.16 : 0.6 + rnd() * 0.3,
        joined: i < 12 ? 0 : Math.floor(rnd() * 7), // later slots joined part-way through
        under: 0.04 + rnd() * 0.22, // chance of stopping a set short
        over: rnd() * 0.14, // chance of going past a set
        habits,
        offset,
      };
    });

    // Tuesday and Thursday classes at 10:00, counting back from yesterday.
    const dates = [];
    const day = new Date();
    day.setHours(10, 0, 0, 0);
    while (dates.length < 14) {
      day.setDate(day.getDate() - 1);
      if (day.getDay() === 2 || day.getDay() === 4) dates.unshift(new Date(day.getTime()));
    }

    return dates.map((start, k) => {
      const participants = [];
      slots.forEach((slot, i) => {
        const p = profiles[i];
        if (k < p.joined || rnd() > p.attendance) return;
        participants.push(sampleResult(slot, p, k, rnd));
      });
      const minutes = 38 + Math.floor(rnd() * 12);
      return {
        id: newId(start, 'sample'),
        startedAt: start.toISOString(),
        endedAt: new Date(start.getTime() + minutes * 60000).toISOString(),
        sample: true,
        participants,
      };
    });
  }

  const validSession = (s) =>
    s && typeof s.id === 'string' && Array.isArray(s.participants) &&
    s.participants.every((p) => p && Array.isArray(p.exercises));

  let sessionCache = null;
  function loadSessions() {
    if (sessionCache) return sessionCache;
    if (localStorage.getItem(KEY.version) !== DATA_VERSION) {
      // Saved data from an older version can't be shown, so start again with sample data.
      write(localStorage, KEY.sessions, sampleSessions());
      localStorage.removeItem(KEY.live);
      localStorage.setItem(KEY.version, DATA_VERSION);
    }
    const list = read(localStorage, KEY.sessions, []);
    sessionCache = (Array.isArray(list) ? list : [])
      .filter(validSession)
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
    return sessionCache;
  }

  const sessions = {
    newId,
    all() {
      return loadSessions().slice();
    },
    get(id) {
      return loadSessions().find((s) => s.id === id) || null;
    },
    latest() {
      const list = loadSessions();
      return list[list.length - 1] || null;
    },
    add(session) {
      const list = loadSessions().concat([session]);
      sessionCache = list;
      return write(localStorage, KEY.sessions, list);
    },
    // Every session this participant was in, oldest first.
    historyFor(id) {
      return loadSessions()
        .map((session) => ({ session, result: session.participants.find((p) => p.id === id) }))
        .filter((entry) => entry.result);
    },
    latestFor(id) {
      const history = sessions.historyFor(id);
      return history.length ? history[history.length - 1].session : null;
    },
  };

  // ---------- live session ----------
  // While a session runs, the instructor's page writes every participant's block here
  // twice a second. Patient pages in the same browser read it to show their own block.
  // state is 'live', 'ended' (results saved) or 'abandoned' (the instructor left the page).
  const live = {
    key: KEY.live,
    read() {
      const v = read(localStorage, KEY.live, null);
      return v && typeof v === 'object' && typeof v.id === 'string' ? v : null;
    },
    write(state) {
      return write(localStorage, KEY.live, state);
    },
  };

  // ---------- profiles ----------
  // One per username: { bio, birthday: 'YYYY-MM-DD' or '', photo: data URL or '' }.
  // Photos are shrunk before saving (see profile.js) so they fit in localStorage.

  const BIO_MAX = 500;
  const PHOTO_MAX = 200000; // characters of data URL
  const profileKey = (username) => String(username || '').trim().toLowerCase();

  function cleanProfile(p) {
    p = p && typeof p === 'object' ? p : {};
    const birthday = /^\d{4}-\d{2}-\d{2}$/.test(p.birthday || '') ? p.birthday : '';
    const photo = typeof p.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(p.photo) && p.photo.length <= PHOTO_MAX
      ? p.photo : '';
    return { bio: String(p.bio || '').slice(0, BIO_MAX), birthday, photo };
  }

  const profiles = {
    BIO_MAX,
    get(username) {
      const all = read(localStorage, KEY.profiles, {});
      return cleanProfile(all && typeof all === 'object' ? all[profileKey(username)] : null);
    },
    save(username, profile) {
      const all = read(localStorage, KEY.profiles, {});
      const next = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
      next[profileKey(username)] = cleanProfile(profile);
      return write(localStorage, KEY.profiles, next);
    },
  };

  // ---------- misc ----------

  const store = {
    lastCount() {
      return read(localStorage, KEY.lastCount, null);
    },
    setLastCount(n) {
      write(localStorage, KEY.lastCount, n);
    },
    // Address of the live camera feed, kept for this browser tab. See README.
    feedUrl() {
      const given = CC.util.param('feed');
      if (given === 'off') sessionStorage.removeItem(KEY.feed);
      else if (given) sessionStorage.setItem(KEY.feed, given);
      return sessionStorage.getItem(KEY.feed);
    },
    // Deletes saved sessions and names, then the sample history is generated again.
    reset() {
      [KEY.roster, KEY.sessions, KEY.version, KEY.lastCount, KEY.live].forEach((k) => localStorage.removeItem(k));
      rosterCache = null;
      sessionCache = null;
    },
  };

  CC.MAX_PARTICIPANTS = MAX;
  CC.slotNumber = slotNumber;
  CC.defaultName = defaultName;
  CC.displayName = displayName;
  CC.auth = auth;
  CC.roster = roster;
  CC.sessions = sessions;
  CC.live = live;
  CC.store = store;
  CC.profiles = profiles;
})();
