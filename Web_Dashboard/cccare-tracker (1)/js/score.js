/* How a workout is scored, and the live state kept for each participant. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { clamp, round1, mean, fmtExertion, fmtDuration, fmtClock, plural } = CC.util;

  const LIMITS = {
    exertionHigh: 8, // 0–10 scale. 8 and above is "very hard".
    idleSeconds: 25, // flag anyone mid-set (or not started) with no rep for this long
    restSeconds: 45, // planned rest after a finished set; the no-rep flag waits this much longer
    setGapSeconds: 15, // a pause at least this long ends a set, so the next rep starts the next set
    faultHoldSeconds: 10, // a form fault stays on screen this long after it was seen
    recentReps: 5, // the quality figure on each block is the average of the last five reps
  };

  // ---------- scoring ----------
  // An exercise result is { sets, reps, done: [reps done in each set], extra, quality }.
  // extra counts reps done after the last planned set.

  const planned = (e) => e.sets * e.reps;
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
    restLeft(now) {
      if (!this.reps || !this.setFinished() || this.complete()) return 0;
      return Math.max(0, LIMITS.restSeconds - this.seconds(this.lastRepAt, now));
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
      if (this.set < e.sets && e.done[this.set] > e.reps) {
        const over = e.done[this.set] - e.reps;
        list.push({
          message: `${plural(over, 'rep')} over in set ${this.set + 1} (${e.done[this.set]} of ${e.reps})`,
          cue: 'That’s the end of this set. Stop and rest.',
        });
      } else if (this.set >= e.sets && e.extra > 0) {
        list.push({
          message: `${plural(e.extra, 'rep')} past the last set`,
          cue: finished ? 'That’s the whole workout. Time to stop and rest.' : 'This exercise is finished. Rest, then move on.',
        });
      }
      if (this.seconds(this.faultsAt, now) <= LIMITS.faultHoldSeconds) {
        for (const code of this.currentFaults) {
          const f = CC.fault(e.exercise, code);
          list.push({ message: f.message, cue: f.cue });
        }
      }
      if (!finished) {
        const idle = this.seconds(this.lastRepAt, now);
        const allowed = this.reps && this.setFinished() ? LIMITS.restSeconds + LIMITS.idleSeconds : LIMITS.idleSeconds;
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
        repsDone: this.reps,
        repsPlanned: this.plan.reduce((n, e) => n + planned(e), 0),
        quality: this.recent.length ? Math.round(mean(this.recent)) : null,
        exertion: this.exertion,
        head: this.head(now),
        status: this.status(),
        exercises: this.plan.map((e, i) => {
          const r = this.exerciseResult(e);
          return {
            exercise: e.exercise, sets: e.sets, reps: e.reps,
            done: repsDone(r), planned: planned(r), success: r.success,
            current: !finished && i === this.ex,
          };
        }),
        issues: this.issues(now),
      };
    }

    result() {
      const exercises = this.plan.map((e) => this.exerciseResult(e));
      const all = this.plan.flatMap((e) => e.qualities);
      return {
        id: this.id,
        name: this.name,
        exercises,
        repsDone: this.reps,
        repsPlanned: exercises.reduce((n, e) => n + planned(e), 0),
        setsDone: exercises.reduce((n, e) => n + e.done.filter((d) => d >= e.reps).length, 0),
        setsPlanned: exercises.reduce((n, e) => n + e.sets, 0),
        quality: all.length ? Math.round(mean(all)) : null,
        exertionAvg: this.exertionCount ? round1(this.exertionSum / this.exertionCount) : null,
        exertionPeak: this.exertionPeak,
        success: workoutSuccess(exercises),
      };
    }
  }

  CC.LIMITS = LIMITS;
  CC.score = { planned, repsDone, adherence, exerciseSuccess, workoutSuccess };
  CC.Tracker = Tracker;
})();
