from PIL import Image
import numpy as np

im = Image.open('assets/shp-logo.webp').convert('L')
im = im.resize((512, 512), Image.LANCZOS)
arr = np.array(im)
threshold = 128
mask = arr < threshold

h, w = mask.shape
visited = np.zeros_like(mask, dtype=bool)
rects = []

for y in range(h):
    for x in range(w):
        if mask[y, x] and not visited[y, x]:
            x2 = x
            while x2 < w and mask[y, x2] and not visited[y, x2]:
                x2 += 1
            y2 = y
            while y2 < h:
                if np.all(mask[y2, x:x2]) and not np.any(visited[y2, x:x2]):
                    y2 += 1
                else:
                    break
            visited[y:y2, x:x2] = True
            rects.append((x, y, x2, y2))

svg_parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">']
svg_parts.append('<rect width="100%" height="100%" fill="white"/>')
for x1, y1, x2, y2 in rects:
    svg_parts.append(f'<rect x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}" fill="black"/>')
svg_parts.append('</svg>')

with open('assets/shp-logo.svg', 'w', encoding='utf-8') as f:
    f.write('\n'.join(svg_parts))

print('rects:', len(rects))
