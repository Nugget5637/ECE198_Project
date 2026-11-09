"""Draws the exercise animations in img/exercises/: a grey figure, seen from the side,
doing each exercise, with the muscles it works shown in red.

Run from the site folder:  python3 tools/make_exercise_gifs.py   (needs Pillow)

Each pose is a set of joint angles. An angle is the direction of a body segment, in
degrees: 0 points down, 90 points forward (to the right, the way the figure faces),
180 points up. The animation eases between the poses and back again.
"""
import math
import os

from PIL import Image, ImageDraw

SIZE = 200  # output size in pixels
SCALE = 4  # drawn this much larger, then shrunk, for smooth edges
FRAMES = 32
FRAME_MS = 70
HOLD = 3  # frames held at each end of the movement

BG = (255, 255, 255)
BODY = (178, 178, 178)
BODY_FAR = (214, 214, 214)
PROP = (120, 120, 120)
FLOOR = (225, 225, 225)
RED = (214, 48, 48)

L = dict(shin=42, thigh=44, torso=58, neck=6, head=11, upper=31, fore=29, foot=15)
W = dict(leg=13, torso=22, arm=9, foot=8)


def d(a):
    r = math.radians(a)
    return math.sin(r), math.cos(r)


def add(p, a, length):
    dx, dy = d(a)
    return p[0] + dx * length, p[1] + dy * length


def lerp(a, b, t):
    return a + (b - a) * t


def ik(shoulder, hand, l1, l2, elbow_down=True):
    """Elbow position for an arm reaching from shoulder to hand."""
    dx, dy = hand[0] - shoulder[0], hand[1] - shoulder[1]
    dist = min(math.hypot(dx, dy), l1 + l2 - 0.01)
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    ux, uy = dx / dist, dy / dist
    mx, my = shoulder[0] + ux * a, shoulder[1] + uy * a
    sign = 1 if elbow_down else -1
    return mx - uy * h * sign, my + ux * h * sign


class Canvas:
    def __init__(self):
        self.img = Image.new('RGB', (SIZE * SCALE, SIZE * SCALE), BG)
        self.dr = ImageDraw.Draw(self.img)

    def s(self, p):
        return p[0] * SCALE, p[1] * SCALE

    def capsule(self, a, b, width, color):
        w = width * SCALE
        self.dr.line([self.s(a), self.s(b)], fill=color, width=int(w))
        for p in (a, b):
            x, y = self.s(p)
            self.dr.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)

    def dot(self, p, r, color):
        x, y = self.s(p)
        r *= SCALE
        self.dr.ellipse([x - r, y - r, x + r, y + r], fill=color)

    def rect(self, x0, y0, x1, y1, color):
        self.dr.rectangle([x0 * SCALE, y0 * SCALE, x1 * SCALE, y1 * SCALE], fill=color)

    def muscle(self, a, b, t0, t1, side, width, offset):
        """A red band along part of the segment a→b, shifted to the front (+1) or back (-1)."""
        dx, dy = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dy) or 1
        # the perpendicular that points forward for a segment pointing up
        px, py = dy / n, -dx / n
        if py * 0 + px < 0:
            px, py = -px, -py
        o = offset * side
        p0 = (a[0] + dx * t0 + px * o, a[1] + dy * t0 + py * o)
        p1 = (a[0] + dx * t1 + px * o, a[1] + dy * t1 + py * o)
        self.capsule(p0, p1, width, RED)

    def image(self):
        return self.img.resize((SIZE, SIZE), Image.LANCZOS)


