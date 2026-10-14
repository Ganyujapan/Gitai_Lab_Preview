#!/usr/bin/env python3
"""Combine the frozen baseline 624 ratings with round-1 high-focus 338 ratings.

All source human labels are retained verbatim. No automatic outlier removal.
The 42-genome seed library remains frozen independently from this result set.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "research/calibration/calibration_dataset_index_2026-10-14.json"
HIGH = ROOT / "research/calibration/high_focus/manifest_2026-10-14.json"
OUT = ROOT / "research/calibration/gitai_human_ratings_combined_962_2026-10-14.json"


def main() -> None:
    baseline = json.loads(BASE.read_text(encoding="utf-8"))
    high = json.loads(HIGH.read_text(encoding="utf-8"))
    seen: set[str] = set()
    backgrounds: dict[str, dict] = {}
    rows: list[dict] = []
    head = None
    for part in [*baseline["parts"], *high["parts"]]:
        path = ROOT / part["path"]
        d = json.loads(path.read_text(encoding="utf-8"))
        if len(d["ratings"]) != part["ratings"]:
            raise ValueError(f"Wrong count in {path}")
        if head is None:
            head = d
        for row in d["ratings"]:
            if row["id"] in seen:
                raise ValueError(f"Duplicate rating id: {row['id']}")
            seen.add(row["id"])
            rows.append(row)
        for bg in d.get("backgrounds", []):
            prev = backgrounds.get(bg["id"])
            if prev is not None and prev != bg:
                raise ValueError(f"Conflicting background snapshot: {bg['id']}")
            backgrounds[bg["id"]] = bg
    if len(rows) != 962 or len(backgrounds) != 4:
        raise ValueError(f"Wrong combined sizes: {len(rows)} ratings, {len(backgrounds)} backgrounds")
    envs = Counter(r["environment_id"] for r in rows)
    if envs != {"bark_001": 469, "sand_001": 493}:
        raise ValueError(f"Unexpected background counts: {envs}")
    result = {
        "schema_version": 1,
        "purpose": "GITAI SCORE human calibration - original baseline plus first high focus round",
        "scoring_model": head["scoring_model"],
        "score_100_definition": head["score_100_definition"],
        "human_rating_categories": head["human_rating_categories"],
        "rating_format": head["rating_format"],
        "data_source_indexes": [str(BASE.relative_to(ROOT)), str(HIGH.relative_to(ROOT))],
        "analysis_notes": "Raw human ratings, no exclusions. High-focus candidates are derived from previously high-rated genomes and preselected by v1. Not a random or independent validation sample.",
        "ratings": sorted(rows, key=lambda r: (r["created_at"], r["id"])),
        "backgrounds": list(backgrounds.values()),
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(rows)} ratings, {len(backgrounds)} backgrounds: {OUT}")


if __name__ == "__main__":
    main()
