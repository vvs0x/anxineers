#!/usr/bin/env python3
"""Split a room splat into separate parts (walls, ceiling, floor, objects) so each can move on its own in Unity.

Each part is written as its own .ply, re-centred on its own middle, plus a manifest.json with every part's centre and size
(in the scan's own coordinates). The scan is expected to be y-down (COLMAP style), as scene.ply is.

Usage:
  python3 split_splat.py scene.ply Assets/_Project/Splats/parts
Defaults match scene.ply (hall box, floor and ceiling heights). Override with the options if you use another scan.
Needs numpy.
"""
import argparse
import json
import os
from collections import deque

import numpy as np


def read_ply(path):
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            header += f.readline()
        names, count = [], 0
        for line in header.decode().splitlines():
            if line.startswith("element vertex"):
                count = int(line.split()[-1])
            elif line.startswith("property"):
                names.append(line.split()[2])
        dt = np.dtype([(n, "<f4") for n in names])
        return names, np.fromfile(f, dtype=dt, count=count)


def write_ply(path, names, data):
    head = "ply\nformat binary_little_endian 1.0\nelement vertex %d\n" % len(data)
    head += "".join("property float %s\n" % n for n in names) + "end_header\n"
    with open(path, "wb") as f:
        f.write(head.encode())
        f.write(data.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("outdir")
    ap.add_argument("--box", type=float, nargs=6, default=[-6, 6, -2.6, 0.9, -0.4, 4.8])
    ap.add_argument("--ceiling-y", type=float, default=-2.1, help="splats above this (smaller y) are ceiling")
    ap.add_argument("--floor-y", type=float, default=0.42, help="splats below this (larger y) are floor")
    ap.add_argument("--wall-x", type=float, default=5.0, help="|x| beyond this is a side wall")
    ap.add_argument("--wall-zmax", type=float, default=4.1, help="z beyond this is the far wall")
    ap.add_argument("--wall-zmin", type=float, default=0.5, help="z below this is the near (inner) wall")
    ap.add_argument("--occupancy", type=int, default=6, help="splats per cell for a cell to count as occupied")
    ap.add_argument("--cell", type=float, default=0.15, help="grid cell size in metres for finding objects")
    ap.add_argument("--min-object", type=int, default=6000, help="minimum splats for a separate object")
    ap.add_argument("--max-objects", type=int, default=20)
    ap.add_argument("--attach-dist", type=float, default=0.45, help="objects closer than this to a wall are marked as wall mounted")
    args = ap.parse_args()

    names, a = read_ply(args.src)
    x0, x1, y0, y1, z0, z1 = args.box
    keep = (a["x"] >= x0) & (a["x"] <= x1) & (a["y"] >= y0) & (a["y"] <= y1) & (a["z"] >= z0) & (a["z"] <= z1)
    a = a[keep]
    print("splats in the hall box:", len(a))

    x, y, z = a["x"], a["y"], a["z"]
    label = np.full(len(a), "", dtype=object)
    label[y < args.ceiling_y] = "ceiling"
    rest = label == ""
    label[rest & (y > args.floor_y)] = "floor"
    rest = label == ""
    label[rest & (x < -args.wall_x)] = "wall_xneg"
    rest = label == ""
    label[rest & (x > args.wall_x)] = "wall_xpos"
    rest = label == ""
    label[rest & (z > args.wall_zmax)] = "wall_zpos"
    rest = label == ""
    label[rest & (z < args.wall_zmin)] = "wall_zneg"

    # Objects: connected blobs of the remaining interior splats, seen from above.
    inner = np.where(label == "")[0]
    cell = args.cell
    gx = np.floor((x[inner] - x0) / cell).astype(int)
    gz = np.floor((z[inner] - z0) / cell).astype(int)
    W, H = gx.max() + 3, gz.max() + 3
    counts = np.zeros((W, H), int)
    np.add.at(counts, (gx + 1, gz + 1), 1)
    occ = counts >= args.occupancy
    occ_d = occ.copy()
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            occ_d |= np.roll(np.roll(occ, dx, 0), dz, 1)
    comp = np.zeros((W, H), int)
    n = 0
    for sx in range(W):
        for sz in range(H):
            if occ_d[sx, sz] and comp[sx, sz] == 0:
                n += 1
                q = deque([(sx, sz)])
                comp[sx, sz] = n
                while q:
                    cx, cz = q.popleft()
                    for ddx, ddz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, nz = cx + ddx, cz + ddz
                        if 0 <= nx < W and 0 <= nz < H and occ_d[nx, nz] and comp[nx, nz] == 0:
                            comp[nx, nz] = n
                            q.append((nx, nz))
    cid = comp[gx + 1, gz + 1]
    sizes = np.bincount(cid, minlength=n + 1)
    order = [c for c in np.argsort(-sizes) if c != 0 and sizes[c] >= args.min_object][: args.max_objects]
    for rank, c in enumerate(order):
        label[inner[cid == c]] = "object_%02d" % (rank + 1)
    label[label == ""] = "misc"

    os.makedirs(args.outdir, exist_ok=True)
    for f in os.listdir(args.outdir):
        if f.endswith(".ply") or f == "manifest.json":
            os.remove(os.path.join(args.outdir, f))

    manifest = []
    for name in sorted(set(label)):
        part = a[label == name].copy()
        lo = np.array([part["x"].min(), part["y"].min(), part["z"].min()])
        hi = np.array([part["x"].max(), part["y"].max(), part["z"].max()])
        # 2nd to 98th percentile keeps stray floaters from inflating the size
        plo = np.array([np.percentile(part[k], 2) for k in "xyz"])
        phi = np.array([np.percentile(part[k], 98) for k in "xyz"])
        centre = (plo + phi) / 2.0
        part["x"] -= centre[0]
        part["y"] -= centre[1]
        part["z"] -= centre[2]
        fname = "part_%s.ply" % name
        write_ply(os.path.join(args.outdir, fname), names, part)
        kind = "object" if name.startswith("object") else name
        manifest.append({"name": name, "file": fname, "kind": kind, "count": int(len(part)),
                         "centre": [round(float(v), 4) for v in centre],
                         "size": [round(float(v), 4) for v in (phi - plo)]})
        print("%-10s %8d splats  centre %s  size %s" % (name, len(part), manifest[-1]["centre"], manifest[-1]["size"]))

    # Mark objects that stand close to a wall: they move with that wall instead of on their own.
    walls = {"wall_xneg": ("x", x0 if False else -args.wall_x - 0.5), "wall_xpos": ("x", args.wall_x + 0.5),
             "wall_zpos": ("z", args.wall_zmax + 0.3), "wall_zneg": ("z", 0.0)}
    for m in manifest:
        if m["kind"] != "object":
            continue
        best, best_d = None, 1e9
        for wname, (axis, pos) in walls.items():
            i = 0 if axis == "x" else 2
            d = abs(m["centre"][i] - pos) - m["size"][i] / 2.0
            if d < best_d:
                best, best_d = wname, d
        if best_d < args.attach_dist:
            m["attach_to"] = best
        print("%-10s nearest wall %s at %.2f m%s" % (m["name"], best, best_d, "  -> attached" if "attach_to" in m else ""))

    with open(os.path.join(args.outdir, "manifest.json"), "w") as f:
        json.dump({"parts": manifest}, f, indent=2)
    print("wrote", len(manifest), "parts to", args.outdir)


if __name__ == "__main__":
    main()
