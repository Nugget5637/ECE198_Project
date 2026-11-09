"""Renders the exercise animations in img/exercises/: a smooth grey 3D figure on a white
background doing each exercise, with the muscles it works in red.

Run from the site folder:  python3 tools/make_exercise_gifs.py   (needs numpy and Pillow)

The figure is built from smooth 3D shapes (ellipsoids and tapered capsules blended
together) and drawn by ray marching a signed distance field, with soft lighting,
ambient occlusion and a soft floor shadow. Each pose is a set of joint angles in the
side-on (sagittal) plane, in degrees: 0 points down, 90 points forward (the way the
figure faces), 180 points up. The animation eases between the poses and back.
"""
import math
import os
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image

OUT = 320  # output size in pixels
SS = 2  # rendered this many times larger, then shrunk, for smooth edges
FRAMES = 40
FRAME_MS = 55
HOLD = 4  # frames held at each end of the movement

BODY = np.array([0.80, 0.81, 0.84], np.float32)
MUSCLE = np.array([0.86, 0.15, 0.13], np.float32)
PROP = np.array([0.40, 0.41, 0.44], np.float32)
PANEL = np.array([0.86, 0.86, 0.88], np.float32)

# Body measurements, metres.
L = dict(shin=0.43, thigh=0.45, torso=0.47, upper=0.29, fore=0.26, foot=0.165)
HIP_Z = 0.09
SHOULDER_Z = 0.19

# ---------- maths helpers ----------


def d2(a):
    """Direction in the sagittal plane: 0 down, 90 forward, 180 up."""
    r = math.radians(a)
    return np.array([math.sin(r), -math.cos(r)])


def lerp(a, b, t):
    return a + (b - a) * t


def ease(t):
    return 0.5 - 0.5 * math.cos(math.pi * t)


def ik(shoulder, hand, l1, l2, elbow_down=True):
    """Elbow position for an arm reaching from shoulder to hand, in the sagittal plane."""
    d = hand - shoulder
    dist = min(float(np.hypot(*d)), l1 + l2 - 1e-3)
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(0.0, l1 * l1 - a * a))
    u = d / (np.hypot(*d) or 1)
    m = shoulder + u * a
    n = np.array([u[1], -u[0]]) if elbow_down else np.array([-u[1], u[0]])
    return m + n * h


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


# ---------- signed distance primitives (points as separate x, y, z arrays) ----------


def sd_ellipsoid(x, y, z, c, u, r):
    """Ellipsoid centred at c; its first axis is u (in the x-y plane), then the
    perpendicular in that plane, then z. r holds the three radii."""
    dx, dy, dz = x - c[0], y - c[1], z - c[2]
    a = dx * u[0] + dy * u[1]
    b = -dx * u[1] + dy * u[0]
    k0 = np.sqrt((a / r[0]) ** 2 + (b / r[1]) ** 2 + (dz / r[2]) ** 2)
    k1 = np.sqrt((a / r[0] ** 2) ** 2 + (b / r[1] ** 2) ** 2 + (dz / r[2] ** 2) ** 2)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-6)


def sd_round_cone(x, y, z, a, b, r1, r2):
    """Capsule from a (radius r1) to b (radius r2), smoothly tapered."""
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    px, py, pz = x - a[0], y - a[1], z - a[2]
    yy = px * ba[0] + py * ba[1] + pz * ba[2]
    zz = yy - l2
    qx, qy, qz = px * l2 - ba[0] * yy, py * l2 - ba[1] * yy, pz * l2 - ba[2] * yy
    x2 = qx * qx + qy * qy + qz * qz
    y2 = yy * yy * l2
    z2 = zz * zz * l2
    k = math.copysign(1, rr) * rr * rr * x2
    end_b = np.sqrt(x2 + z2) * il2 - r2
    end_a = np.sqrt(x2 + y2) * il2 - r1
    side = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + yy * rr) * il2 - r1
    return np.where(np.sign(zz) * a2 * z2 > k, end_b, np.where(np.sign(yy) * a2 * y2 < k, end_a, side))


