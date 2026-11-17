#!/usr/bin/env python3
"""Minimal P6 PPM -> PNG converter using only the Python stdlib (zlib)."""
import struct
import sys
import zlib


def read_ppm(path):
    with open(path, "rb") as f:
        data = f.read()
    tokens = []
    i = 0

    def token():
        nonlocal i
        while i < len(data) and data[i] in b" \t\n\r":
            i += 1
        if data[i:i + 1] == b"#":
            while i < len(data) and data[i] not in b"\n\r":
                i += 1
            return token()
        start = i
        while i < len(data) and data[i] not in b" \t\n\r":
            i += 1
        return data[start:i]

    magic = token()
    assert magic == b"P6", f"unsupported magic {magic}"
    width = int(token())
    height = int(token())
    maxv = int(token())
    i += 1  # single whitespace separator after maxval
    pixels = data[i:i + width * height * 3]
    assert len(pixels) == width * height * 3
    return width, height, maxv, pixels


def chunk(tag, payload):
    return (struct.pack(">I", len(payload)) + tag + payload +
            struct.pack(">I", zlib.crc32(tag + payload) & 0xffffffff))


def convert(src, dst):
    width, height, maxv, px = read_ppm(src)
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0 (none)
        row = px[y * stride:(y + 1) * stride]
        if maxv != 255:
            row = bytes(int(v * 255 / maxv) for v in row)
        raw.extend(row)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", ihdr) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 6)) +
           chunk(b"IEND", b""))
    with open(dst, "wb") as f:
        f.write(png)
    print(f"{src} -> {dst} ({width}x{height})")


if __name__ == "__main__":
    assert len(sys.argv) == 3, "usage: ppm_to_png.py in.ppm out.png"
    convert(sys.argv[1], sys.argv[2])
