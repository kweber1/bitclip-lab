# Claude 2026-11-11 (btrice.py): GLideN64 / Rice hi-res texture checksums for Banjo-Tooie level textures, to match
# texture-pack file names "BANJO TOOIE#<crc>#<fmt>#<size>[#<palette crc>]_<suffix>.png".
import struct
def rice(src, off, width, height, size, stride):
    bpw = ((width << size) + 1) >> 1; crc = 0
    for r in range(height):
        y = height - 1 - r; esi = 0; x = bpw - 4; base = off + r * stride
        while x >= 0:
            esi = struct.unpack_from('>I', src, base + x)[0] ^ x
            crc = (((crc << 4) & 0xFFFFFFFF) + ((crc >> 28) & 15)) & 0xFFFFFFFF
            crc = (crc + esi) & 0xFFFFFFFF; x -= 4
        esi ^= y; crc = (crc + esi) & 0xFFFFFFFF
    return crc
def cimax(src, off, n, four):
    b = src[off:off + (n // 2 if four else n)]
    return max(max(v >> 4, v & 15) for v in b) if four else max(b)
def checksums(e):
    """(texture crc, fmt code, size code, palette crc or None) as GLideN64 names them, for a bttex.setup() entry."""
    f = e['fmt'] & 0xFF; w, h = e['w'], e['h']; raw = e['raw'] + b'\0' * 8
    if f == 1:   # CI4
        pix = 0x20; crc = rice(raw, pix, w, h, 0, w // 2)
        cm = cimax(raw, pix, w * h, True)
        return crc, 2, 0, raw[:0x20], cm
    if f == 2:   # CI8
        pix = 0x200; crc = rice(raw, pix, w, h, 1, w)
        cm = cimax(raw, pix, w * h, False)
        return crc, 2, 1, raw[:0x200], cm
    if f == 4: return rice(raw, 0, w, h, 2, w * 2), 0, 2, None, 0
    if f == 8: return rice(raw, 0, w, h, 3, w * 4), 0, 3, None, 0
    if f == 0x10: return rice(raw, 0, w, h, 1, w), 3, 1, None, 0
    return None
def palcrc(pal, cm, swap):
    p = pal + b'\0' * 8
    if swap: p = b''.join(p[i + 2:i + 4] + p[i:i + 2] for i in range(0, len(p) - 3, 4))
    return rice(p, 0, cm + 1, 1, 2, 512)