def sd_box(x, y, z, c, h, r=0.0):
    qx, qy, qz = np.abs(x - c[0]) - h[0], np.abs(y - c[1]) - h[1], np.abs(z - c[2]) - h[2]
    out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
    return out + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0) - r


def sd_cyl_z(x, y, z, c, r, h):
    """Cylinder along z."""
    dr = np.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2) - r
    dz = np.abs(z - c[2]) - h
    return np.minimum(np.maximum(dr, dz), 0) + np.sqrt(np.maximum(dr, 0) ** 2 + np.maximum(dz, 0) ** 2)


# ---------- the figure ----------


def skeleton(pose):
    """Sagittal joint positions (x forward, y up, metres) for a pose."""
    fd = d2(pose.get('foot', 71))
    toe = np.array(pose['toe'], float)
    ankle = toe - fd * L['foot']
    knee = ankle + d2(pose['shin']) * L['shin']
    hip = knee + d2(pose['thigh']) * L['thigh']
    u = d2(pose['torso'])
    neck = hip + u * L['torso']
    head = neck + d2(pose['torso'] + pose.get('head', 0)) * 0.17
    shoulder = neck - u * 0.035
    if 'hand' in pose:
        hand = np.array(pose['hand'], float)
        elbow = ik(shoulder, hand, L['upper'], L['fore'], pose.get('elbow_down', True))
    else:
        elbow = shoulder + d2(pose['upper']) * L['upper']
        hand = elbow + d2(pose['fore']) * L['fore']
    return dict(toe=toe, ankle=ankle, knee=knee, hip=hip, neck=neck, head=head,
                shoulder=shoulder, elbow=elbow, hand=hand, fd=fd, u=u)


def v3(p, z):
    return np.array([p[0], p[1], z], np.float32)


def unit(v):
    v = np.asarray(v, float)
    return v / (np.hypot(*v) or 1)


