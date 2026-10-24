#!/usr/bin/env python3
"""Cut a big 3D Gaussian splat .ply down to a size the headset PC can render well.

Keeps the splats that matter most (opacity times visible size), drops far floaters, and can crop to a box so the budget
goes to the part of the scan the user actually sees. Needs numpy. Input and output are standard 3DGS .ply files
(binary little endian, float properties). Higher SH bands (f_rest_*) are kept if present.

Usage:
  python3 decimate_splat.py scene.ply out_2m.ply --max 2000000
  python3 decimate_splat.py scene.ply out_hall.ply --max 2500000 --box -6 6 -3 3 -1 5.2
  (--box is xmin xmax ymin ymax zmin zmax in the scan's own coordinates)
"""
import argparse
import numpy as np


def read_ply(path):
    with open(path, "rb") as f:
        header = b""
        while not header.endswith(b"end_header\n"):
            line = f.readline()
            if not line:
                raise SystemExit("not a valid ply header")
            header += line
        names, count = [], 0
        for line in header.decode().splitlines():
            if line.startswith("element vertex"):
                count = int(line.split()[-1])
            elif line.startswith("property"):
                parts = line.split()
                if parts[1] != "float":
                    raise SystemExit("only float properties are supported, got: " + line)
                names.append(parts[2])
        dt = np.dtype([(n, "<f4") for n in names])
        data = np.fromfile(f, dtype=dt, count=count)
    return names, data


def write_ply(path, names, data):
    head = "ply\nformat binary_little_endian 1.0\nelement vertex %d\n" % len(data)
    head += "".join("property float %s\n" % n for n in names) + "end_header\n"
    with open(path, "wb") as f:
        f.write(head.encode())
        f.write(data.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--max", type=int, default=2000000, help="maximum number of splats to keep")
    ap.add_argument("--box", type=float, nargs=6, metavar=("X0", "X1", "Y0", "Y1", "Z0", "Z1"))
    ap.add_argument("--trim", type=float, default=3.0, help="percent trimmed on each side of every axis to drop far floaters (ignored with --box)")
    args = ap.parse_args()

    names, a = read_ply(args.src)
    print("read", len(a), "splats")

    keep = np.ones(len(a), bool)
    if args.box:
        x0, x1, y0, y1, z0, z1 = args.box
        keep &= (a["x"] >= x0) & (a["x"] <= x1) & (a["y"] >= y0) & (a["y"] <= y1) & (a["z"] >= z0) & (a["z"] <= z1)
    else:
        for k in "xyz":
            lo, hi = np.percentile(a[k], [args.trim, 100 - args.trim])
            keep &= (a[k] >= lo) & (a[k] <= hi)
    idx = np.where(keep)[0]
    print("inside crop:", len(idx))

    op = 1.0 / (1.0 + np.exp(-a["opacity"][idx]))
    size = np.exp(np.maximum.reduce([a["scale_0"][idx], a["scale_1"][idx], a["scale_2"][idx]]))
    importance = op * size * size
    if len(idx) > args.max:
        idx = idx[np.argsort(-importance)[: args.max]]
    out = a[idx]
    write_ply(args.dst, names, out)
    print("wrote", len(out), "splats to", args.dst, "(%.0f MB)" % (len(out) * len(names) * 4 / 1e6))


if __name__ == "__main__":
    main()
