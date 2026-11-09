/* Accounts, the class roster and saved sessions.
   Everything is kept in this browser (sessionStorage for the sign-in, localStorage for
   data) so the prototype runs without a server. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { mulberry32, gauss, clamp, round1, half, pad2, pick, shuffle, toInt } = CC.util;

  const MAX = 30;
  const DATA_VERSION = '1';
  const KEY = {
    auth: 'cccare.auth',
    feed: 'cccare.feed',
    roster: 'cccare.roster',
    sessions: 'cccare.sessions',
    version: 'cccare.version',
    lastCount: 'cccare.lastCount',
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

  const auth = {
    signIn(username, password) {
      const u = String(username || '').trim().toLowerCase();
      const account = ACCOUNTS.find((a) => a.username.toLowerCase() === u && a.password === password);
      if (!account) return null;
      const signedIn = { username: account.username, role: account.role, participantId: account.participantId || null };
      write(sessionStorage, KEY.auth, signedIn);
      return signedIn;
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

  // Every slot starts with a sample plan. Names start blank, and a blank name shows as
  // "Patient <number>".
  function defaultRoster() {
    const rnd = mulberry32(30);
    const codes = Object.keys(CC.EXERCISES);
    const list = [];
    for (let n = 1; n <= MAX; n++) {
      const exercise = codes[(n - 1) % codes.length];
      list.push({ id: pid(n), name: '', exercise, dose: pick(CC.EXERCISES[exercise].doses, rnd) });
    }
    return list;
  }

  function cleanSlot(slot, fallback) {
    return {
      id: fallback.id,
      name: String(slot.name || '').trim().slice(0, 40),
      exercise: CC.EXERCISES[slot.exercise] ? slot.exercise : fallback.exercise,
      dose: toInt(slot.dose, 1, 100, fallback.dose),
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
      return rosterCache.map((s) => Object.assign({}, s));
    },
    get(id) {
      return roster.all().find((s) => s.id === id) || null;
    },
    save(list) {
      const base = defaultRoster();
      rosterCache = base.map((slot) => {
        const given = list.find((s) => s.id === slot.id);
        return given ? cleanSlot(given, slot) : (rosterCache || base).find((s) => s.id === slot.id);
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
  function sampleResult(slot, p, k, rnd) {
    const ex = CC.EXERCISES[slot.exercise];
    const quality = Math.round(clamp(p.quality + p.gain * k + gauss(rnd) * 5, 30, 98));
    let reps = slot.dose;
    if (rnd() > Math.min(0.95, p.finish + k * 0.025)) {
      reps = rnd() < 0.65
        ? Math.max(1, Math.round(slot.dose * (0.5 + rnd() * 0.4)))
        : Math.round(slot.dose * (1.1 + rnd() * 0.3));
    }
    const exertionAvg = round1(clamp(3 + rnd() * 2.5 + (reps > slot.dose ? 1 : 0), 0, 10));
    const exertionPeak = half(clamp(exertionAvg + 1 + rnd() * 2.5, 0, 10));

    // Spread the weaker reps over this person's usual faults, plus the odd other one.
    const faults = {};
    const codes = Object.keys(ex.faults);
    let weak = Math.round(reps * (1 - quality / 100) * 1.5);
    while (weak > 0) {
      const code = rnd() < 0.8 ? pick(p.habits, rnd) : pick(codes, rnd);
      const n = Math.min(weak, 1 + Math.floor(rnd() * 3));
      faults[code] = Math.min(reps, (faults[code] || 0) + n);
      weak -= n;
    }
    return {
      id: slot.id, name: '', exercise: slot.exercise, dose: slot.dose, reps, quality,
      exertionAvg, exertionPeak, success: CC.score.success(reps, slot.dose, quality), faults,
    };
  }

  function sampleSessions() {
    const rnd = mulberry32(20261108);
    const slots = defaultRoster();
    const profiles = slots.map((slot, i) => ({
      quality: 56 + rnd() * 26, // movement quality at the first session
      gain: 0.5 + rnd() * 1.5, // quality points gained per session
      attendance: i < 12 ? 0.82 + rnd() * 0.16 : 0.6 + rnd() * 0.3,
      joined: i < 12 ? 0 : Math.floor(rnd() * 7), // later slots joined part-way through
      finish: 0.45 + rnd() * 0.4, // chance of doing exactly the dose
      habits: shuffle(Object.keys(CC.EXERCISES[slot.exercise].faults), rnd).slice(0, 2),
    }));

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
        mode: 'class',
        sample: true,
        participants,
      };
    });
  }

  let sessionCache = null;
  function loadSessions() {
    if (sessionCache) return sessionCache;
    if (localStorage.getItem(KEY.version) !== DATA_VERSION) {
      write(localStorage, KEY.sessions, sampleSessions());
      localStorage.setItem(KEY.version, DATA_VERSION);
    }
    const list = read(localStorage, KEY.sessions, []);
    sessionCache = (Array.isArray(list) ? list : [])
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.participants))
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
      [KEY.roster, KEY.sessions, KEY.version, KEY.lastCount].forEach((k) => localStorage.removeItem(k));
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
  CC.store = store;
})();