class Figure:
    """The parts of the body for one pose. Each part is (sdf function, muscle tag)."""

    def __init__(self, j, arm_z=None):
        self.torso, self.legs, self.arms = [], [], []
        u = j['u']
        hip, neck = j['hip'], j['neck']
        T = self.torso
        # trunk
        T.append((lambda x, y, z, c=v3(hip + u * 0.05, 0): sd_ellipsoid(x, y, z, c, u, (0.115, 0.105, 0.155)), None))
        T.append((lambda x, y, z, c=v3(hip + u * 0.21, 0): sd_ellipsoid(x, y, z, c, u, (0.13, 0.095, 0.135)), None))
        T.append((lambda x, y, z, c=v3(hip + u * 0.34 + np.array([u[1], -u[0]]) * 0.005, 0):
                  sd_ellipsoid(x, y, z, c, u, (0.15, 0.11, 0.16)), None))
        T.append((lambda x, y, z, c=v3(neck - u * 0.05 - np.array([u[1], -u[0]]) * 0.02, 0):
                  sd_ellipsoid(x, y, z, c, u, (0.06, 0.07, 0.15)), None))  # trapezius
        fwd = np.array([u[1], -u[0]])
        for s in (-1, 1):
            T.append((lambda x, y, z, c=v3(hip + u * 0.36 + fwd * 0.075, s * 0.072):
                      sd_ellipsoid(x, y, z, c, u, (0.07, 0.04, 0.075)), 'chest'))
            T.append((lambda x, y, z, c=v3(hip - fwd * 0.055 + u * 0.0, s * 0.072):
                      sd_ellipsoid(x, y, z, c, u, (0.09, 0.07, 0.08)), 'glutes'))
            # deltoid
            sh3 = v3(j['shoulder'], s * SHOULDER_Z)
            T.append((lambda x, y, z, c=sh3, a=unit(j['elbow'] - j['shoulder']):
                      sd_ellipsoid(x, y, z, c + np.array([a[0], a[1], 0], np.float32) * 0.02, a, (0.075, 0.055, 0.055)),
                      'shoulders'))
        # neck and head
        T.append((lambda x, y, z, a=v3(neck - u * 0.02, 0), b=v3(j['head'] - u * 0.05, 0):
                  sd_round_cone(x, y, z, a, b, 0.055, 0.045), None))
        T.append((lambda x, y, z, c=v3(j['head'], 0): sd_ellipsoid(x, y, z, c, u, (0.115, 0.095, 0.085)), None))
        T.append((lambda x, y, z, c=v3(j['head'] - u * 0.055 + fwd * 0.03, 0):
                  sd_ellipsoid(x, y, z, c, u, (0.055, 0.06, 0.06)), None))  # jaw

        for s in (-1, 1):
            leg = []
            zh = s * HIP_Z
            hp, kn, an = v3(j['hip'], zh), v3(j['knee'], zh), v3(j['ankle'], zh)
            ta = unit(j['knee'] - j['hip'])
            sa = unit(j['ankle'] - j['knee'])
            fr = lambda a: np.array([-a[1], a[0]])  # front of a limb segment
            leg.append((lambda x, y, z, a=hp, b=kn: sd_round_cone(x, y, z, a, b, 0.075, 0.05), None))
            leg.append((lambda x, y, z, c=v3(j['hip'] + ta * 0.22 + fr(ta) * 0.025, zh), a=ta:
                        sd_ellipsoid(x, y, z, c, a, (0.17, 0.055, 0.06)), 'quads'))
            leg.append((lambda x, y, z, c=v3(j['hip'] + ta * 0.22 - fr(ta) * 0.028, zh), a=ta:
                        sd_ellipsoid(x, y, z, c, a, (0.15, 0.045, 0.055)), 'hamstrings'))
            leg.append((lambda x, y, z, a=kn, b=an: sd_round_cone(x, y, z, a, b, 0.048, 0.031), None))
            leg.append((lambda x, y, z, c=v3(j['knee'] + sa * 0.13 - fr(sa) * 0.03, zh), a=sa:
                        sd_ellipsoid(x, y, z, c, a, (0.11, 0.043, 0.045)), 'calves'))
            fd = j['fd']
            down = np.array([fd[1], -fd[0]])
            heel = j['ankle'] - fd * 0.045 + down * 0.035
            toe = j['toe'] + fd * 0.05
            leg.append((lambda x, y, z, a=v3(heel, zh), b=v3(toe, zh): sd_round_cone(x, y, z, a, b, 0.034, 0.024), None))
            leg.append((lambda x, y, z, c=v3(j['ankle'], zh): np.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) - 0.036, None))
            self.legs.append(leg)

        az = arm_z or (SHOULDER_Z, 0.215, 0.225)
        for s in (-1, 1):
            arm = []
            sh, el, wr = v3(j['shoulder'], s * az[0]), v3(j['elbow'], s * az[1]), v3(j['hand'], s * az[2])
            ua = unit(j['elbow'] - j['shoulder'])
            fa = unit(j['hand'] - j['elbow'])
            fr = lambda a: np.array([-a[1], a[0]])
            arm.append((lambda x, y, z, a=sh, b=el: sd_round_cone(x, y, z, a, b, 0.046, 0.035), None))
            arm.append((lambda x, y, z, c=v3(j['shoulder'] + ua * 0.15 + fr(ua) * 0.02, s * lerp(az[0], az[1], 0.5)), a=ua:
                        sd_ellipsoid(x, y, z, c, a, (0.095, 0.033, 0.034)), 'biceps'))
            arm.append((lambda x, y, z, c=v3(j['shoulder'] + ua * 0.13 - fr(ua) * 0.022, s * lerp(az[0], az[1], 0.45)), a=ua:
                        sd_ellipsoid(x, y, z, c, a, (0.11, 0.033, 0.036)), 'triceps'))
            arm.append((lambda x, y, z, a=el, b=wr: sd_round_cone(x, y, z, a, b, 0.037, 0.025), None))
            arm.append((lambda x, y, z, c=v3(j['elbow'] + fa * 0.07, s * lerp(az[1], az[2], 0.3)), a=fa:
                        sd_ellipsoid(x, y, z, c, a, (0.08, 0.036, 0.036)), None))
            hc = v3(j['hand'] + fa * 0.065, s * az[2])
            arm.append((lambda x, y, z, c=hc, a=fa: sd_ellipsoid(x, y, z, c, a, (0.07, 0.03, 0.04)), None))
            self.arms.append(arm)
        self.hands = [v3(j['hand'] + unit(j['hand'] - j['elbow']) * 0.065, s * az[2]) for s in (-1, 1)]

    @staticmethod
    def blend(parts, x, y, z, k):
        d = None
        for f, _ in parts:
            v = f(x, y, z)
            d = v if d is None else smin(d, v, k)
        return d

    def sdf(self, x, y, z):
        t = self.blend(self.torso, x, y, z, 0.03)
        legs = np.minimum(*(self.blend(l, x, y, z, 0.022) for l in self.legs))
        body = smin(t, legs, 0.025)
        for a in self.arms:
            body = np.minimum(body, self.blend(a, x, y, z, 0.02))
        return body

    def muscle_weight(self, x, y, z, targets):
        w = np.zeros_like(x)
        for group in [self.torso] + self.legs + self.arms:
            for f, tag in group:
                if tag in targets:
                    w = np.maximum(w, np.clip((0.03 - f(x, y, z)) / 0.025, 0, 1))
        return w


