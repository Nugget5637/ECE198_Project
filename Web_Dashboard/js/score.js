/* How a session is scored, and the live state kept for each participant. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});
  const { clamp, round1, mean, fmtExertion, plural } = CC.util;

  const LIMITS = {
    exertionHigh: 8, // 0–10 scale. 8 and above is "very hard".
    idleSeconds: 25, // flag anyone with no rep for this long before their dose is done
    faultHoldSeconds: 10, // a form fault stays on screen this long after it was seen
    recentReps: 5, // the wheel colour follows the quality of the last five reps
  };

  // Success, 0–100: how close the reps came to the dose, times average movement quality.
  //   20 of 20 reps at 85% quality      -> 85%
  //   15 of 20, or 25 of 20, at 85%     -> 64%   (stopping short and overdoing it cost the same)
  function adherence(reps, dose) {
    if (!dose) return 0;
    return clamp(1 - Math.abs(reps - dose) / dose, 0, 1);
  }
  function success(reps, dose, quality) {
    if (!reps || quality == null) return 0;
    return Math.round(adherence(reps, dose) * quality);
  }

  class Tracker {
    constructor(slot, startedAt) {
      this.id = slot.id;
      this.name = slot.name;
      this.exercise = slot.exercise;
      this.dose = slot.dose;
      this.reps = 0;
      this.qualities = [];
      this.faultCounts = {};
      this.currentFaults = [];
      this.faultsAt = 0;
      this.exertion = null;
      this.exertionSum = 0;
      this.exertionCount = 0;
      this.exertionPeak = null;
      this.lastRepAt = startedAt;
    }

    // Events come from the simulator or the live socket, already validated by feed.js.
    apply(event, now) {
      if (event.type === 'rep') {
        this.reps += 1;
        this.qualities.push(event.quality);
        this.currentFaults = event.faults.slice(0, 3);
        this.faultsAt = now;
        for (const code of new Set(event.faults)) this.faultCounts[code] = (this.faultCounts[code] || 0) + 1;
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

    quality() {
      return this.qualities.length ? Math.round(mean(this.qualities)) : null;
    }
    recentQuality() {
      const last = this.qualities.slice(-LIMITS.recentReps);
      return last.length ? Math.round(mean(last)) : null;
    }
    success() {
      return success(this.reps, this.dose, this.quality());
    }

    // What needs attention right now, most urgent first.
    issues(now) {
      const list = [];
      if (this.exertion != null && this.exertion >= LIMITS.exertionHigh) {
        list.push({ part: 'Exertion', issue: `${fmtExertion(this.exertion)} of 10, very hard`, cue: 'Slow down or take a rest.' });
      }
      if (this.reps > this.dose) {
        list.push({
          part: 'Dose',
          issue: `${plural(this.reps - this.dose, 'rep')} over (${this.reps} of ${this.dose})`,
          cue: 'That’s your full dose. Time to stop and rest.',
        });
      }
      if (now - this.faultsAt <= LIMITS.faultHoldSeconds * 1000) {
        for (const code of this.currentFaults) list.push(CC.fault(this.exercise, code));
      }
      const idle = Math.floor((now - this.lastRepAt) / 1000);
      if (this.reps < this.dose && idle >= LIMITS.idleSeconds) {
        list.push({
          part: 'Pace',
          issue: this.reps ? `no reps for ${idle} s` : `not started after ${idle} s`,
          cue: 'Carry on when you’re ready.',
        });
      }
      return list;
    }

    result() {
      return {
        id: this.id,
        name: this.name,
        exercise: this.exercise,
        dose: this.dose,
        reps: this.reps,
        quality: this.quality(),
        exertionAvg: this.exertionCount ? round1(this.exertionSum / this.exertionCount) : null,
        exertionPeak: this.exertionPeak,
        success: this.success(),
        faults: Object.assign({}, this.faultCounts),
      };
    }
  }

  CC.LIMITS = LIMITS;
  CC.score = { adherence, success };
  CC.Tracker = Tracker;
})();
