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

    # Mode-select banners come from the authored modeselect_tmb ZIP. They
    # must be bundled in the exhibit scope; its service worker precaches them.
    thumbnails = (
        "gitailab_thumbnail_hide_960x300.webp",
        "gitailab_thumbnail_warning_960x300.webp",
    )
    for thumbnail in thumbnails:
        path = site / "img" / "modeselect" / thumbnail
        assert path.is_file(), "Missing exhibit mode thumbnail: " + str(path)
        # Real WebP (RIFF + WEBP), not a missing image or text placeholder.
        with path.open("rb") as fp:
            head = fp.read(12)
        assert head[:4] == b"RIFF" and head[8:12] == b"WEBP", thumbnail

    # All runtime files are physically inside the exhibit scope. The service
    # worker must not control/cache normal public-preview paths.
    for folder in ("audio", "config", "css", "data", "environments", "img", "js", "species"):
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
    db_declaration = "  const DB_NAME = SLOT_ID ? BASE_DB_NAME + '-slot-' + SLOT_ID : BASE_DB_NAME;"
    version_declaration = "  const DB_VERSION = 2;"
    assert engine_js.count(db_declaration) == 1
    assert engine_js.count(version_declaration) == 1
    engine_js = engine_js.replace(
        db_declaration,
        "  const DB_NAME = 'gitai-exhibit-2026-' + "
        "(SLOT_ID ? BASE_DB_NAME + '-slot-' + SLOT_ID : BASE_DB_NAME);", 1
    )
    # The exhibition is deliberately slower than the normal public game.
    # This is an event-only generated engine patch, not a change to the
    # source evolution model or its mutation magnitudes.
    child_marker = "  function makeChildGenome(\n"
    assert engine_js.count(child_marker) == 1
    helper = """  // Exhibition only: reduce mutation OCCURRENCE, not magnitude.
  // Applies to live gameplay, not the warning experiment's neutral headstart.
  const EXHIBIT_MUTATION_RATE_FACTOR = 0.5;
  function exhibitionMutationGenetics(source) {
    const slowed = { ...source };
    for (const [key, value] of Object.entries(source)) {
      if ((key.endsWith('_p') || key === 'pattern_birth_p_per_child')
          && typeof value === 'number' && value >= 0 && value <= 1) {
        slowed[key] = value * EXHIBIT_MUTATION_RATE_FACTOR;
      }
    }
    return slowed;
  }

"""
    engine_js = engine_js.replace(child_marker, helper + child_marker, 1)

    # An optional explicit genotype config lets the 20 neutral generations
    # retain the unchanged baseline rates (and original seeded RNG stream).
    child_before = """    rng = Math.random,
  ) {
    const genetics = evolutionConfig.trait_genetics || {};
    const colorParentIsA = rng() < 0.5;"""
    child_after = """    rng = Math.random,
    geneticsOverride = null,
  ) {
    const genetics = geneticsOverride
      || exhibitionMutationGenetics(evolutionConfig.trait_genetics || {});
    const colorParentIsA = rng() < 0.5;"""
    assert engine_js.count(child_before) == 1
    engine_js = engine_js.replace(child_before, child_after, 1)

    neutral_before = """          item.parentB,
          rng,
        );
        const genome = result.genome;"""
    neutral_after = """          item.parentB,
          rng,
          genetics,
        );
        const genome = result.genome;"""
    assert engine_js.count(neutral_before) == 1
    engine_js = engine_js.replace(neutral_before, neutral_after, 1)

    live_before = """    const genetics = evolutionConfig.trait_genetics || {};
    const specialMutationGenerationP = clamp01("""
    live_after = """    const genetics = exhibitionMutationGenetics(
      evolutionConfig.trait_genetics || {}
    );
    const specialMutationGenerationP = clamp01("""
    assert engine_js.count(live_before) == 1
    engine_js = engine_js.replace(live_before, live_after, 1)

    # Surface the effective probability factor in the saved generation log.
    generation_marker = "  async function evolveGenerationByGenome("
    assert engine_js.count(generation_marker) == 1
    before_live, live = engine_js.split(generation_marker, 1)
    diagnostic_before = """      evolution_config_id: evolutionConfig?.config_id || null,
      eaten_indices:"""
    diagnostic_after = """      evolution_config_id: evolutionConfig?.config_id || null,
      exhibit_mutation_rate_factor: EXHIBIT_MUTATION_RATE_FACTOR,
      eaten_indices:"""
    assert live.count(diagnostic_before) == 1
    engine_js = before_live + generation_marker + live.replace(
        diagnostic_before, diagnostic_after, 1
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
    # The exhibition bundles only the currently supported public simulator.
    for name in ("index.html", "modes.html", "title.css", "landing.js", "landing.css", "theater_canvas_20261026.js", "theater_canvas_20261026.css",
                 "manifest.webmanifest", "game.js", "game.css", "admin.js", "admin.css",
                 "backup_readiness.js",
                 # Optional diagnostics: NEVER loaded by index/modes/game/admin.
                 "backup_rehearsal.html", "backup_schema_rehearsal.js",
                 "pf06_perf_rehearsal.html", "pf06_perf_rehearsal.js",
                 "backup_checkpoint_v2.js", "backup_v2.js",
                 "backup_restore_preflight_v2.js", "backup_restore_atomic_v2.js",
                 "backup_atomic_rehearsal.js",
                 "backup_warning_life_recovery_v2.js", "backup_warning_life_rehearsal.js",
                 "backup_rehearsal_report.js", "backup_file_handoff_rehearsal.js"):
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
                   "js/warning_color.js", "img/backgrounds/bg_leaf01.png",
                   "audio/gitailab_rainforest_overlap_test_48k.ogg"):
        assert needed in runtime_files, needed
    for thumbnail in thumbnails:
        artifact = "img/modeselect/" + thumbnail
        assert artifact in runtime_files, artifact
    modes_source = (exhibit / "modes.html").read_text(encoding="utf-8")
    for thumbnail in thumbnails:
        assert modes_source.count("img/modeselect/" + thumbnail) == 1, thumbnail
    # Keep BOTH codecs of all ten recorded effects in the offline scope.
    for kind, count in (("capture", 4), ("poison", 4), ("death", 2)):
        for i in range(1, count + 1):
            for fmt, ext in (("opus", "ogg"), ("aac", "m4a")):
                clip = f"audio/sfx/{fmt}/{kind}_{i:02d}.{ext}"
                assert clip in runtime_files, clip
    assert "backup_readiness.js" in runtime_files
    assert 'src="backup_readiness.js"' in (exhibit / "modes.html").read_text(encoding="utf-8")
    assert "backup_readiness.js" not in (exhibit / "game.html").read_text(encoding="utf-8")
    # Capacity inspector never imports v3 rehearsal code into production.
    assert "js/game_sfx.js" in runtime_files
    assert "theater_canvas_20261026.js" in runtime_files and "theater_canvas_20261026.css" in runtime_files
    assert "exhibitTheaterDialog" in (exhibit / "modes.html").read_text(encoding="utf-8")
    assert 'id="portalArt"' in (exhibit / "index.html").read_text(encoding="utf-8")
    # Real-browser rehearsal stays isolated; production entry points don't
    # import or execute diagnostic database upgrade code.
    for needed in ("pf06_perf_rehearsal.html", "pf06_perf_rehearsal.js",
                   "backup_rehearsal.html", "backup_schema_rehearsal.js",
                   "backup_checkpoint_v2.js", "backup_v2.js",
                   "backup_restore_preflight_v2.js", "backup_restore_atomic_v2.js",
                   "backup_atomic_rehearsal.js",
                   "backup_warning_life_recovery_v2.js", "backup_warning_life_rehearsal.js",
                   "backup_rehearsal_report.js", "backup_file_handoff_rehearsal.js"):
        assert needed in runtime_files
    for entry in ("game.html", "modes.html", "index.html"):
        page_source = (exhibit / entry).read_text(encoding="utf-8")
        assert "pf06_perf_rehearsal.js" not in page_source
        assert "pf06_perf_rehearsal.html" not in page_source
        assert "backup_schema_rehearsal.js" not in page_source
        assert "backup_checkpoint_v2.js" not in page_source
        assert "backup_atomic_rehearsal.js" not in page_source
        assert "backup_restore_atomic_v2.js" not in page_source
        assert "backup_warning_life_recovery_v2.js" not in page_source
        assert "backup_warning_life_rehearsal.js" not in page_source
        assert "backup_rehearsal_report.js" not in page_source
        assert "backup_file_handoff_rehearsal.js" not in page_source
    assert "pf06_perf_rehearsal.js" not in (exhibit / "admin.js").read_text(encoding="utf-8")
    assert '<script src="pf06_perf_rehearsal.js"></script>' in (exhibit / "pf06_perf_rehearsal.html").read_text(encoding="utf-8")
    assert "backup_schema_rehearsal.js" not in (exhibit / "admin.js").read_text(encoding="utf-8")
    assert "backup_restore_atomic_v2.js" not in (exhibit / "admin.js").read_text(encoding="utf-8")
    assert "backup_warning_life_recovery_v2.js" not in (exhibit / "admin.js").read_text(encoding="utf-8")
    assert "backup_rehearsal_report.js" not in (exhibit / "admin.js").read_text(encoding="utf-8")
    assert "backup_file_handoff_rehearsal.js" not in (exhibit / "admin.js").read_text(encoding="utf-8")
    assert '<script src="backup_file_handoff_rehearsal.js"></script>' in (exhibit / "backup_rehearsal.html").read_text(encoding="utf-8")
    assert (exhibit / "title.css").is_file()
    print("Exhibition PWA:", len(runtime_files), "offline files; build", build)

if __name__ == "__main__":
    main()
