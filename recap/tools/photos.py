#!/usr/bin/env python3
"""Turns the downloaded album into the recap's web photos.

    python3 recap/tools/photos.py sheet <work>     contact sheets to pick and caption from
    python3 recap/tools/photos.py init  <work>     print a "photos" list to paste into content.json
    python3 recap/tools/photos.py build <work>     write site/recap/photos/

<work> is the folder fetch-icloud.mjs filled (items.json and raw/). Needs
Pillow (pip install pillow).

build writes, for photo NN:
  NN.jpg    the photo viewer's copy, 1600px on the long side
  NN-t.jpg  the timeline strip's thumbnail, 720px on the long side
  NN-c.jpg  a 3:2 crop at 840x560 for a speaker's card, only for photos that
            have a "crop" in content.json: [x, y, width], where x and y are
            the centre of the crop as fractions of the photo (0.5, 0.4 is
            just above the middle) and width is the share of the photo's
            width to keep. Tighter is better for a face at the mic: 0.5.

Run sheet first: it numbers every photo with its time, which is how the
speaking order in the transcript gets matched to faces. Run build again
after changing a crop, then look at <work>/crops.jpg.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.join(ROOT, "site", "recap", "photos")
CONTENT = os.path.join(ROOT, "recap", "content.json")


def load(work):
    items = json.load(open(os.path.join(work, "items.json")))
    return items, {it["n"]: it for it in items}


def open_photo(work, it):
    return ImageOps.exif_transpose(Image.open(os.path.join(work, it["file"]))).convert("RGB")


def save(im, path, quality):
    im.save(path, quality=quality, optimize=True, progressive=True)


def sheet(work, items, name, label, cols=6, tw=300, th=200):
    rows = (len(items) + cols - 1) // cols
    s = Image.new("RGB", (cols * tw, rows * (th + 18)), "white")
    d = ImageDraw.Draw(s)
    for k, (im, text) in enumerate(items):
        t = im.copy()
        t.thumbnail((tw - 4, th - 4))
        x, y = (k % cols) * tw, (k // cols) * (th + 18)
        s.paste(t, (x + 2, y + 2))
        d.text((x + 4, y + th + 2), text, fill="black")
    s.save(os.path.join(work, name), quality=80)
    print(f"wrote {os.path.join(work, name)} ({label})")


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("sheet", "init", "build"):
        sys.exit(__doc__)
    cmd, work = sys.argv[1], sys.argv[2]
    items, by = load(work)

    if cmd == "sheet":
        per = 36
        for p in range(0, len(items), per):
            chunk = items[p:p + per]
            sheet(work, [(open_photo(work, it), f'{it["n"]:02d}  {it["time"]}') for it in chunk],
                  f"sheet{p // per + 1}.jpg", f'photos {chunk[0]["n"]} to {chunk[-1]["n"]}')
        return

    if cmd == "init":
        out = []
        for it in items:
            w, h = it["w"], it["h"]
            out.append({"n": it["n"], "time": it["time"], "caption": "", "w": w, "h": h})
        print(json.dumps(out, indent=2))
        return

    content = json.load(open(CONTENT))
    crops = {p["n"]: p["crop"] for p in content["photos"] if p.get("crop")}
    os.makedirs(OUT, exist_ok=True)
    made = []
    for it in items:
        n = it["n"]
        im = open_photo(work, it)
        big = im.copy()
        big.thumbnail((1600, 1600), Image.LANCZOS)
        save(big, os.path.join(OUT, f"{n:02d}.jpg"), 78)
        small = im.copy()
        small.thumbnail((720, 720), Image.LANCZOS)
        save(small, os.path.join(OUT, f"{n:02d}-t.jpg"), 76)
        if n in crops:
            cx, cy, f = crops[n]
            W, H = im.size
            cw = W * f
            ch = cw * 2 / 3
            if ch > H:
                ch = H
                cw = ch * 1.5
            x0 = min(max(cx * W - cw / 2, 0), W - cw)
            y0 = min(max(cy * H - ch / 2, 0), H - ch)
            c = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch))).resize((840, 560), Image.LANCZOS)
            save(c, os.path.join(OUT, f"{n:02d}-c.jpg"), 78)
            made.append((c, f"{n:02d}"))
    print(f"wrote {len(items)} photos, {len(items)} thumbnails and {len(made)} card crops to {OUT}")
    if made:
        sheet(work, made, "crops.jpg", "every card crop, to check faces are in frame")


if __name__ == "__main__":
    main()