# ---------- props ----------


def chair_parts(seat_top, x0, x1):
    """A plain chair whose seat runs from x0 (back) to x1 (front)."""
    parts = []
    parts.append(lambda x, y, z: sd_box(x, y, z, ((x0 + x1) / 2, seat_top - 0.025, 0), ((x1 - x0) / 2, 0.025, 0.23), 0.01))
    parts.append(lambda x, y, z: sd_box(x, y, z, (x0 + 0.02, seat_top + 0.25, 0), (0.02, 0.22, 0.23), 0.01))
    for lx in (x0 + 0.03, x1 - 0.03):
        for lz in (-0.2, 0.2):
            parts.append(lambda x, y, z, lx=lx, lz=lz: sd_box(x, y, z, (lx, (seat_top - 0.05) / 2, lz), (0.018, (seat_top - 0.05) / 2, 0.018)))
    return parts


def dumbbell_parts(hands):
    parts = []
    for h in hands:
        parts.append(lambda x, y, z, h=h: sd_cyl_z(x, y, z, h, 0.016, 0.075))
        for s in (-1, 1):
            parts.append(lambda x, y, z, h=h, s=s: sd_cyl_z(x, y, z, (h[0], h[1], h[2] + s * 0.075), 0.048, 0.022))
    return parts


# ---------- exercises ----------
# keys: the poses to ease between. props(skeleton of the first pose) gives the props.

STAND = dict(toe=(0.16, 0.026), foot=71, shin=180, thigh=180, torso=180, upper=6, fore=10)


def wall_setup():
    lean_out = dict(toe=(0.0, 0.03), foot=58, shin=158, thigh=158, torso=158)
    j = skeleton(dict(lean_out, upper=90, fore=90))
    wall_x = j['shoulder'][0] + 0.50
    hand = (wall_x - 0.115, j['shoulder'][1] - 0.04)  # palm flat on the wall
    keys = [dict(lean_out, hand=hand), dict(lean_out, shin=147, thigh=147, torso=147, hand=hand)]
    props = [(lambda x, y, z: sd_box(x, y, z, (wall_x + 0.03, 0.95, 0), (0.03, 0.95, 0.36), 0.01), PANEL)]
    return keys, props, (SHOULDER_Z, 0.27, 0.24)


