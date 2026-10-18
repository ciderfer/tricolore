# Tricolore — génère les SVG de l'icône (variante A « numéro cousu ») dans icons/.
# Motif original : chandail rouge, bande blanc/bleu/blanc, « T » de la police Graduate (OFL)
# en bleu, contours blanc / rouge / blanc, ombre rouge foncé (sous la bande, donc invisible sur les rayures).
# Le T est converti en tracé : les SVG n'ont besoin d'aucune police.
# Les PNG (180, 192, 512, maskable 512, favicons 16/32/48 et .ico) sont rendus depuis ces SVG.
R, B, W, SH = "#AF1E2D", "#192168", "#fff", "#741420"
T_PATH = "M436 0H144V80H244V670H96V554H20V750H560V554H484V670H336V80H436Z"  # Graduate « T », unités 1000/em, ligne de base y=0
ADV = 580

def t_layer(color, stroke, cx, base, size, dx=0, dy=0):
    k = size / 1000
    tr = f"translate({cx - k * ADV / 2 + dx:.1f} {base + dy:.1f}) scale({k:.4f} {-k:.4f})"
    st = f' stroke="{color}" stroke-width="{stroke / k:.1f}" stroke-linejoin="round"' if stroke else ""
    return f'<path transform="{tr}" d="{T_PATH}" fill="{color}"{st}/>'

def svg(kind="full"):
    # kind : full (iOS, 192, 512), maskable (motif dans le cercle sûr de 80 %), small (favicons)
    if kind == "small":
        cx, base, size = 512, 900, 1050
        layers = [(W, 150, 0, 0), (B, 0, 0, 0)]
        band_y, band_h, shadow = 600, 220, False
    else:
        s = 0.76 if kind == "maskable" else 1.0
        cx, base, size = 512, 512 + (872 - 512) * s, 900 * s
        layers = [(W, 150 * s, 0, 0), (R, 112 * s, 0, 0), (W, 62 * s, 0, 0), (B, 0, 0, 0)]
        band_y, band_h, shadow = 512 + (610 - 512) * s, 200 * s, True
    st = band_h * 0.2
    out = [f'<rect width="1024" height="1024" fill="{R}"/>']
    if shadow:  # ombre sous la bande : seulement visible sur le rouge
        out.append(t_layer(SH, layers[0][1], cx, base, size, 22 * (size / 900), 24 * (size / 900)))
    out.append(f'<rect y="{band_y:.1f}" width="1024" height="{st:.1f}" fill="{W}"/>'
               f'<rect y="{band_y + st:.1f}" width="1024" height="{band_h - 2 * st:.1f}" fill="{B}"/>'
               f'<rect y="{band_y + band_h - st:.1f}" width="1024" height="{st:.1f}" fill="{W}"/>')
    out += [t_layer(c, w, cx, base, size) for c, w, _, _ in layers]
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">' + "".join(out) + "</svg>"

if __name__ == "__main__":
    import pathlib
    d = pathlib.Path(__file__).resolve().parent.parent / "icons"
    d.mkdir(exist_ok=True)
    (d / "icon.svg").write_text(svg("full"))
    (d / "icon-maskable.svg").write_text(svg("maskable"))
    (d / "favicon.svg").write_text(svg("small"))
    print("icons/icon.svg, icons/icon-maskable.svg, icons/favicon.svg")
