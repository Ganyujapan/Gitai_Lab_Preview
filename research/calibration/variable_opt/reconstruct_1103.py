#!/usr/bin/env python3
"""Rebuild 1103 raw human GITAI ratings from four archived cohorts.

No category labels are inferred or edited; outliers remain in the raw data.
Sources: 624 baseline + 338 high-focus + 44 optimized1000 + 97 variable-opt sand.
"""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CAL = ROOT / "research/calibration"
INDEXES = (
    CAL / "calibration_dataset_index_2026-10-14.json",
    CAL / "high_focus/manifest_2026-10-14.json",
    CAL / "optimized1000/manifest_2026-10-14.json",
    CAL / "variable_opt/manifest_2026-10-14.json",
)
OUT = CAL / "gitai_human_ratings_combined_1103_2026-10-14.json"


def main() -> None:
    seen: set[str] = set()
    rows: list[dict] = []
    backgrounds: dict[str, dict] = {}
    counts: list[int] = []
    header: dict | None = None

    for idx in INDEXES:
        meta = json.loads(idx.read_text(encoding="utf-8"))
        subtotal = 0
        for part in meta["parts"]:
            source_path = ROOT / part["path"]
            source = json.loads(source_path.read_text(encoding="utf-8"))
            if len(source["ratings"]) != part["ratings"]:
                raise ValueError(f"Unexpected number of records in {source_path}")
            if header is None:
                header = source
            for row in source["ratings"]:
                rid = row["id"]
                if rid in seen:
                    raise ValueError(f"Duplicate rating ID: {rid}")
                seen.add(rid)
                rows.append(row)
                subtotal += 1
            for bg in source.get("backgrounds", []):
                old = backgrounds.get(bg["id"])
                if old is not None and old != bg:
                    raise ValueError(f"Conflicting background snapshot: {bg['id']}")
                backgrounds[bg["id"]] = bg
        counts.append(subtotal)

    if counts != [624, 338, 44, 97]:
        raise ValueError(f"Unexpected source counts: {counts}")
    if len(rows) != 1103 or len(backgrounds) != 4:
        raise ValueError(f"Unexpected counts: {len(rows)} rows, {len(backgrounds)} backgrounds")
    envs = Counter(r["environment_id"] for r in rows)
    if envs != {"bark_001": 494, "sand_001": 609}:
        raise ValueError(f"Unexpected environment counts: {envs}")
    grade = Counter(r["human_category_id"] for r in rows)
    if grade["complete"] != 80:
        raise ValueError(f"Unexpected count of complete ratings: {grade['complete']}")
    assert header is not None

    combined = {
        "schema_version": 1,
        "purpose": "GITAI SCORE human calibration — 1103 original ratings from four cohorts",
        "score_100_definition": header["score_100_definition"],
        "scoring_model": header["scoring_model"],
        "human_rating_categories": header["human_rating_categories"],
        "rating_format": header["rating_format"],
        "data_source_indexes": [str(x.relative_to(ROOT)) for x in INDEXES],
        "analysis_notes": "Unfiltered human judgments. Compare optimization sampling modes separately. No v2 model has been trained by this script.",
        "ratings": sorted(rows, key=lambda r: (r["created_at"], r["id"])),
        "backgrounds": list(backgrounds.values()),
    }
    OUT.write_text(json.dumps(combined, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(rows)} original ratings and {len(backgrounds)} backgrounds: {OUT}")


if __name__ == "__main__":
    main()
