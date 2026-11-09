/* How a workout is scored, and the live state kept for each participant. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { clamp, round1, mean, fmtExertion, fmtDuration, fmtClock, plural } = CC.util;

  const LIMITS = {
    exertionHigh: 8, // 0–10 scale. 8 and above is "very hard".
    idleSeconds: 25, // flag anyone mid-set (or not started) with no rep for this long
    // Rest after a finished set is set per exercise by the instructor (CC.restOf); the
    // no-rep flag waits that long plus idleSeconds.
    setGapSeconds: 15, // a pause at least this long ends a set, so the next rep starts the next set
    faultHoldSeconds: 10, // a form fault stays on screen this long after it was seen
    recentReps: 5, // the quality figure on each block is the average of the last five reps
    errorReps: 2, // a form fault, or going over the planned reps, only counts once at least this many reps show it
  };

  // ---------- scoring ----------
  // An exercise result is { sets, reps, done: [reps done in each set], extra, quality }.
  // extra counts reps done after the last planned set.

  const planned = (e) => e.sets * e.reps;
  const setsDone = (e) => e.done.filter((d) => d >= e.reps).length;
  const repsDone = (e) => e.done.reduce((a, b) => a + b, 0) + (e.extra || 0);

  // Share of the planned reps done as planned, 0–1. Every rep short of a set and every rep
  // past it counts against it.
  function adherence(e) {
    const p = planned(e);
    if (!p) return 0;
    let off = e.extra || 0;
    for (let k = 0; k < e.sets; k++) off += Math.abs((e.done[k] || 0) - e.reps);
    return clamp(1 - off / p, 0, 1);
  }

  // Exercise success, 0–100: adherence times the average movement quality of its reps.
  const exerciseValue = (e) => (e.quality == null || !repsDone(e) ? 0 : adherence(e) * e.quality);
  const exerciseSuccess = (e) => Math.round(exerciseValue(e));

  // Workout success, 0–100: the exercises' success weighted by how many reps each one plans.
  function workoutSuccess(list) {
    let num = 0;
    let den = 0;
    for (const e of list) {
      num += exerciseValue(e) * planned(e);
      den += planned(e);
    }
    return den ? Math.round(num / den) : 0;
  }

  // Colour of a saved result's wheel, 0–100: the plain average of each exercise's success.
  // The wheel's fill still shows overall success; its colour shows how well each exercise
  // went on average, so one long exercise doesn't outweigh the others.
  function colorScore(list) {
    if (!list || !list.length) return null;
    return Math.round(mean(list.map((e) => exerciseValue(e))));
  }

  // ---------- live tracker ----------

  class Tracker {
    // speed is above 1 when the simulator runs faster than real time; waits scale with it.
    constructor(slot, startedAt, speed) {
      this.id = slot.id;
      this.name = slot.name;
      this.speed = speed || 1;
      this.plan = slot.workout.map((w) => ({
        exercise: w.exercise,
        sets: w.sets,
        reps: w.reps,
        rest: CC.restOf(w),
        done: new Array(w.sets).fill(0),
        extra: 0,
        qualities: [],
        faults: {},
      }));
      this.ex = 0; // current exercise
      this.set = 0; // current set; equals the exercise's set count once past its last set
      this.reps = 0;
      this.recent = [];
      this.currentFaults = [];
      this.faultsAt = -Infinity;
      this.exertion = null;
      this.exertionSum = 0;
      this.exertionCount = 0;
      this.exertionPeak = null;
      this.lastRepAt = startedAt;
    }

    seconds(since, now) {
      return Math.max(0, ((now - since) / 1000) * this.speed);
    }

    // Where the next rep goes. A pause of setGapSeconds or more after a rep starts a new set.
    // When the camera pipeline names the exercise, a different exercise moves straight to it.
    nextPosition(exercise, now) {
      const plan = this.plan;
      if (exercise && plan[this.ex].exercise !== exercise) {
        const matches = plan.map((_, i) => i).filter((i) => plan[i].exercise === exercise);
        if (matches.length) {
          const open = matches.find((i) => plan[i].done.includes(0));
          const ex = open == null ? matches[0] : open;
          const set = plan[ex].done.indexOf(0);
          return { ex, set: set === -1 ? plan[ex].sets : set };
        }
      }
      const e = plan[this.ex];
      const started = this.set >= e.sets || e.done[this.set] > 0;
      if (!this.reps || !started || this.seconds(this.lastRepAt, now) < LIMITS.setGapSeconds) {
        return { ex: this.ex, set: this.set };
      }
      if (this.set + 1 < e.sets) return { ex: this.ex, set: this.set + 1 };
      if (!exercise && this.ex + 1 < plan.length) return { ex: this.ex + 1, set: 0 };
      return { ex: this.ex, set: e.sets };
    }

    // Events come from the simulator or the live socket, already validated by feed.js.
    apply(event, now) {
      if (event.type === 'rep') {
        const pos = this.nextPosition(event.exercise, now);
        this.ex = pos.ex;
        this.set = pos.set;
        const e = this.plan[this.ex];
        if (this.set < e.sets) e.done[this.set] += 1;
        else e.extra += 1;
        e.qualities.push(event.quality);
        for (const code of new Set(event.faults)) e.faults[code] = (e.faults[code] || 0) + 1;
        this.recent.push(event.quality);
        if (this.recent.length > LIMITS.recentReps) this.recent.shift();
        this.reps += 1;
        this.currentFaults = event.faults.slice(0, 3);
        this.faultsAt = now;
        this.lastRepAt = now;
      } else if (event.type === 'faults') {
        this.currentFaults = event.faults.slice(0, 3);
        this.faultsAt = now;
      } else if (event.type === 'exertion') {
        this.exertion = event.value;
        this.exertionSum += event.value;
        this.exertionCount += 1;
        this.exertionPeak = Math.max(this.exertionPeak == null ? 0 : this.exertionPeak, event.value);
      }
    }

    current() {
      return this.plan[this.ex];
    }
    // The current set has reached its reps (or they're past the exercise's last set).
    setFinished() {
      const e = this.current();
      return this.set >= e.sets || e.done[this.set] >= e.reps;
    }
    // Reached the end: the last set of the last exercise is finished.
    complete() {
      const last = this.plan.length - 1;
      return this.reps > 0 && this.ex === last && this.setFinished() && this.set >= this.plan[last].sets - 1;
    }
    // Rest after each set of the current exercise, as the instructor set it.
    restSeconds() {
      return this.current().rest;
    }
    restLeft(now) {
      if (!this.reps || !this.setFinished() || this.complete()) return 0;
      return Math.max(0, this.restSeconds() - this.seconds(this.lastRepAt, now));
    }

    // How well each exercise is going so far, averaged over the exercises, 0–100, or null
    // before the first rep. Unlike success it doesn't count reps not done yet: only sets
    // already finished (or passed) count toward adherence, so a good start shows green.
    performance() {
      const values = this.plan.map((_, i) => this.exercisePerformance(i)).filter((v) => v != null);
      return values.length ? Math.round(mean(values)) : null;
    }

    // The same for one exercise, or null if it hasn't been reached.
    exercisePerformance(i) {
      const e = this.plan[i];
      const started = e.qualities.length > 0;
      if (!started) return i >= this.ex ? null : 0; // not reached yet, or passed without doing any
      let off = e.extra;
      let count = 0;
      e.done.forEach((d, k) => {
        const inProgress = i === this.ex && k === this.set && d < e.reps;
        if (inProgress || (d === 0 && i >= this.ex)) return;
        off += Math.abs(d - e.reps);
        count += 1;
      });
      const adh = count ? clamp(1 - off / (count * e.reps), 0, 1) : 1;
      return Math.round(adh * mean(e.qualities));
    }

    // The current exercise for the big wheel: which set it's on and the reps in that set.
    currentSet() {
      const e = this.current();
      const r = this.exerciseResult(e);
      const extra = this.set >= e.sets;
      return {
        exercise: e.exercise,
        sets: e.sets,
        reps: e.reps,
        set: Math.min(this.set, e.sets - 1) + 1,
        inSet: extra ? e.done[e.sets - 1] : e.done[this.set],
        extra: e.extra,
        setsDone: setsDone(r),
        success: r.success,
        color: this.exercisePerformance(this.ex),
      };
    }

    // Short state for the corner of the block.
    head(now) {
      if (this.complete()) return 'done';
      if (!this.reps) return 'starting';
      const rest = this.restLeft(now);
      if (rest > 0) return 'rest ' + fmtClock(rest * 1000);
      const pos = this.setFinished() ? this.nextPosition(null, Infinity) : { ex: this.ex, set: this.set };
      const e = this.plan[pos.ex];
      return pos.set < e.sets ? `set ${pos.set + 1} of ${e.sets}` : 'extra reps';
    }

    // Shown along the bottom of the block when nothing needs attention.
    status() {
      if (this.complete()) return 'Workout complete';
      if (!this.reps) return 'Waiting for the first rep';
      if (this.setFinished()) {
        const next = this.nextPosition(null, Infinity);
        const e = this.plan[next.ex];
        if (next.ex !== this.ex) return `Rest, then ${CC.exerciseName(e.exercise).toLowerCase()}`;
        if (next.set < e.sets) return `Rest, then set ${next.set + 1} of ${e.sets}`;
        return 'Rest';
      }
      return 'Form looks good';
    }

    // What needs attention right now, most urgent first. Each item is { message, cue }.
    issues(now) {
      const list = [];
      const e = this.current();
      const finished = this.complete();
      if (this.exertion != null && this.exertion >= LIMITS.exertionHigh) {
        list.push({ message: `Very hard effort, ${fmtExertion(this.exertion)} of 10`, cue: 'Slow down or take a rest.' });
      }
      if (this.set < e.sets && e.done[this.set] - e.reps >= LIMITS.errorReps) {
        const over = e.done[this.set] - e.reps;
        list.push({
          message: `${plural(over, 'rep')} over in set ${this.set + 1} (${e.done[this.set]} of ${e.reps})`,
          cue: 'That’s the end of this set. Stop and rest.',
        });
      } else if (this.set >= e.sets && e.extra >= LIMITS.errorReps) {
        list.push({
          message: `${plural(e.extra, 'rep')} past the last set`,
          cue: finished ? 'That’s the whole workout. Time to stop and rest.' : 'This exercise is finished. Rest, then move on.',
        });
      }
      if (this.seconds(this.faultsAt, now) <= LIMITS.faultHoldSeconds) {
        // A fault is only shown once it has been seen on at least errorReps reps of this exercise.
        for (const code of this.currentFaults.filter((c) => (e.faults[c] || 0) >= LIMITS.errorReps)) {
          const f = CC.fault(e.exercise, code);
          list.push({ message: f.message, cue: f.cue });
        }
      }
      if (!finished) {
        const idle = this.seconds(this.lastRepAt, now);
        const allowed = this.reps && this.setFinished() ? this.restSeconds() + LIMITS.idleSeconds : LIMITS.idleSeconds;
        if (idle >= allowed) list.push({ message: `No reps for ${fmtDuration(idle)}`, cue: 'Carry on when you’re ready.' });
      }
      return list;
    }

    exerciseResult(e) {
      const r = {
        exercise: e.exercise,
        sets: e.sets,
        reps: e.reps,
        done: e.done.slice(),
        extra: e.extra,
        quality: e.qualities.length ? Math.round(mean(e.qualities)) : null,
        faults: Object.assign({}, e.faults),
      };
      r.success = exerciseSuccess(r);
      return r;
    }

    success() {
      return workoutSuccess(this.plan.map((e) => this.exerciseResult(e)));
    }

    // Everything a block needs to draw itself. The patient's screen gets the same object.
    snapshot(now) {
      const finished = this.complete();
      return {
        id: this.id,
        name: this.name,
        success: this.success(),
        color: this.performance(),
        resting: this.restLeft(now) > 0,
        repsDone: this.reps,
        repsPlanned: this.plan.reduce((n, e) => n + planned(e), 0),
        setsDone: this.plan.reduce((n, e) => n + setsDone(e), 0),
        setsPlanned: this.plan.reduce((n, e) => n + e.sets, 0),
        now: this.currentSet(),
        quality: this.recent.length ? Math.round(mean(this.recent)) : null,
        exertion: this.exertion,
        head: this.head(now),
        status: this.status(),
        exercises: this.plan.map((e, i) => {
          const r = this.exerciseResult(e);
          return {
            exercise: e.exercise, sets: e.sets, reps: e.reps,
            done: repsDone(r), planned: planned(r), success: r.success, setsDone: setsDone(r),
            current: !finished && i === this.ex,
          };
        }),
        issues: this.issues(now),
      };
    }

    // Where this person was when the session ended, or null if they had finished.
    stoppedAt() {
      if (this.complete()) return null;
      const e = this.current();
      return {
        exercise: e.exercise,
        exerciseNumber: this.ex + 1,
        exercises: this.plan.length,
        set: Math.min(this.set, e.sets - 1) + 1,
        sets: e.sets,
        inSet: this.set < e.sets ? e.done[this.set] : e.done[e.sets - 1],
        reps: e.reps,
        resting: this.reps > 0 && this.setFinished(), // between sets: that set was finished
      };
    }

    // The saved result. When the session ended before this person finished, only what they
    // reached counts: the exercises up to the current one, and its sets up to the current
    // set. Exercises they never got to aren't counted against them.
    result() {
      const stop = this.stoppedAt();
      let plan = this.plan;
      if (stop) {
        plan = this.plan.slice(0, this.ex + 1).map((e, i) => {
          if (i < this.ex) return e;
          const keep = Math.min(e.sets, this.set + 1);
          return Object.assign({}, e, { sets: keep, done: e.done.slice(0, keep) });
        });
      }
      const exercises = plan.map((e) => this.exerciseResult(e));
      const all = plan.flatMap((e) => e.qualities);
      return {
        id: this.id,
        name: this.name,
        stoppedAt: stop,
        exercisesPlanned: this.plan.length,
        exercises,
        repsDone: this.reps,
        repsPlanned: exercises.reduce((n, e) => n + planned(e), 0),
        setsDone: exercises.reduce((n, e) => n + setsDone(e), 0),
        setsPlanned: exercises.reduce((n, e) => n + e.sets, 0),
        quality: all.length ? Math.round(mean(all)) : null,
        exertionAvg: this.exertionCount ? round1(this.exertionSum / this.exertionCount) : null,
        exertionPeak: this.exertionPeak,
        success: workoutSuccess(exercises),
      };
    }
  }

  CC.LIMITS = LIMITS;
  CC.score = { planned, repsDone, setsDone, adherence, exerciseSuccess, workoutSuccess, colorScore };
  CC.Tracker = Tracker;
})();
