# Claude 2026-11-11 (btgen.py): Bit-Clip Lab's own textures for the Banjo-Tooie viewer.
# Nothing from the original pictures is copied. From each original texture only a short description is measured:
#   - its colours: mean, a 3-colour palette, and the mean colour of each quarter (2x2), so blends (grass -> path) and
#     big pictures split over many tiles keep their overall tones
#   - its contrast, transparency coverage, which way its lines run and how many repeat across it
#   - a material class guessed from those numbers (noise, planks, brick, tiles, slats, panel, flat, sign, water, cutout, glow)
# and a new texture is painted procedurally from that description (seeded by the texture id, tiles seamlessly).
import numpy as np, colorsys, math, json, os

def _lum(rgb): return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114

def _strength(profile):
    p = profile - profile.mean(); n = len(p)
    if n < 4 or p.std() < 1e-6: return 0.0, 0
    F = np.abs(np.fft.rfft(p)) ** 2; F[0] = 0
    k = int(np.argmax(F[1:]) + 1)
    return float(F[k] / F.sum()), k

def describe(img):
    h, w = img.shape[:2]
    a = img[..., 3] / 255.0; op = a > 0.5; cov = float(op.mean())
    rgb = img[..., :3].astype(np.float64)
    sel = rgb[op] if op.sum() >= 4 else rgb.reshape(-1, 3)
    mean = sel.mean(0)
    L = _lum(rgb); Lf = np.where(op, L, _lum(mean[None, None, :])[0, 0] if mean.ndim == 1 else L.mean())
    std = float(L[op].std()) if op.sum() >= 4 else 0.0
    # 3-colour palette (k-means on the opaque pixels), dark -> light
    rng = np.random.default_rng(0); X = sel[rng.permutation(len(sel))[:2048]]
    lx = _lum(X); C = np.stack([X[lx <= np.quantile(lx, q)].mean(0) if (lx <= np.quantile(lx, q)).any() else X.mean(0) for q in (0.15, 0.5, 0.9)])
    for _ in range(8):
        d = ((X[:, None, :] - C[None]) ** 2).sum(-1); lab = d.argmin(1)
        C = np.stack([X[lab == k].mean(0) if (lab == k).any() else C[k] for k in range(3)])
    share = np.bincount(lab, minlength=3) / len(lab)
    order = np.argsort(_lum(C)); C = C[order]; share = share[order]
    # 5-step colour ramp of each quarter (mean colour of each luminance fifth), for blends like grass -> rock
    qp = np.zeros((2, 2, 5, 3))
    for i in range(2):
        for j in range(2):
            blk = rgb[i * h // 2:(i + 1) * h // 2, j * w // 2:(j + 1) * w // 2]; m = op[i * h // 2:(i + 1) * h // 2, j * w // 2:(j + 1) * w // 2]
            px = blk[m] if m.sum() >= 3 else sel
            lp = _lum(px); o_ = np.argsort(lp, kind='stable'); px = px[o_]; n_ = len(px)
            for k_ in range(5):                      # mean colour of each fifth of the pixels, darkest to lightest
                seg = px[k_ * n_ // 5:max(k_ * n_ // 5 + 1, (k_ + 1) * n_ // 5)]; qp[i, j, k_] = seg.mean(0)
    # quarter means
    q = np.zeros((2, 2, 3))
    for i in range(2):
        for j in range(2):
            blk = rgb[i * h // 2:(i + 1) * h // 2, j * w // 2:(j + 1) * w // 2]; m = op[i * h // 2:(i + 1) * h // 2, j * w // 2:(j + 1) * w // 2]
            q[i, j] = blk[m].mean(0) if m.sum() else mean
    hsv = np.array([colorsys.rgb_to_hsv(*(c / 255.0)) for c in sel[::max(1, len(sel) // 512)]])
    msat = float(hsv[:, 1].mean()); hue, sat, val = colorsys.rgb_to_hsv(*(mean / 255.0))
    vivid = float(((hsv[:, 1] > 0.6) & (hsv[:, 2] > 0.45)).mean())
    GX = np.abs(Lf - np.roll(Lf, 1, 1)); GY = np.abs(Lf - np.roll(Lf, 1, 0)); gx = GX.mean(); gy = GY.mean()
    anis = float((gx - gy) / (gx + gy + 1e-9))            # > 0: lines run vertically (changes along x)
    sy, ky = _strength(GY.mean(1)); sx, kx = _strength(GX.mean(0))    # repeats of horizontal / vertical edge lines
    bw = max(1, min(h, w) // 10); G = GX + GY; band = np.ones((h, w), bool); band[bw:h - bw, bw:w - bw] = False
    border = float(G[band].mean() / (G[~band].mean() + 1e-9)) if (~band).any() else 1.0
    inner = 0.0
    rough = float(G.mean() / (std + 1.0))
    d = dict(w=w, h=h, cov=round(cov, 3), mean=[round(v, 1) for v in mean], std=round(std, 2), pal=[[round(v, 1) for v in c] for c in C],
             share=[round(float(s), 3) for s in share], quad=[[[round(v, 1) for v in q[i, j]] for j in range(2)] for i in range(2)], qpal=np.round(qp, 1).tolist(),
             hue=round(hue * 360, 1), sat=round(sat, 3), msat=round(msat, 3), val=round(val, 3), vivid=round(vivid, 3),
             anis=round(anis, 3), rowp=[round(sy, 3), ky], colp=[round(sx, 3), kx], border=round(border, 3), rough=round(rough, 3))
    d['kind'] = classify(d)
    return d

def classify(d):
    hue, sat, std = d['hue'], d['msat'], d['std']
    sy, ky = d['rowp']; sx, kx = d['colp']
    if d['cov'] < 0.93: return 'cutout'
    if d['val'] > 0.85 and std < 25 and sat < 0.25: return 'glow'
    if d['vivid'] > 0.35 and std > 40 and d['rough'] < 1.0 and not (60 <= hue <= 170): return 'sign'
    if 170 <= hue <= 250 and sat > 0.25: return 'water'
    if std < 7: return 'flat'
    if abs(d['anis']) > 0.45: return 'slats' if max(sy, sx) > 0.3 else 'planks'
    if sy >= 0.3 and sx >= 0.3 and ky >= 2 and kx >= 2: return 'tiles'
    if sy >= 0.25 and 3 <= ky <= 8 and sx < sy: return 'brick'
    if d['border'] > 1.35: return 'panel'
    return 'noise'

# ---------- painting ----------
def _vnoise(h, w, gy, gx, rng):
    gy = max(1, gy); gx = max(1, gx); Lt = rng.random((gy, gx))
    y = np.arange(h) / h * gy; x = np.arange(w) / w * gx
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int); fy = y - y0; fx = x - x0
    sy = fy * fy * (3 - 2 * fy); sx = fx * fx * (3 - 2 * fx)
    a = Lt[y0 % gy][:, x0 % gx]; b = Lt[y0 % gy][:, (x0 + 1) % gx]; c = Lt[(y0 + 1) % gy][:, x0 % gx]; e = Lt[(y0 + 1) % gy][:, (x0 + 1) % gx]
    top = a + (b - a) * sx[None, :]; bot = c + (e - c) * sx[None, :]
    return top + (bot - top) * sy[:, None]

def fbm(h, w, rng, gy=2, gx=2, octaves=5, gain=0.55):
    s = np.zeros((h, w)); amp = 1.0
    for o in range(octaves):
        s += amp * _vnoise(h, w, gy << o, gx << o, rng); amp *= gain
    s -= s.mean(); sd = s.std()
    return s / sd if sd > 1e-9 else s

def _bilinear(quad, h, w):
    q = np.array(quad, np.float64)
    y = (np.arange(h) + 0.5) / h; x = (np.arange(w) + 0.5) / w
    # quarter centres at 0.25 / 0.75; extend flat beyond them
    ty = np.clip((y - 0.25) / 0.5, 0, 1)[:, None, None]; tx = np.clip((x - 0.25) / 0.5, 0, 1)[None, :, None]
    top = q[0, 0] * (1 - tx) + q[0, 1] * tx; bot = q[1, 0] * (1 - tx) + q[1, 1] * tx
    return top * (1 - ty) + bot * ty

def _palmap(P, pal, share):
    """Map a pattern field onto the palette by rank, so each palette colour covers about its share of the texture."""
    r = np.argsort(np.argsort(P.ravel())).reshape(P.shape) / max(1, P.size - 1)
    c = np.cumsum(share); pos = np.array([share[0] / 2, c[0] + share[1] / 2, c[1] + share[2] / 2])
    out = np.empty(P.shape + (3,))
    for ch in range(3): out[..., ch] = np.interp(r, pos, pal[:, ch])
    return out

def paint(d, seed, scale=2):
    h0, w0 = d['h'], d['w']; s = scale if max(h0, w0) < 64 else 1
    h, w = h0 * s, w0 * s; rng = np.random.default_rng(seed)
    kind = d['kind']; pal = np.array(d['pal'], np.float64); share = np.array(d['share'], np.float64); dark, mid, light = pal
    mean = np.array(d['mean'], np.float64)
    tone = _bilinear(d['quad'], h, w) - mean                 # where the original is lighter / darker / redder overall
    rough = d.get('rough', 0.6)
    g0 = 4 if rough < 0.6 else 8; gain = 0.55 + 0.2 * min(1.0, rough)
    grain = lambda: fbm(h, w, rng, g0, g0, 5 if g0 == 4 else 4, gain)
    P = None; alpha = np.full((h, w), 255.0); lines = None; hi = None
    yy, xx = np.mgrid[0:h, 0:w]; v = (yy + 0.5) / h; u = (xx + 0.5) / w
    if kind in ('noise', 'flat', 'glow', 'panel'):
        P = grain()
        if kind == 'noise': P = P + 0.35 * np.abs(fbm(h, w, rng, g0 * 2, g0 * 2, 3))
        if kind == 'panel':
            b = max(1.5, min(h, w) / 16.0); e = np.minimum(np.minimum(yy, h - 1 - yy), np.minimum(xx, w - 1 - xx)) < b
            lines = e & ((yy >= h - b) | (xx >= w - b)); hi = e & ~lines
            rr = max(1.2, min(h, w) / 24.0)
            for cy, cx in ((0.1, 0.1), (0.1, 0.9), (0.9, 0.1), (0.9, 0.9)):
                dd = np.hypot(yy + 0.5 - cy * h, xx + 0.5 - cx * w)
                hi = hi | (dd < rr * 0.7); lines = lines | ((dd >= rr * 0.7) & (dd < rr * 1.3) & (yy + 0.5 > cy * h))
    elif kind in ('planks', 'slats'):
        horiz = d['anis'] < 0
        n = max(2, min(12, (d['rowp'] if horiz else d['colp'])[1]))
        along, across = (u, v) if horiz else (v, u)
        idx = np.floor(across * n).astype(int); f = across * n - idx
        sz = (h if horiz else w) / n
        if kind == 'planks':
            P = 0.7 * fbm(h, w, rng, *((24, 2) if horiz else (2, 24)), 4) + (rng.random(n + 1)[idx % (n + 1)] - 0.5) * 1.5
            lines = np.minimum(f, 1 - f) * sz < 0.9
        else:
            P = np.cos(f * math.pi * 2) * -1.0 + 0.3 * grain()
            lines = f * sz > sz - max(1.0, sz * 0.22); hi = (f * sz < max(1.0, sz * 0.15))
    elif kind == 'brick':
        n = max(2, min(10, d['rowp'][1])); per = max(1, round(n * w / h / 2))
        r = np.floor(v * n).astype(int); fy = v * n - r
        uu = u * per + 0.5 * (r % 2); c = np.floor(uu).astype(int); fx = uu - c
        P = (rng.random((n + 1, per + 2))[r % (n + 1), c % (per + 1)] - 0.5) * 2.0 + 0.6 * grain()
        bh = h / n; bwid = w / per
        lines = (np.minimum(fy, 1 - fy) * bh < max(0.8, bh * 0.08)) | (np.minimum(fx, 1 - fx) * bwid < max(0.8, bh * 0.08))
    elif kind == 'tiles':
        ny = max(2, min(12, d['rowp'][1])); nx = max(2, min(12, d['colp'][1]))
        r = np.floor(v * ny).astype(int); c = np.floor(u * nx).astype(int); fy = v * ny - r; fx = u * nx - c
        P = (rng.random((ny + 1, nx + 1))[r, c] - 0.5) * 1.5 + 0.6 * grain()
        lines = (np.minimum(fy, 1 - fy) * h / ny < max(0.8, h / ny * 0.08)) | (np.minimum(fx, 1 - fx) * w / nx < max(0.8, w / nx * 0.08))
    elif kind == 'water':
        P = np.sin(2 * math.pi * (2 * u + v) + 2.5 * fbm(h, w, rng, 2, 2, 3)) + 0.7 * fbm(h, w, rng, 3, 3, 4)
    elif kind == 'sign':
        dom = pal[int(np.argmax(share))]; other = pal[0] if int(np.argmax(share)) != 0 else pal[2]
        b = max(1.5, min(h, w) / 12.0); e = np.minimum(np.minimum(yy, h - 1 - yy), np.minimum(xx, w - 1 - xx))
        rgb = np.where((e > b)[..., None] & (e < 2 * b)[..., None], other, dom) + 6 * grain()[..., None]
        out = np.zeros((h, w, 4), np.uint8); out[..., :3] = np.clip(np.rint(rgb + tone * 0.3), 0, 255); out[..., 3] = 255
        return out
    elif kind == 'cutout':
        sy, ky = d['rowp']; sx, kx = d['colp']
        if (sy > 0.3 or sx > 0.3) and max(ky, kx) >= 2:
            m = np.zeros((h, w))
            if sy > 0.3: m = np.maximum(m, 1 - np.abs(((v * ky) % 1) - 0.5) * 2)
            if sx > 0.3: m = np.maximum(m, 1 - np.abs(((u * kx) % 1) - 0.5) * 2)
            m = m + 0.05 * fbm(h, w, rng, 4, 4, 2)
        else:
            m = fbm(h, w, rng, 3, 3, 4)
        thr = np.quantile(m, 1 - d['cov']); alpha = np.where(m >= thr, 255.0, 0.0)
        P = grain()
    if 'qpal' in d:
        r = np.argsort(np.argsort(P.ravel())).reshape(P.shape) / max(1, P.size - 1)
        qp = np.array(d['qpal']); Q = np.zeros((2, 2, h, w, 3))
        for i in range(2):
            for j in range(2):
                stops = np.linspace(0.1, 0.9, qp.shape[2])
                for ch in range(3): Q[i, j, ..., ch] = np.interp(r, stops, qp[i, j, :, ch])
        ty = np.clip(((np.arange(h) + 0.5) / h - 0.25) / 0.5, 0, 1)[:, None, None]; tx = np.clip(((np.arange(w) + 0.5) / w - 0.25) / 0.5, 0, 1)[None, :, None]
        rgb = (Q[0, 0] * (1 - tx) + Q[0, 1] * tx) * (1 - ty) + (Q[1, 0] * (1 - tx) + Q[1, 1] * tx) * ty
    else:
        rgb = _palmap(P, pal, share) + tone
    if hi is not None: rgb = np.where(hi[..., None], rgb * 0.45 + light * 0.55, rgb)
    if lines is not None: rgb = np.where(lines[..., None], rgb * 0.35 + dark * 0.65 - 12, rgb)
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = np.clip(np.rint(rgb), 0, 255); out[..., 3] = alpha
    return out
