/* Where live exercise data comes from.

   Both sources produce the same events:
     { type: 'rep',      pid: 'P03', quality: 82, faults: ['knees_in'] }  one finished repetition, quality 0–100
     { type: 'exertion', pid: 'P03', value: 6 }                           exertion, 0–10
     { type: 'faults',   pid: 'P03', faults: ['knees_in'] }               form feedback between reps (optional)

   With ?feed=ws://host:port in the page address, events come from the camera pipeline
   over a WebSocket. Otherwise a simulator makes them up. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { clamp, gauss, half, pick, shuffle } = CC.util;

  // ---------- validation of incoming messages ----------

  function toPid(v) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= CC.MAX_PARTICIPANTS) return 'P' + String(v).padStart(2, '0');
    const s = String(v == null ? '' : v).trim().toUpperCase();
    const m = /^P?(\d{1,2})$/.exec(s);
    return m ? 'P' + m[1].padStart(2, '0') : null;
  }
  function toFaults(v) {
    if (!Array.isArray(v)) return [];
    return v.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim().slice(0, 60)).slice(0, 3);
  }
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const pid = toPid(raw.pid);
    if (!pid) return null;
    if (raw.type === 'rep') {
      const q = num(raw.quality);
      return q == null ? null : { type: 'rep', pid, quality: clamp(q, 0, 100), faults: toFaults(raw.faults) };
    }
    if (raw.type === 'exertion') {
      const v = num(raw.value);
      return v == null ? null : { type: 'exertion', pid, value: clamp(v, 0, 10) };
    }
    if (raw.type === 'faults') return { type: 'faults', pid, faults: toFaults(raw.faults) };
    return null;
  }

  // ---------- simulator ----------

  // plan: 'complete' stops at the dose, 'under' stops early, 'over' keeps going past it.
  function choosePlan(rnd, weights) {
    const r = rnd();
    if (r < weights.complete) return 'complete';
    return r < weights.complete + weights.under ? 'under' : 'over';
  }

  function simulated(slots, emit, opts) {
    const speed = clamp(Number(opts.speed) || 1, 0.25, 20);
    const weights = opts.planWeights || { complete: 0.62, under: 0.22, over: 0.16 };
    const rnd = Math.random;
    let timer = null;

    const people = slots.map((slot) => {
      const codes = Object.keys(CC.EXERCISES[slot.exercise].faults);
      const plan = choosePlan(rnd, weights);
      const stopAt =
        plan === 'under' ? Math.max(2, Math.round(slot.dose * (0.5 + rnd() * 0.35)))
          : plan === 'over' ? Math.round(slot.dose * (1.1 + rnd() * 0.25)) + 1
            : slot.dose;
      const exBase = 1.5 + rnd() * 1.5;
      const exAtDose = plan === 'over' ? 6.5 + rnd() * 1.2 : 4 + rnd() * 2.5;
      return {
        id: slot.id,
        dose: slot.dose,
        stopAt,
        tempo: 2.8 + rnd() * 2.6, // seconds per rep
        quality: 66 + rnd() * 28, // typical movement quality
        fatigue: 4 + rnd() * 14, // quality points lost by the end of the dose
        habits: shuffle(codes, rnd).slice(0, 2),
        codes,
        exBase,
        exGain: (exAtDose - exBase) / slot.dose,
        exertion: exBase,
        reps: 0,
        nextAt: 0,
      };
    });

    function step(p, now) {
      if (now < p.nextAt) return;
      if (p.reps >= p.stopAt) {
        // Stopped: exertion comes back down while they rest.
        if (p.exertion > p.exBase + 0.25) {
          p.exertion = Math.max(p.exBase, p.exertion - 0.5);
          emit({ type: 'exertion', pid: p.id, value: half(p.exertion) });
        }
        p.nextAt = now + 5000 / speed;
        return;
      }
      p.reps += 1;
      const q = Math.round(clamp(p.quality - p.fatigue * (p.reps / p.dose) + gauss(rnd) * 7, 15, 100));
      const faults = [];
      if (q < 72) faults.push(rnd() < 0.8 ? pick(p.habits, rnd) : pick(p.codes, rnd));
      if (q < 55) {
        const second = pick(p.codes, rnd);
        if (!faults.includes(second)) faults.push(second);
      }
      emit({ type: 'rep', pid: p.id, quality: q, faults });
      p.exertion = clamp(p.exBase + p.exGain * p.reps + gauss(rnd) * 0.35, 0, 10);
      emit({ type: 'exertion', pid: p.id, value: half(p.exertion) });
      let gap = p.tempo * (0.85 + rnd() * 0.3);
      if (rnd() < 0.05) gap += 5 + rnd() * 8; // a short break
      p.nextAt = now + (gap * 1000) / speed;
    }

    return {
      label: speed === 1 ? 'simulated' : `simulated ×${speed}`,
      start() {
        const now = Date.now();
        people.forEach((p) => (p.nextAt = now + ((1 + rnd() * 4) * 1000) / speed));
        timer = setInterval(() => {
          const now = Date.now();
          people.forEach((p) => step(p, now));
        }, 200);
      },
      stop() {
        clearInterval(timer);
        timer = null;
      },
    };
  }

  // ---------- live WebSocket feed ----------

  function socket(url, slots, emit, onStatus) {
    const wanted = new Set(slots.map((s) => s.id));
    let ws = null;
    let stopped = false;
    let retries = 0;
    let retryTimer = null;

    const send = (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    function connect() {
      onStatus('connecting');
      try {
        ws = new WebSocket(url);
      } catch (e) {
        onStatus('could not open');
        return;
      }
      ws.onopen = () => {
        retries = 0;
        onStatus('connected');
        // Lets the pipeline know which stations are in this session.
        send({ type: 'session', state: 'start', participants: [...wanted] });
      };
      ws.onmessage = (m) => {
        if (typeof m.data !== 'string' || m.data.length > 100000) return;
        let data;
        try {
          data = JSON.parse(m.data);
        } catch (e) {
          return;
        }
        (Array.isArray(data) ? data : [data]).forEach((raw) => {
          const ev = normalize(raw);
          if (ev && wanted.has(ev.pid)) emit(ev);
        });
      };
      ws.onclose = () => {
        if (stopped) return;
        onStatus('reconnecting');
        retryTimer = setTimeout(connect, Math.min(10000, 1000 * 2 ** retries++));
      };
    }

    return {
      label: 'live',
      start: connect,
      stop() {
        stopped = true;
        clearTimeout(retryTimer);
        send({ type: 'session', state: 'end' });
        if (ws) ws.close();
      },
    };
  }

  CC.feed = {
    normalize,
    // slots: participants in this session. emit(event) is called for each event.
    // onStatus(text) reports the socket state. opts: { speed, planWeights }.
    create(slots, emit, onStatus, opts) {
      opts = opts || {};
      const address = CC.store.feedUrl();
      if (address) {
        try {
          const u = new URL(address);
          if (u.protocol === 'ws:' || u.protocol === 'wss:') return socket(u.href, slots, emit, onStatus);
        } catch (e) {
          /* not a valid address: fall back to the simulator */
        }
        const sim = simulated(slots, emit, Object.assign({ speed: CC.util.param('speed') }, opts));
        sim.label = 'simulated (feed address not valid)';
        return sim;
      }
      return simulated(slots, emit, Object.assign({ speed: CC.util.param('speed') }, opts));
    },
  };
})();