def heel_setup():
    j = skeleton(STAND)
    bar_x = j['shoulder'][0] + 0.42
    bar_y = 0.98
    hand = (bar_x - 0.06, bar_y + 0.02)
    keys = [dict(STAND, hand=hand), dict(STAND, foot=38, hand=hand)]
    props = [(lambda x, y, z: sd_box(x, y, z, (bar_x, bar_y - 0.03, 0), (0.03, 0.025, 0.3), 0.01), PROP)]
    for lz in (-0.27, 0.27):
        props.append((lambda x, y, z, lz=lz: sd_box(x, y, z, (bar_x, bar_y / 2, lz), (0.018, bar_y / 2, 0.018)), PROP))
    return keys, props, None


def sit_setup():
    sit = dict(toe=(0.16, 0.026), foot=71, shin=180, thigh=270, torso=170, upper=40, fore=75)
    j = skeleton(sit)
    seat_top = j['hip'][1] - 0.08
    props = [(p, PROP) for p in chair_parts(seat_top, j['hip'][0] - 0.24, j['hip'][0] + 0.2)]
    keys = [sit,
            dict(sit, shin=166, thigh=240, torso=135, upper=80, fore=84),
            dict(STAND, upper=80, fore=84),
            dict(STAND, upper=10, fore=12)]
    return keys, props, None


EXERCISES = {
    'sit_to_stand': dict(setup=sit_setup, muscles={'quads', 'glutes'}, az=28),
    'mini_squat': dict(muscles={'quads', 'glutes', 'hamstrings'}, az=28, keys=[
        dict(STAND, upper=10, fore=12),
        dict(STAND, shin=155, thigh=215, torso=152, upper=80, fore=82)]),
    'wall_pushup': dict(setup=wall_setup, muscles={'chest', 'triceps'}, az=10),
    'bicep_curl': dict(muscles={'biceps'}, az=40, dumbbells=True, keys=[
        dict(STAND, upper=4, fore=8), dict(STAND, upper=10, fore=150)]),
    'arm_raise': dict(muscles={'shoulders'}, az=40, dumbbells=True, keys=[
        dict(STAND, upper=6, fore=8), dict(STAND, upper=88, fore=90)]),
    'heel_raise': dict(setup=heel_setup, muscles={'calves'}, az=-38),
}


def pose_at(keys, u):
    n = len(keys) - 1
    xq = u * n
    i = min(int(xq), n - 1)
    t = ease(xq - i)
    a, b = keys[i], keys[i + 1]
    out = {}
    for k, v in a.items():
        w = b.get(k, v)
        if isinstance(v, tuple):
            out[k] = tuple(lerp(p, q, t) for p, q in zip(v, w))
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out[k] = lerp(v, w, t)
        else:
            out[k] = v
    return out


def frame_u(f):
    half = FRAMES // 2
    span = half - 2 * HOLD
    if f < half:
        return min(1.0, max(0.0, (f - HOLD) / span))
    return 1 - min(1.0, max(0.0, (f - half - HOLD) / span))


# ---------- camera and rendering ----------


class Camera:
    def __init__(self, az, el, points):
        a, e = math.radians(az), math.radians(el)
        self.vd = np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)], np.float32)
        f = -self.vd
        r = np.cross(f, [0, 1, 0])
        self.r = (r / np.linalg.norm(r)).astype(np.float32)
        self.u = np.cross(self.r, f).astype(np.float32)
        sx, sy = points @ self.r, points @ self.u
        cx, cy = (sx.min() + sx.max()) / 2, (sy.min() + sy.max()) / 2
        half = max(sx.max() - sx.min(), sy.max() - sy.min()) / 2 * 1.1
        self.cx, self.cy, self.half = cx, cy, half

    def rays(self, res):
        g = (np.arange(res, dtype=np.float32) + 0.5) / res * 2 - 1
        sx = self.cx + g[None, :] * self.half
        sy = self.cy - g[:, None] * self.half
        sx, sy = np.broadcast_to(sx, (res, res)).ravel(), np.broadcast_to(sy, (res, res)).ravel()
        o = sx[:, None] * self.r + sy[:, None] * self.u + self.vd * 6.0
        return o.astype(np.float32), -self.vd


