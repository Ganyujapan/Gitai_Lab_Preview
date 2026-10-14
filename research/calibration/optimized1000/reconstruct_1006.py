#!/usr/bin/env python3
"""Reconstruct 1006 original human ratings from archived GitHub JSON parts.

Baseline 624 + high-focus 338 + independently optimized 1000-trial 44.
Preserves human ratings exactly, performs no outlier filtering or relabeling.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CAL = ROOT / "research/calibration"
INDEXES = (
    CAL / "calibration_dataset_index_2026-10-14.json",
    CAL / "high_focus/manifest_2026-10-14.json",
    CAL / "optimized1000/manifest_2026-10-14.json",
)
OUTPUT = CAL / "gitai_human_ratings_combined_1006_2026-10-14.json"


def main() -> None:
    seen: set[str] = set()
    ratings: list[dict] = []
    backgrounds: dict[str, dict] = {}
    original_header: dict | None = None
    counts = []

    for index_path in INDEXES:
        manifest = json.loads(index_path.read_text(encoding="utf-8"))
        subtotal = 0
        for part in manifest["parts"]:
            path = ROOT / part["path"]
            data = json.loads(path.read_text(encoding="utf-8"))
            if len(data["ratings"]) != part["ratings"]:
                raise ValueError(f"Incorrect count in {path}")
            if original_header is None:
                original_header = data
            for row in data["ratings"]:
                if row["id"] in seen:
                    raise ValueError(f"Duplicate rating: {row['id']}")
                seen.add(row["id"])
                ratings.append(row)
                subtotal += 1
            for bg in data.get("backgrounds", []):
                old = backgrounds.get(bg["id"])
                if old is not None and old != bg:
                    raise ValueError(f"Background snapshot mismatch: {bg['id']}")
                backgrounds[bg["id"]] = bg
        counts.append(subtotal)

    env = Counter(x["environment_id"] for x in ratings)
    grade = Counter(x["human_category_id"] for x in ratings)
    if counts != [624, 338, 44]:
        raise ValueError(f"Wrong source counts: {counts}")
    if len(ratings) != 1006 or len(backgrounds) != 4:
        raise ValueError(f"Wrong combined counts: {len(ratings)}, {len(backgrounds)} backgrounds")
    if env != {"bark_001": 494, "sand_001": 512}:
        raise ValueError(f"Unexpected environment counts: {env}")
    if grade["complete"] != 27:
        raise ValueError(f"Unexpected 完成域 count: {grade['complete']}")

    assert original_header is not None
    result = {
        "schema_version": 1,
        "purpose": "GITAI SCORE human calibration: frozen original labels, three sampling modes",
        "score_100_definition": original_header["score_100_definition"],
        "scoring_model": original_header["scoring_model"],
        "human_rating_categories": original_header["human_rating_categories"],
        "rating_format": original_header["rating_format"],
        "data_source_indexes": [str(p.relative_to(ROOT)) for p in INDEXES],
        "analysis_notes": "No rating exclusions. Optimized1000 is a machine-score-selected sample, not a random sample.",
        "ratings": sorted(ratings, key=lambda r: (r["created_at"], r["id"])),
        "backgrounds": list(backgrounds.values()),
    }
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(ratings)} unique ratings and {len(backgrounds)} backgrounds: {OUTPUT}")


if __name__ == "__main__":
    main()
