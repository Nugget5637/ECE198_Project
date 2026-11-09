/* Exercises and the form faults the camera pipeline can report for each one.
   Each fault has the body part, what is going wrong, and a cue the patient can act on.
   The pipeline sends the fault code (for example "knees_in"); anything it sends that is
   not listed here is shown as plain text. */
(function () {
  'use strict';
  const CC = (window.CC = window.CC || {});

  CC.EXERCISES = {
    sit_to_stand: {
      name: 'Sit-to-stand',
      doses: [10, 12, 15],
      faults: {
        knees_in: { part: 'Knees', issue: 'caving inward on the way up', cue: 'Keep your knees in line with your toes.' },
        lean_forward: { part: 'Trunk', issue: 'leaning too far forward', cue: 'Lift your chest as you stand.' },
        half_stand: { part: 'Hips', issue: 'not reaching full standing', cue: 'Stand all the way up before you sit back down.' },
        arm_push: { part: 'Arms', issue: 'pushing off the thighs', cue: 'Cross your arms over your chest if you can.' },
        drop_sit: { part: 'Lowering', issue: 'dropping into the chair', cue: 'Sit down slowly, about three seconds.' },
      },
    },
    mini_squat: {
      name: 'Mini squat',
      doses: [10, 12, 15],
      faults: {
        knees_in: { part: 'Knees', issue: 'caving inward', cue: 'Push your knees out over your toes.' },
        heels_up: { part: 'Heels', issue: 'lifting off the floor', cue: 'Keep your weight back through your heels.' },
        back_round: { part: 'Back', issue: 'rounding forward', cue: 'Keep your back straight and your chest up.' },
        shallow: { part: 'Depth', issue: 'not bending far enough', cue: 'Bend a little deeper, as far as is comfortable.' },
      },
    },
    wall_pushup: {
      name: 'Wall push-up',
      doses: [8, 10, 12],
      faults: {
        hips_sag: { part: 'Hips', issue: 'sagging toward the wall', cue: 'Keep a straight line from your head to your heels.' },
        elbows_flare: { part: 'Elbows', issue: 'flaring out wide', cue: 'Keep your elbows angled back, close to your body.' },
        short_range: { part: 'Elbows', issue: 'not bending enough', cue: 'Bring your chest closer to the wall.' },
        head_drop: { part: 'Head', issue: 'dropping forward', cue: 'Keep your head in line with your body.' },
      },
    },
    bicep_curl: {
      name: 'Bicep curl',
      doses: [10, 12, 15],
      faults: {
        swing: { part: 'Trunk', issue: 'swinging to lift the weight', cue: 'Keep your body still and let your arms do the work.' },
        elbow_drift: { part: 'Elbows', issue: 'drifting forward', cue: 'Keep your elbows by your sides.' },
        short_range: { part: 'Arms', issue: 'not straightening at the bottom', cue: 'Lower the weight all the way down.' },
        too_fast: { part: 'Tempo', issue: 'lifting too fast', cue: 'Slow down. Two seconds up, two seconds down.' },
      },
    },
    arm_raise: {
      name: 'Front arm raise',
      doses: [8, 10, 12],
      faults: {
        shrug: { part: 'Shoulders', issue: 'shrugging toward the ears', cue: 'Relax your shoulders down.' },
        low_raise: { part: 'Arms', issue: 'not reaching shoulder height', cue: 'Lift to shoulder height if you can.' },
        bent_elbows: { part: 'Elbows', issue: 'bending during the lift', cue: 'Keep your arms long, with a soft elbow.' },
        lean_back: { part: 'Trunk', issue: 'leaning back', cue: 'Stand tall and keep your ribs down.' },
      },
    },
    heel_raise: {
      name: 'Heel raise',
      doses: [12, 15, 20],
      faults: {
        low_rise: { part: 'Heels', issue: 'not lifting fully', cue: 'Rise as high onto your toes as you can.' },
        lean_forward: { part: 'Trunk', issue: 'leaning forward', cue: 'Keep your body upright.' },
        sway: { part: 'Balance', issue: 'swaying side to side', cue: 'Hold the chair back lightly for balance.' },
        drop: { part: 'Lowering', issue: 'dropping the heels quickly', cue: 'Lower your heels slowly.' },
      },
    },
  };

  // Faults any exercise can report.
  const GENERIC = {
    too_fast: { part: 'Tempo', issue: 'moving too fast', cue: 'Slow down. Count two seconds each way.' },
    off_camera: { part: 'Camera', issue: 'partly out of view', cue: 'Step back into the camera view.' },
  };

  CC.exerciseName = (code) => (CC.EXERCISES[code] ? CC.EXERCISES[code].name : String(code));

  CC.fault = function (exercise, code) {
    const ex = CC.EXERCISES[exercise];
    const found = (ex && ex.faults[code]) || GENERIC[code];
    if (found) return Object.assign({ code }, found);
    return { code, part: '', issue: String(code).replace(/_/g, ' ').slice(0, 80), cue: '' };
  };
})();
