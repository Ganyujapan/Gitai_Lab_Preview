#!/usr/bin/env python3
"""Losslessly restore the 720x1280 Kusagi PNG from its native 90x160 pixel grid.
Only standard-library modules are required. The 720px original was exactly
90x160 pixels enlarged eightfold with nearest-neighbor sampling.
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "img/backgrounds/bg_kusagi_source_90x160.png"
TARGET = ROOT / "img/backgrounds/bg_kusagi_720x1280_01.png"
MAGIC = b"\x89PNG\r\n\x1a\n"


def chunks(data):
    pos = 8
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        yield tag, body
        pos += 12 + length


def make_chunk(tag, body):
    return (struct.pack(">I", len(body)) + tag + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xffffffff))


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def reconstruct(source=SOURCE, target=TARGET):
    content = source.read_bytes()
    if not content.startswith(MAGIC):
        raise ValueError("Not a PNG")
    blocks = list(chunks(content))
    ihdr = next(d for t, d in blocks if t == b"IHDR")
    width, height, depth, mode, compression, filtering, interlace = struct.unpack(">IIBBBBB", ihdr)
    if (width, height, depth, mode, compression, filtering, interlace) != (90, 160, 8, 3, 0, 0, 0):
        raise ValueError("Unexpected Kusagi PNG source format")
    palette = next(d for t, d in blocks if t == b"PLTE")
    stream = zlib.decompress(b"".join(d for t, d in blocks if t == b"IDAT"))
    row_bytes = width
    pointer, previous = 0, bytearray(row_bytes)
    out = bytearray()
    for _ in range(height):
        filter_id = stream[pointer]
        row = bytearray(stream[pointer + 1:pointer + 1 + row_bytes])
        pointer += 1 + row_bytes
        for x in range(row_bytes):
            a = row[x - 1] if x else 0
            b = previous[x]
            c = previous[x - 1] if x else 0
            if filter_id == 1: row[x] = (row[x] + a) & 255
            elif filter_id == 2: row[x] = (row[x] + b) & 255
            elif filter_id == 3: row[x] = (row[x] + ((a + b) // 2)) & 255
            elif filter_id == 4: row[x] = (row[x] + paeth(a, b, c)) & 255
            elif filter_id != 0: raise ValueError("Unsupported PNG filter")
        previous = row
        expanded = b"".join(bytes((px,)) * 8 for px in row)
        out.extend((b"\x00" + expanded) * 8)
    if pointer != len(stream):
        raise ValueError("Extra source data")
    result_ihdr = struct.pack(">IIBBBBB", 720, 1280, 8, 3, 0, 0, 0)
    result = (MAGIC + make_chunk(b"IHDR", result_ihdr)
              + make_chunk(b"PLTE", palette)
              + make_chunk(b"IDAT", zlib.compress(out, level=9))
              + make_chunk(b"IEND", b""))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(result)
    print(f"Reconstructed {target}: {len(result)} bytes, 720x1280, pixel-perfect")


if __name__ == "__main__":
    reconstruct()
