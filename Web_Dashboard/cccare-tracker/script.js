// Shared data and helper functions. Every page loads this file first.

// The exercises, and the problems the camera can spot for each one.
// "tip" is what the patient sees on their screen.
var EXERCISES = {
  sit_to_stand: {
    name: "Sit-to-stand",
    problems: [
      { message: "Knees caving inward on the way up", tip: "Keep your knees in line with your toes." },
      { message: "Leaning too far forward", tip: "Lift your chest as you stand." },
      { message: "Not standing all the way up", tip: "Stand all the way up before you sit back down." }
    ]
  },
  mini_squat: {
    name: "Mini squat",
    problems: [
      { message: "Knees caving inward", tip: "Push your knees out over your toes." },
      { message: "Heels lifting off the floor", tip: "Keep your weight back through your heels." },
      { message: "Not bending far enough", tip: "Bend a little deeper, as far as is comfortable." }
    ]
  },
  wall_pushup: {
    name: "Wall push-up",
    problems: [
      { message: "Hips sagging toward the wall", tip: "Keep a straight line from your head to your heels." },
      { message: "Elbows flaring out wide", tip: "Keep your elbows close to your body." },
      { message: "Elbows not bending enough", tip: "Bring your chest closer to the wall." }
    ]
  },
  bicep_curl: {
    name: "Bicep curl",
    problems: [
      { message: "Swinging the body to lift the weight", tip: "Keep your body still and let your arms do the work." },
      { message: "Elbows drifting forward", tip: "Keep your elbows by your sides." },
      { message: "Lifting too fast", tip: "Slow down. Two seconds up, two seconds down." }
    ]
  },
  arm_raise: {
    name: "Front arm raise",
    problems: [
      { message: "Shoulders shrugging toward the ears", tip: "Relax your shoulders down." },
      { message: "Arms not reaching shoulder height", tip: "Lift to shoulder height if you can." },
      { message: "Leaning back", tip: "Stand tall and keep your ribs down." }
    ]
  },
  heel_raise: {
    name: "Heel raise",
    problems: [
      { message: "Heels not lifting fully", tip: "Rise as high onto your toes as you can." },
      { message: "Swaying side to side", tip: "Hold the chair back lightly for balance." },
      { message: "Dropping the heels quickly", tip: "Lower your heels slowly." }
    ]
  }
};

// The workouts the instructor can choose from (the same sample workouts as the old site).
var WORKOUTS = [
  { name: "Workout A", exercises: [
    { exercise: "sit_to_stand", sets: 2, reps: 10 },
    { exercise: "wall_pushup", sets: 2, reps: 8 },
    { exercise: "heel_raise", sets: 2, reps: 12 }
  ] },
  { name: "Workout B", exercises: [
    { exercise: "mini_squat", sets: 2, reps: 10 },
    { exercise: "bicep_curl", sets: 2, reps: 10 },
    { exercise: "arm_raise", sets: 2, reps: 8 }
  ] },
  { name: "Workout C", exercises: [
    { exercise: "sit_to_stand", sets: 3, reps: 8 },
    { exercise: "heel_raise", sets: 2, reps: 15 }
  ] },
  { name: "Workout D", exercises: [
    { exercise: "wall_pushup", sets: 2, reps: 10 },
    { exercise: "mini_squat", sets: 2, reps: 12 },
    { exercise: "bicep_curl", sets: 2, reps: 12 }
  ] }
];

// Seconds of rest between sets.
var REST_SECONDS = 15;

// Text like "Workout A: Sit-to-stand 2x10, Wall push-up 2x8, Heel raise 2x12"
function describeWorkout(number) {
  var workout = WORKOUTS[number];
  var parts = [];
  for (var i = 0; i < workout.exercises.length; i++) {
    var step = workout.exercises[i];
    parts.push(EXERCISES[step.exercise].name + " " + step.sets + "x" + step.reps);
  }
  return workout.name + ": " + parts.join(", ");
}

// A random whole number from min to max (including both).
function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Score = (1 - reps off / reps planned) x average form quality.
// "Reps off" adds up how far each finished set was from the plan. Doing 7 instead
// of 10 is 3 off, and doing 12 instead of 10 is 2 off.
// Only finished sets count, so exercises nobody reached aren't a penalty.
function getScore(person) {
  if (person.repsDone == 0) {
    return 0;
  }
  var averageQuality = person.qualityTotal / person.repsDone;
  if (person.plannedReps == 0) {
    return Math.round(averageQuality);
  }
  var followedPlan = 1 - person.repsOff / person.plannedReps;
  if (followedPlan < 0) followedPlan = 0;
  return Math.round(followedPlan * averageQuality);
}

// Adds the set someone just finished to their totals.
function finishSet(person, plannedReps) {
  person.plannedReps += plannedReps;
  person.repsOff += Math.abs(person.repsInSet - plannedReps);
}

function getAverageQuality(person) {
  if (person.repsDone == 0) {
    return 0;
  }
  return Math.round(person.qualityTotal / person.repsDone);
}

// Turns 75 seconds into "1:15".
function formatTime(seconds) {
  var minutes = Math.floor(seconds / 60);
  var rest = seconds % 60;
  if (rest < 10) {
    rest = "0" + rest;
  }
  return minutes + ":" + rest;
}

// Makes a table of one person's score in every saved session they were in,
// with a bar for each score so you can see it going up or down.
function progressTable(name) {
  var pastSessions = loadData("history");
  if (pastSessions == null) pastSessions = [];

  var html = "<table border='1'><tr><th>Session</th><th>Date</th><th>Score</th><th></th></tr>";
  var found = 0;
  for (var s = 0; s < pastSessions.length; s++) {
    for (var i = 0; i < pastSessions[s].people.length; i++) {
      var p = pastSessions[s].people[i];
      if (p.name == name) {
        var score = getScore(p);
        html += "<tr><td>" + (s + 1) + "</td><td>" + pastSessions[s].date + "</td><td>" + score + "%</td>";
        html += "<td><progress value='" + score + "' max='100'></progress></td></tr>";
        found++;
      }
    }
  }
  html += "</table>";

  if (found == 0) {
    return "<p>No finished sessions yet.</p>";
  }
  return html;
}

// Makes typed-in text safe to put inside innerHTML.
function clean(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Saving and loading. localStorage keeps data in this browser, so all the pages
// (even in different tabs) can see the same session.
function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadData(key) {
  var text = localStorage.getItem(key);
  if (text == null) {
    return null;
  }
  return JSON.parse(text);
}
