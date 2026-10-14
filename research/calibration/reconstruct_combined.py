#!/usr/bin/env python3
"""Reconstruct the unmodified 624-rating JSON from valid GitHub JSON shards."""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
INDEX = HERE / "calibration_dataset_index_2026-10-14.json"
OUT = HERE / "gitai_human_ratings_combined_624_2026-10-14.json"


def main() -> None:
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    rows = []
    backgrounds = {}
    seen = set()
    header = None
    for part in index["parts"]:
        source_path = ROOT / part["path"]
        source = json.loads(source_path.read_text(encoding="utf-8"))
        if header is None:
            header = source
        if len(source["ratings"]) != part["ratings"]:
            raise ValueError(f"Rating count differs from manifest: {source_path}")
        for record in source["ratings"]:
            if record["id"] in seen:
                raise ValueError(f"Duplicate rating ID: {record['id']}")
            seen.add(record["id"])
            rows.append(record)
        for background in source["backgrounds"]:
            existing = backgrounds.get(background["id"])
            if existing is not None and existing != background:
                raise ValueError(f"Conflicting background ID: {background['id']}")
            backgrounds[background["id"]] = background
    if len(rows) != index["total_ratings"]:
        raise ValueError("Wrong total rating count")
    if sum(r["environment_id"] == "bark_001" for r in rows) != 307:
        raise ValueError("Wrong bark rating count")
    if sum(r["environment_id"] == "sand_001" for r in rows) != 317:
        raise ValueError("Wrong sand rating count")
    dataset = {
        "schema_version": 1,
        "purpose": "Gitai Lab human camouflage score calibration - combined raw data",
        "score_100_definition": header["score_100_definition"],
        "scoring_model": header["scoring_model"],
        "human_rating_categories": header["human_rating_categories"],
        "rating_format": header["rating_format"],
        "dataset_provenance": index["source_exports"],
        "ratings": sorted(rows, key=lambda r: (r.get("created_at", ""), r["id"])),
        "backgrounds": list(backgrounds.values()),
        "analysis_notes": "Unmodified source records. Flag questionable ratings separately.",
    }
    OUT.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(rows)} human ratings and {len(backgrounds)} backgrounds to {OUT}")


if __name__ == "__main__":
    main()
