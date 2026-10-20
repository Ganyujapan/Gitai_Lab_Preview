#!/usr/bin/env python3
"""Build a fully self-contained, scoped GitHub Pages PWA for the exhibition."""
from __future__ import annotations
import json
import re
import shutil
import sys
from pathlib import Path

def main() -> None:
    site = Path(sys.argv[1]).resolve()
    build = sys.argv[2] if len(sys.argv) > 2 else "local"
    root = Path(__file__).resolve().parent
    exhibit = site / "exhibit"
    exhibit.mkdir(parents=True, exist_ok=True)

    # All runtime files are physically inside the exhibit scope. The service
    # worker must not control/cache normal public-preview paths.
    for folder in ("config", "css", "data", "environments", "img", "js", "species"):
        shutil.copytree(site / folder, exhibit / folder, dirs_exist_ok=True)

    page = (site / "index.html").read_text(encoding="utf-8")
    page = re.sub(
        r'\s*<link rel="stylesheet" href="https://fonts\.googleapis\.com/[^"]*">',
        "", page
    )
    page = page.replace("</head>", '<link rel="stylesheet" href="game.css">\n</head>', 1)
    assert "</body>" in page and "js/pages_preview.js" in page
    page = page.replace("</body>", '<script src="game.js"></script>\n</body>', 1)
    (exhibit / "game.html").write_text(page, encoding="utf-8")

    # Namespace the complete IndexedDB database without modifying the shared
    # evolution engine. Critical for the warning run, whose run_id is fixed.
    engine = exhibit / "js" / "pages_preview.js"
    engine_js = engine.read_text(encoding="utf-8")
    db_declaration = "  const DB_NAME = EVOLUTION_MODEL_ID"
    version_declaration = "  const DB_VERSION = 2;"
    assert engine_js.count(db_declaration) == 1
    assert engine_js.count(version_declaration) == 1
    engine_js = engine_js.replace(
        db_declaration, "  const BASE_DB_NAME = EVOLUTION_MODEL_ID", 1
    ).replace(
        version_declaration,
        "  const DB_NAME = 'gitai-exhibit-2026-' + BASE_DB_NAME;\n"
        "  const DB_VERSION = 2;", 1
    )
    engine.write_text(engine_js, encoding="utf-8")

    # Remove the only dynamically injected third-party font fetch in the game.
    # Installed system fonts provide an offline fallback.
    portal_js = exhibit / "js" / "entertainment_portal.js"
    portal_js.write_text(
        portal_js.read_text(encoding="utf-8").replace(
            "https://fonts.googleapis.com/css2?family=DotGothic16&display=swap",
            "data:text/css,"
        ), encoding="utf-8"
    )
    # The LAN-only battle/hide-seek prototypes are not accessible in the kiosk.
    for name in ("index.html", "landing.js", "landing.css", "manifest.webmanifest",
                 "game.js", "game.css"):
        shutil.copy2(root / name, exhibit / name)
    worker = (root / "sw.template.js").read_text(encoding="utf-8")
    (exhibit / "sw.js").write_text(
        worker.replace("__GITAI_BUILD__", build), encoding="utf-8"
    )
    (exhibit / "version.json").write_text(
        json.dumps({"build": build, "schema": 1}, ensure_ascii=False), encoding="utf-8"
    )
    runtime_files = sorted(
        p.relative_to(exhibit).as_posix() for p in exhibit.rglob("*")
        if p.is_file() and p.name not in {"sw.js", "precache.json"}
    )
    (exhibit / "precache.json").write_text(
        json.dumps(runtime_files, ensure_ascii=False), encoding="utf-8"
    )
    for needed in ("index.html", "game.html", "game.js", "manifest.webmanifest",
                   "config/konchu_univ_alpha.json", "js/pages_preview.js",
                   "js/warning_color.js", "img/backgrounds/bg_leaf01.png"):
        assert needed in runtime_files, needed
    print("Exhibition PWA:", len(runtime_files), "offline files; build", build)

if __name__ == "__main__":
    main()
