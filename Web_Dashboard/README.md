CCCARE exercise tracking
A prototype website for sub-problem 2, exercise tracking and measurement. The instructor sees up to 30 participants at once. Each participant has a block showing their reps, movement quality and exertion, plus what they are doing wrong. When the session ends, everyone gets a results page with a percentage success. A Progress button on each results page shows their success over earlier sessions.

The site is plain HTML, CSS and JavaScript. There is no build step and no libraries, and it works offline.

Running it
From your computer: unzip the folder and open index.html in Chrome or Edge. This was tested in Chromium, which both are built on. Firefox reportedly keeps browser storage separate for each local file, so signing in may not carry over to the next page there. In Firefox, use a hosted copy or a local server instead.
Local server: run python3 -m http.server 8000 in this folder and go to http://localhost:8000. This works in any browser.
Putting it online
It is a static site, so any static host works. Two free options:

Netlify Drop (about a minute)

Go to https://app.netlify.com/drop.
Drag cccare-tracker.zip, or the unzipped folder, onto the page.
Sign up for a free account when asked. Without an account the site is deleted after about an hour.
GitHub Pages (a few minutes, stays up)

Create a new public repository at https://github.com/new, for example cccare-tracker. Free accounts need a public repository for Pages.
On the new repository's page, choose uploading an existing file. Drag in everything inside the unzipped folder, not the folder itself, then commit.
Open Settings → Pages. Under Build and deployment, set Source to Deploy from a branch, choose main and / (root), and save.
After a minute or two the site is at https://<your-username>.github.io/cccare-tracker/.
Sample accounts (the username is not case-sensitive, the password is):

Role	Username	Password
Instructor	InsU	InsP
Patient	PatU	PatP (linked to participant 01)
Pages
File	Who	What it does
index.html	everyone	Sign in. The account decides which screen you land on.
instructor.html	instructor	Set up the session (1 to 30 participants, name, exercise and dose for each), then the live dashboard. A blank name shows as "Patient" plus the block number.
patient.html	patient	One large block for the signed-in patient, with a cue for each problem.
session-results.html	instructor	Everyone's results for a session. Choose a name to open that patient's results.
patient-results.html	both	One patient's results, what went wrong, and the Progress button with the line graph. Patients can only open their own results.
End session asks for a second press within four seconds so it can't be ended by accident.

What the numbers mean
Success, from 0 to 100%, is how close the reps came to the dose, multiplied by the average movement quality:

success = (1 − |reps − dose| / dose) × average quality
For example, 20 of 20 reps at 85% quality scores 85%. Both 15 of 20 and 25 of 20 at 85% quality score 64%. Stopping short and overdoing it cost the same, because both came up in the brief. To change the rule, edit success() in js/score.js.

The wheel fills clockwise from 12 o'clock with success. Its colour shows the quality of the last five reps on a scale of red, orange, amber, yellow-green and green. The quality percentage is also printed under the wheel for anyone who can't tell red from green.

The strip under the wheel turns black when something needs attention:

Exertion 8 or more out of 10
Reps past the dose
A form fault reported by the camera, such as "Knees caving inward on the way up"
No reps for 25 seconds before the dose is done
The thresholds are in LIMITS in js/score.js. The exercises, their faults and the patient cues are in js/exercises.js.

Connecting the camera, neural network and ESP32
Without any setup, a simulator in the browser makes up the data. To use real data, run a WebSocket server on the machine running the neural network, then open:

instructor.html?feed=ws://192.168.1.20:8765
The address is remembered for that browser tab. Use ?feed=off to go back to the simulator. The patient page accepts the same parameter and only uses messages for its own participant.

The server sends JSON messages, one at a time or several in an array:

{ "type": "rep", "pid": "P03", "quality": 82, "faults": ["knees_in"] }
{ "type": "exertion", "pid": "P03", "value": 6 }
{ "type": "faults", "pid": "P03", "faults": ["lean_forward"] }
pid is the block number, written as "P03", "3" or 3.
rep is one finished repetition. quality is 0 to 100. faults lists the fault codes seen during that rep, or is empty.
exertion is on a 0 to 10 scale. It can come from a heart-rate sensor on the ESP32 or be estimated from movement.
faults is optional and sends live form feedback between reps.
Fault codes are listed in js/exercises.js. An unknown code is shown as plain text.
The dashboard also sends two messages. {"type":"session","state":"start","participants":["P01",…]} goes out when a session starts, and {"type":"session","state":"end"} when it ends. Invalid messages are ignored.

A minimal test server in Python (pip install websockets). This is an untested sketch:

import asyncio, json, random
import websockets

async def handler(ws):
    hello = json.loads(await ws.recv())          # the "session start" message
    stations = hello.get("participants", ["P01"])
    while True:
        await ws.send(json.dumps({"type": "rep", "pid": random.choice(stations),
                                  "quality": random.randint(55, 98), "faults": []}))
        await asyncio.sleep(1)

async def main():
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()

asyncio.run(main())
If the site is served over https:// (Vercel, for example), browsers block plain ws:// connections, so use wss://. Opening the site from the file or from http://localhost avoids this.

Demo tips
Add ?speed=3 to instructor.html or patient.html to make the simulator three times faster.
The progress graphs start with sample history: 14 Tuesday and Thursday classes before today, labelled "sample". Sessions you run are added after them.
Reset sample data, in the instructor footer, deletes saved sessions and names.
Limits of the prototype
Sign-in is checked in the browser against hard-coded passwords, and all data is kept in the browser's localStorage. This is fine for a demo but not for real patient data. A real deployment needs server-side sign-in and storage that meets Ontario's health privacy law (PHIPA).
Exertion and form scores are only as good as the pipeline that sends them. The website displays and scores what it receives.
Files
index.html               sign in
instructor.html          set-up and live dashboard
patient.html             patient's live block
session-results.html     instructor: everyone's results
patient-results.html     one patient's results and progress graph
css/style.css            all styling
js/util.js               helpers (dates, random numbers, safe element building)
js/exercises.js          exercises, fault codes, patient cues
js/score.js              success formula, thresholds, live tracker
js/store.js              accounts, roster, saved sessions, sample history
js/feed.js               simulator and WebSocket feed
js/ui.js                 wheel, participant block, shared page parts
js/chart.js              progress line graph
js/pages/*.js            one script per page