def render(scene, cam, targets, res):
    fig, props = scene

    def sdf(x, y, z):
        d = fig.sdf(x, y, z)
        for f, _ in props:
            d = np.minimum(d, f(x, y, z))
        return d

    o, rd = cam.rays(res)
    n = o.shape[0]
    img = np.ones((n, 3), np.float32)

    # Floor at y = 0: where each ray meets it.
    t_floor = np.where(rd[1] < 0, o[:, 1] / -rd[1], 1e9).astype(np.float32)

    idx = np.arange(n)

    t = np.full(idx.size, 4.0, np.float32)  # rays start 6 m out; nothing is closer than 4 m
    hit = np.zeros(idx.size, bool)
    alive = np.ones(idx.size, bool)
    oo = o[idx]
    tf = t_floor[idx]
    for _ in range(140):
        a = np.nonzero(alive)[0]
        if a.size == 0:
            break
        p = oo[a] + t[a, None] * rd
        d = sdf(p[:, 0], p[:, 1], p[:, 2])
        t[a] += d
        done = d < 0.0008
        hit[a[done]] = True
        gone = t[a] > np.minimum(tf[a], 16.0)
        alive[a[done | gone]] = False

    # Shade surface hits.
    hi_i = np.nonzero(hit & (t < tf))[0]
    if hi_i.size:
        p = oo[hi_i] + t[hi_i, None] * rd
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        e = 0.0007
        k = np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], np.float32)
        nrm = sum(k[i] * sdf(x + k[i, 0] * e, y + k[i, 1] * e, z + k[i, 2] * e)[:, None] for i in range(4))
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9

        # material: body (grey, red where a target muscle is) or a prop
        dbody = fig.sdf(x, y, z)
        col = np.tile(BODY, (hi_i.size, 1))
        w = fig.muscle_weight(x, y, z, targets)[:, None]
        col = col * (1 - w) + MUSCLE * w
        for f, c in props:
            m = f(x, y, z) < dbody
            col[m] = c

        ao = np.ones(hi_i.size, np.float32)
        for i, hgt in enumerate((0.015, 0.035, 0.07, 0.12)):
            dd = sdf(x + nrm[:, 0] * hgt, y + nrm[:, 1] * hgt, z + nrm[:, 2] * hgt)
            ao -= (hgt - dd) * (2.2 / (i + 1))
        ao = np.clip(ao, 0, 1)

        l1 = -0.35 * cam.r + 0.75 * cam.u + 0.6 * cam.vd
        l1 /= np.linalg.norm(l1)
        l2 = 0.7 * cam.r + 0.1 * cam.u + 0.55 * cam.vd
        l2 /= np.linalg.norm(l2)
        dif1 = np.clip(nrm @ l1, 0, 1)
        dif2 = np.clip(nrm @ l2, 0, 1)
        hemi = 0.5 + 0.5 * nrm[:, 1]
        ref = rd - 2 * (nrm @ rd)[:, None] * nrm
        spec = np.clip(ref @ l1, 0, 1) ** 24
        rim = (1 - np.clip(nrm @ cam.vd, 0, 1)) ** 3
        light = 0.40 * hemi * ao + 0.62 * dif1 * (0.6 + 0.4 * ao) + 0.24 * dif2 * ao
        shade = col * light[:, None] + (0.10 * spec * ao + 0.07 * rim * ao)[:, None]
        img[idx[hi_i]] = np.clip(shade * 1.12, 0, 1)

    # Floor: white with a soft shadow and contact darkening near the feet.
    fl = idx[~(hit & (t < tf)) & (tf < 1e8)]
    if fl.size:
        p = o[fl] + t_floor[fl, None] * rd
        x, z = p[:, 0], p[:, 2]
        ls = np.array([0.12, 1.0, 0.22], np.float32)
        ls /= np.linalg.norm(ls)
        sh = np.ones(fl.size, np.float32)
        st = np.full(fl.size, 0.01, np.float32)
        for _ in range(28):
            q = p + st[:, None] * ls
            dd = sdf(q[:, 0], q[:, 1], q[:, 2])
            sh = np.minimum(sh, 6.0 * dd / st)
            st += np.clip(dd, 0.01, 0.15)
        sh = np.clip(sh, 0, 1)
        dd = sdf(x, np.full_like(x, 0.04), z)
        contact = np.clip(dd / 0.04, 0, 1)
        v = 1 - 0.16 * (1 - sh) - 0.12 * (1 - contact)
        img[fl] = v[:, None]

    return img.reshape(res, res, 3)


