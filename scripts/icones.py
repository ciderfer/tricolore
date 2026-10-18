# Tricolore — génère icons/icon.svg, icon-maskable.svg et favicon.svg (motif original : chandail rouge, bande bleu-blanc, « T »).
# Les PNG sont rendus depuis ces SVG (navigateur sans tête) : apple-touch-icon 180, 192, 512, maskable 512, favicon 32 et .ico 16/32/48.
import sys
def svg(maskable=False, size=1024, small=False):
    # Géométrie sur 1024. Version « maskable » : tout le motif dans le cercle central de 80 %.
    s = 0.78 if maskable else 1.0
    o = 512*(1-s)
    def r(x,y,w,h,c): return f'<rect x="{o+x*s:.1f}" y="{o+y*s:.1f}" width="{w*s:.1f}" height="{h*s:.1f}" fill="{c}"/>'
    band = (f'<rect x="0" y="{o+606*s:.1f}" width="1024" height="{40*s:.1f}" fill="#fff"/>'
            f'<rect x="0" y="{o+646*s:.1f}" width="1024" height="{120*s:.1f}" fill="#192168"/>'
            f'<rect x="0" y="{o+766*s:.1f}" width="1024" height="{40*s:.1f}" fill="#fff"/>')
    T = r(212,170,600,156,"#fff") + r(434,170,156,712,"#fff")
    # Points du mot-symbole (blanc cerclé de bleu), de part et d'autre du pied du T, dans la bande.
    dot = "".join(f'<circle cx="{o+cx*s:.1f}" cy="{o+706*s:.1f}" r="{30*s:.1f}" fill="#fff" stroke="#192168" stroke-width="{0*s:.1f}"/>' for cx in (300,724)) if not small else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="{size}" height="{size}"><rect width="1024" height="1024" fill="#AF1E2D"/>{band}{T}{dot}</svg>'
import re
open("icons/icon.svg","w").write(svg())
open("icons/icon-maskable.svg","w").write(svg(True))

open("icons/favicon.svg","w").write(re.sub(r' width="\d+" height="\d+"', '', svg(small=True), count=1))