def skeleton(pose):
    """Joint positions from a pose. The toe stays on the floor unless pose has 'ankle'."""
    if 'ankle' in pose:
        ankle = pose['ankle']
        toe = add(ankle, pose.get('foot', 90), L['foot'])
    else:
        toe = pose['toe']
        dx, dy = d(pose.get('foot', 90))
        ankle = (toe[0] - dx * L['foot'], toe[1] - dy * L['foot'])
    knee = add(ankle, pose['shin'], L['shin'])
    hip = add(knee, pose['thigh'], L['thigh'])
    shoulder = add(hip, pose['torso'], L['torso'])
    head = add(shoulder, pose['torso'], L['neck'] + L['head'])
    j = dict(toe=toe, ankle=ankle, knee=knee, hip=hip, shoulder=shoulder, head=head)
    if 'hand' in pose:
        j['hand'] = pose['hand']
        j['elbow'] = ik(shoulder, pose['hand'], L['upper'], L['fore'], pose.get('elbow_down', True))
    else:
        j['elbow'] = add(shoulder, pose['upper'], L['upper'])
        j['hand'] = add(j['elbow'], pose['fore'], L['fore'])
    return j


def draw_figure(c, j, muscles, prop=None):
    # far arm and leg, lighter, a little behind
    off = (-3, 0)
    sh = lambda p: (p[0] + off[0], p[1] + off[1])
    c.capsule(sh(j['hip']), sh(j['knee']), W['leg'], BODY_FAR)
    c.capsule(sh(j['knee']), sh(j['ankle']), W['leg'] - 1, BODY_FAR)
    c.capsule(sh(j['ankle']), sh(j['toe']), W['foot'], BODY_FAR)
    c.capsule(sh(j['shoulder']), sh(j['elbow']), W['arm'], BODY_FAR)
    c.capsule(sh(j['elbow']), sh(j['hand']), W['arm'] - 1, BODY_FAR)

    # near side
    c.capsule(j['hip'], j['shoulder'], W['torso'], BODY)
    c.dot(j['head'], L['head'], BODY)
    c.capsule(j['hip'], j['knee'], W['leg'], BODY)
    c.capsule(j['knee'], j['ankle'], W['leg'] - 1, BODY)
    c.capsule(j['ankle'], j['toe'], W['foot'], BODY)

    if 'glutes' in muscles:
        c.muscle(j['hip'], j['shoulder'], -0.05, 0.12, -1, 9, 6)
    if 'quads' in muscles:
        c.muscle(j['hip'], j['knee'], 0.18, 0.82, 1, 6, 3)
    if 'hamstrings' in muscles:
        c.muscle(j['hip'], j['knee'], 0.2, 0.8, -1, 5, 3)
    if 'calves' in muscles:
        c.muscle(j['knee'], j['ankle'], 0.12, 0.6, -1, 7, 3)
    if 'chest' in muscles:
        c.muscle(j['hip'], j['shoulder'], 0.62, 0.86, 1, 9, 6)

    c.capsule(j['shoulder'], j['elbow'], W['arm'], BODY)
    c.capsule(j['elbow'], j['hand'], W['arm'] - 1, BODY)
    if 'biceps' in muscles:
        c.muscle(j['shoulder'], j['elbow'], 0.2, 0.8, 1 if prop != 'wall' else -1, 5, 2)
    if 'triceps' in muscles:
        c.muscle(j['shoulder'], j['elbow'], 0.15, 0.8, -1 if prop != 'wall' else 1, 5, 2)
    if 'shoulders' in muscles:
        c.dot(j['shoulder'], 6, RED)
    if prop == 'dumbbell':
        x, y = j['hand']
        c.rect(x - 3, y - 7, x + 3, y + 7, PROP)


def ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


def mix(a, b, t):
    out = {}
    for k, v in a.items():
        w = b.get(k, v)
        if isinstance(v, tuple):
            out[k] = (lerp(v[0], w[0], t), lerp(v[1], w[1], t))
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = lerp(v, w, t)
        else:
            out[k] = v
    return out


def pose_at(keys, u):
    """u in 0..1 runs through the key poses in order."""
    n = len(keys) - 1
    x = u * n
    i = min(int(x), n - 1)
    return mix(keys[i], keys[i + 1], ease(x - i))


def floor(c):
    c.rect(10, 190, 190, 192, FLOOR)


