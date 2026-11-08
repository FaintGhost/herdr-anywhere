"""One frame of the Herdr window, as `herdr-app shot` saved it: the QR codes on it, and two copies.

    python frame.py <shot.png> <invite file> <masked.png> <ocr.png> [<button folder>]

Writes what a QR code on the frame holds to <invite file> (nothing if it holds none), the frame with every code
painted over to <masked.png>, which can be shown in public, and the frame twice as large in grey to <ocr.png>, which
Windows' OCR reads better; and each dark button alone, inverted, on a white margin and four times as large, to
<button folder>/<n>.png: Windows' OCR reads no word on a small dark button within the whole frame, even inverted
(runs 42445246935 and 42446474717 read the dialog's line but never its Start). Prints "button <n> <x>,<y>" (its centre
on the frame) per button, and only "qr <width>x<height> at <x>,<y>" per code, never what it holds.
Needs zxing-cpp and Pillow.
"""
import os
import sys

import zxingcpp
from PIL import Image, ImageDraw, ImageOps


def buttons(grey):
    """Boxes of near-black filled shapes the size of a button, found on a half-size copy."""
    small = grey.resize((grey.width // 2, grey.height // 2))
    w, h = small.size
    px = small.load()
    seen = bytearray(w * h)
    found = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0 * w + x0] or px[x0, y0] > 60:
                continue
            stack, n = [(x0, y0)], 0
            seen[y0 * w + x0] = 1
            x1, y1, x2, y2 = x0, y0, x0, y0
            while stack:
                x, y = stack.pop()
                n += 1
                x1, y1, x2, y2 = min(x1, x), min(y1, y), max(x2, x), max(y2, y)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny] <= 60:
                        seen[ny * w + nx] = 1
                        stack.append((nx, ny))
            bw, bh = x2 - x1 + 1, y2 - y1 + 1
            if 15 <= bw <= 160 and 8 <= bh <= 40 and n >= 0.5 * bw * bh:
                found.append((x1 * 2, y1 * 2, (x2 + 1) * 2, (y2 + 1) * 2))
    return found


def main(shot, invite, masked, ocr, button_dir=None):
    image = Image.open(shot).convert("RGB")
    codes = zxingcpp.read_barcodes(image, formats=zxingcpp.BarcodeFormat.QRCode)
    texts = []
    draw = ImageDraw.Draw(image)
    for code in codes:
        p = code.position
        xs = [p.top_left.x, p.top_right.x, p.bottom_right.x, p.bottom_left.x]
        ys = [p.top_left.y, p.top_right.y, p.bottom_right.y, p.bottom_left.y]
        # The quiet zone too: a code painted to its finder patterns' edge still shows a module or two.
        pad = max(12, (max(xs) - min(xs)) // 8)
        box = (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)
        draw.rectangle(box, fill=(128, 128, 128))
        print(f"qr {box[2] - box[0]}x{box[3] - box[1]} at {box[0]},{box[1]}")
        texts.append(code.text)
    # Only this process can read the file: os.open's mode is applied on POSIX, and on Windows the runner's temp
    # folder is the runner account's.
    fd = os.open(invite, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(texts))
    image.save(masked)
    grey = ImageOps.grayscale(Image.open(shot).convert("RGB"))
    big = grey.resize((grey.width * 2, grey.height * 2), Image.LANCZOS)
    big.save(ocr)
    if button_dir:
        os.makedirs(button_dir, exist_ok=True)
        for name in os.listdir(button_dir):
            os.remove(os.path.join(button_dir, name))
        for i, box in enumerate(buttons(grey)):
            crop = ImageOps.invert(grey.crop(box))
            crop = ImageOps.expand(crop, border=16, fill=255)
            crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS).save(os.path.join(button_dir, f"{i}.png"))
            print(f"button {i} {(box[0] + box[2]) // 2},{(box[1] + box[3]) // 2}")


if __name__ == "__main__":
    if len(sys.argv) not in (5, 6):
        sys.exit(__doc__)
    main(*sys.argv[1:])
