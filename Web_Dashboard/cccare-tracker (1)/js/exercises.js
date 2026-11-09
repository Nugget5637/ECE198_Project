/* Exercises, the form faults the camera pipeline can report for each one, and the sample
   workouts every participant starts with.
   The pipeline sends a fault code (for example "knees_in"). The dashboard shows the
   message, and the patient's screen also shows the cue. Codes that aren't listed here are
   shown as plain text. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});

  CC.EXERCISES = {
    sit_to_stand: {
      name: 'Sit-to-stand',
      faults: {
        knees_in: { message: 'Knees caving inward on the way up', cue: 'Keep your knees in line with your toes.' },
        lean_forward: { message: 'Leaning too far forward', cue: 'Lift your chest as you stand.' },
        half_stand: { message: 'Not standing all the way up', cue: 'Stand all the way up before you sit back down.' },
        arm_push: { message: 'Pushing off the thighs with the hands', cue: 'Cross your arms over your chest if you can.' },
        drop_sit: { message: 'Dropping into the chair', cue: 'Sit down slowly, over about three seconds.' },
      },
    },
    mini_squat: {
      name: 'Mini squat',
      faults: {
        knees_in: { message: 'Knees caving inward', cue: 'Push your knees out over your toes.' },
        heels_up: { message: 'Heels lifting off the floor', cue: 'Keep your weight back through your heels.' },
        back_round: { message: 'Back rounding forward', cue: 'Keep your back straight and your chest up.' },
        shallow: { message: 'Not bending far enough', cue: 'Bend a little deeper, as far as is comfortable.' },
      },
    },
    wall_pushup: {
      name: 'Wall push-up',
      faults: {
        hips_sag: { message: 'Hips sagging toward the wall', cue: 'Keep a straight line from your head to your heels.' },
        elbows_flare: { message: 'Elbows flaring out wide', cue: 'Keep your elbows angled back, close to your body.' },
        short_range: { message: 'Elbows not bending enough', cue: 'Bring your chest closer to the wall.' },
        head_drop: { message: 'Head dropping forward', cue: 'Keep your head in line with your body.' },
      },
    },
    bicep_curl: {
      name: 'Bicep curl',
      faults: {
        swing: { message: 'Swinging the body to lift the weight', cue: 'Keep your body still and let your arms do the work.' },
        elbow_drift: { message: 'Elbows drifting forward', cue: 'Keep your elbows by your sides.' },
        short_range: { message: 'Arms not straightening at the bottom', cue: 'Lower the weight all the way down.' },
        too_fast: { message: 'Lifting too fast', cue: 'Slow down. Two seconds up, two seconds down.' },
      },
    },
    arm_raise: {
      name: 'Front arm raise',
      faults: {
        shrug: { message: 'Shoulders shrugging toward the ears', cue: 'Relax your shoulders down.' },
        low_raise: { message: 'Arms not reaching shoulder height', cue: 'Lift to shoulder height if you can.' },
        bent_elbows: { message: 'Elbows bending during the lift', cue: 'Keep your arms long, with a soft elbow.' },
        lean_back: { message: 'Leaning back', cue: 'Stand tall and keep your ribs down.' },
      },
    },
    heel_raise: {
      name: 'Heel raise',
      faults: {
        low_rise: { message: 'Heels not lifting fully', cue: 'Rise as high onto your toes as you can.' },
        lean_forward: { message: 'Leaning forward', cue: 'Keep your body upright.' },
        sway: { message: 'Swaying side to side', cue: 'Hold the chair back lightly for balance.' },
        drop: { message: 'Dropping the heels quickly', cue: 'Lower your heels slowly.' },
      },
    },
  };

  // Faults any exercise can report.
  const GENERIC = {
    too_fast: { message: 'Moving too fast', cue: 'Slow down. Count two seconds each way.' },
    off_camera: { message: 'Partly out of the camera view', cue: 'Step back into the camera view.' },
  };

  // Sample workouts. Participant 1 gets the first, participant 2 the second, and so on.
  CC.WORKOUTS = [
    [
      { exercise: 'sit_to_stand', sets: 2, reps: 10 },
      { exercise: 'wall_pushup', sets: 2, reps: 8 },
      { exercise: 'heel_raise', sets: 2, reps: 12 },
    ],
    [
      { exercise: 'mini_squat', sets: 2, reps: 10 },
      { exercise: 'bicep_curl', sets: 2, reps: 10 },
      { exercise: 'arm_raise', sets: 2, reps: 8 },
    ],
    [
      { exercise: 'sit_to_stand', sets: 3, reps: 8 },
      { exercise: 'heel_raise', sets: 2, reps: 15 },
    ],
    [
      { exercise: 'wall_pushup', sets: 2, reps: 10 },
      { exercise: 'mini_squat', sets: 2, reps: 12 },
      { exercise: 'bicep_curl', sets: 2, reps: 12 },
    ],
  ];

  // Largest workout the set-up screen allows.
  CC.WORKOUT_LIMITS = { exercises: 8, sets: 10, reps: 100 };

  CC.exerciseName = (code) => (CC.EXERCISES[code] ? CC.EXERCISES[code].name : String(code));

  // "Sit-to-stand 2×10, Wall push-up 2×8". With long = true: "Sit-to-stand, 2 sets of 10".
  CC.describeWorkout = function (workout, long) {
    return workout
      .map((w) => (long
        ? `${CC.exerciseName(w.exercise)}, ${w.sets} ${w.sets === 1 ? 'set' : 'sets'} of ${w.reps}`
        : `${CC.exerciseName(w.exercise)} ${w.sets}×${w.reps}`))
      .join(long ? '; ' : ', ');
  };

  CC.fault = function (exercise, code) {
    const ex = CC.EXERCISES[exercise];
    const found = (ex && ex.faults[code]) || GENERIC[code];
    if (found) return Object.assign({ code }, found);
    const text = String(code).replace(/_/g, ' ').trim().slice(0, 80);
    return { code, message: text.charAt(0).toUpperCase() + text.slice(1), cue: '' };
  };
})();