def chair(c, back_x=34, seat_y=146, front_x=76):
    c.rect(back_x, seat_y, front_x, seat_y + 4, PROP)  # seat
    c.rect(back_x, 96, back_x + 4, seat_y + 4, PROP)  # back
    c.rect(back_x + 2, seat_y + 4, back_x + 5, 190, PROP)  # legs
    c.rect(front_x - 5, seat_y + 4, front_x - 2, 190, PROP)


# ---------- exercises ----------
# Each entry: key poses, muscles in red, and an optional prop drawn behind the figure.

STAND = dict(toe=(114, 189), foot=90, shin=180, thigh=180, torso=180, upper=6, fore=12)

EXERCISES = {
    'sit_to_stand': dict(
        muscles={'quads', 'glutes'},
        scene=lambda c: chair(c),
        keys=[
            dict(toe=(114, 189), foot=90, shin=178, thigh=268, torso=172, upper=22, fore=205),
            dict(toe=(114, 189), foot=90, shin=165, thigh=245, torso=140, upper=22, fore=205),
            dict(toe=(114, 189), foot=90, shin=180, thigh=180, torso=180, upper=22, fore=205),
        ],
    ),
    'mini_squat': dict(
        muscles={'quads', 'glutes', 'hamstrings'},
        keys=[
            dict(toe=(112, 189), foot=90, shin=180, thigh=180, torso=180, upper=8, fore=12),
            dict(toe=(112, 189), foot=90, shin=158, thigh=214, torso=158, upper=78, fore=84),
        ],
    ),
    'wall_pushup': dict(
        muscles={'chest', 'triceps'},
        prop='wall',
        scene=lambda c: c.rect(160, 20, 168, 190, PROP),
        keys=[
            dict(ankle=(52, 182), foot=90, shin=160, thigh=160, torso=160, hand=(157, 62), elbow_down=True),
            dict(ankle=(52, 182), foot=90, shin=150, thigh=150, torso=150, hand=(157, 62), elbow_down=True),
        ],
    ),
    'bicep_curl': dict(
        muscles={'biceps'},
        prop='dumbbell',
        keys=[
            dict(STAND, toe=(108, 189), upper=4, fore=14),
            dict(STAND, toe=(108, 189), upper=8, fore=158),
        ],
    ),
    'arm_raise': dict(
        muscles={'shoulders'},
        prop='dumbbell',
        keys=[
            dict(STAND, toe=(100, 189), upper=8, fore=12),
            dict(STAND, toe=(100, 189), upper=90, fore=92),
        ],
    ),
    'heel_raise': dict(
        muscles={'calves'},
        scene=lambda c: (c.rect(150, 104, 156, 190, PROP), c.rect(140, 100, 160, 105, PROP)),
        keys=[
            dict(toe=(112, 189), foot=90, shin=180, thigh=180, torso=180, hand=(146, 103), elbow_down=True),
            dict(toe=(112, 189), foot=52, shin=180, thigh=180, torso=180, hand=(146, 103), elbow_down=True),
        ],
    ),
}


def frames_for(spec):
    half = FRAMES // 2
    out = []
    for f in range(FRAMES):
        if f < half:
            u = min(1.0, max(0.0, (f - HOLD) / (half - 2 * HOLD)))
        else:
            u = 1 - min(1.0, max(0.0, (f - half - HOLD) / (half - 2 * HOLD)))
        c = Canvas()
        floor(c)
        if spec.get('scene'):
            spec['scene'](c)
        draw_figure(c, skeleton(pose_at(spec['keys'], u)), spec['muscles'], spec.get('prop'))
        out.append(c.image().convert('P', palette=Image.ADAPTIVE, colors=48))
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    folder = os.path.join(here, '..', 'img', 'exercises')
    os.makedirs(folder, exist_ok=True)
    for code, spec in EXERCISES.items():
        frames = frames_for(spec)
        path = os.path.join(folder, code + '.gif')
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0, disposal=1)
        print('wrote', os.path.relpath(path, os.path.join(here, '..')))


if __name__ == '__main__':
    main()