def joint_points(fig):
    """Every 3D point the figure's parts were built from, for framing the camera."""
    pts = []
    for group in [fig.torso] + fig.legs + fig.arms:
        for f, _ in group:
            for d in f.__defaults__ or ():
                if isinstance(d, np.ndarray) and d.shape == (3,):
                    pts.append(d)
    return np.array(pts)


def build(code):
    spec = EXERCISES[code]
    if 'setup' in spec:
        keys, props, arm_z = spec['setup']()
    else:
        keys, props, arm_z = spec['keys'], [], None
    poses = [pose_at(keys, frame_u(f)) for f in range(FRAMES)]
    figs = [Figure(skeleton(p), arm_z) for p in poses]
    return spec, props, figs


def framing(spec, props, figs):
    pts = []
    for fig in figs:
        p = joint_points(fig)
        lo, hi = p.min(0) - 0.1, p.max(0) + 0.1
        pts += [[x, y, z] for x in (lo[0], hi[0]) for y in (0.0, hi[1]) for z in (-0.3, 0.3)]
    return Camera(spec['az'], 9, np.array(pts, np.float32))


def render_frame(args):
    code, f = args
    spec, props, figs = build(code)
    fig = figs[f]
    if spec.get('dumbbells'):
        props = props + [(p, PROP) for p in dumbbell_parts(fig.hands)]
    cam = framing(spec, props, figs)
    img = render((fig, props), cam, spec['muscles'], OUT * SS)
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8))
    return Image.fromarray(snap_white(np.asarray(im.resize((OUT, OUT), Image.LANCZOS))))


def snap_white(a):
    """Makes the background pure white, so it matches the white cards it sits on."""
    a = a.copy()
    a[a.min(axis=2) >= 246] = 255
    return a


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    folder = os.path.join(here, '..', 'img', 'exercises')
    os.makedirs(folder, exist_ok=True)
    codes = sys.argv[1:] or list(EXERCISES)
    with Pool() as pool:
        for code in codes:
            frames = pool.map(render_frame, [(code, f) for f in range(FRAMES)])
            # one palette for every frame, so colours don't flicker
            sheet = Image.new('RGB', (OUT * 4, OUT))
            for i, f in enumerate((0, FRAMES // 4, FRAMES // 2 - 1, 3 * FRAMES // 4)):
                sheet.paste(frames[f], (i * OUT, 0))
            pal = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
            out = [fr.quantize(palette=pal, dither=Image.Dither.NONE) for fr in frames]
            path = os.path.join(folder, code + '.gif')
            out[0].save(path, save_all=True, append_images=out[1:], duration=FRAME_MS, loop=0, optimize=False)
            print('wrote', os.path.relpath(path, os.path.join(here, '..')), flush=True)


if __name__ == '__main__':
    main()
