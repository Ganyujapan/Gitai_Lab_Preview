#!/usr/bin/env python3
"""Descriptive GITAI SCORE v1 diagnostic; read-only, standard library.

Loads original 1103 archived human judgments from the four frozen manifests.
No training, threshold fitting, score recalibration, raw mutation or deletion.
Output: Markdown report + machine-readable summary JSON. Ordinal human categories
are NEVER mapped onto a synthetic 0..100 human score.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "research" / "calibration"
SOURCES = [
    ("baseline", BASE / "calibration_dataset_index_2026-10-14.json", 624),
    ("high_focus", BASE / "high_focus/manifest_2026-10-14.json", 338),
    ("optimized1000", BASE / "optimized1000/manifest_2026-10-14.json", 44),
    ("variable_opt", BASE / "variable_opt/manifest_2026-10-14.json", 97),
]
GRADES = [
    ("complete", "完成域"),
    ("almost_complete", "ほぼ完成"),
    ("excellent_plus", "非常に優秀"),
    ("excellent", "優秀"),
    ("good", "良好"),
    ("conspicuous", "よく目立つ"),
]
GRADE_ORDER = {x[0]: i for i, x in enumerate(GRADES)}
GRADE_LABEL = dict(GRADES)
METRICS = ["total", "color", "value", "texture", "outline"]


def score(row, metric="total", scope="v1_local"):
    candidate = row.get(scope) or {}
    value = candidate.get(metric)
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    return None


def fmt(value, places=2):
    return "—" if value is None else f"{value:.{places}f}"


def load_data():
    rows = []
    ids = set()
    totals = {}
    backgrounds = {}
    for cohort, index_path, expected in SOURCES:
        manifest = json.loads(index_path.read_text(encoding="utf-8"))
        loaded = 0
        for part in manifest["parts"]:
            path = ROOT / part["path"]
            doc = json.loads(path.read_text(encoding="utf-8"))
            part_rows = doc["ratings"]
            if len(part_rows) != part["ratings"]:
                raise ValueError(f"Manifest count mismatch for {path}")
            for original in part_rows:
                entry = dict(original)
                rid = entry["id"]
                if rid in ids:
                    raise ValueError(f"Duplicate rating id: {rid}")
                ids.add(rid)
                entry["_cohort"] = cohort
                entry["_mode"] = (entry.get("sampling") or {}).get("mode") or cohort
                if entry.get("human_category_id") not in GRADE_ORDER:
                    raise ValueError(f"Unknown ordinal category: {rid}")
                rows.append(entry)
            for bg in doc.get("backgrounds", []):
                old = backgrounds.get(bg["id"])
                if old is not None and old != bg:
                    raise ValueError(f"Conflicting background snapshot: {bg['id']}")
                backgrounds[bg["id"]] = bg
            loaded += len(part_rows)
        if loaded != expected:
            raise ValueError(f"Wrong {cohort} row count: {loaded}")
        totals[cohort] = loaded
    expected_envs = {"bark_001": 494, "sand_001": 609}
    if len(rows) != 1103 or Counter(r["environment_id"] for r in rows) != expected_envs:
        raise ValueError("1103 ratings / environment count invariant failed")
    if len(backgrounds) != 4:
        raise ValueError(f"Expected four frozen background snapshots; found {len(backgrounds)}")
    if sum(r["human_category_id"] == "complete" for r in rows) != 80:
        raise ValueError("Expected 80 complete-category judgments")
    return rows, totals, backgrounds


def average(items):
    return statistics.mean(items) if items else None


def median(items):
    return statistics.median(items) if items else None


def auc(rows, positive, negative, scope):
    """Pairwise concordance, ties = 0.5. Higher v1 score is predicted better."""
    positives = [score(r, scope=scope) for r in rows if r["human_category_id"] == positive]
    negatives = [score(r, scope=scope) for r in rows if r["human_category_id"] == negative]
    positives = [v for v in positives if v is not None]
    negatives = [v for v in negatives if v is not None]
    if len(positives) < 2 or len(negatives) < 2:
        return None
    wins = 0
    for p in positives:
        for n in negatives:
            wins += 1 if p > n else (0.5 if p == n else 0)
    return wins / (len(positives) * len(negatives))


def ordinal_cindex(rows, scope):
    """All distinct-human-grade pairs, comparable only within same cohort+env."""
    observed = [(GRADE_ORDER[r["human_category_id"]], score(r, scope=scope)) for r in rows]
    observed = [(label, value) for label, value in observed if value is not None]
    wins = 0
    pairs = 0
    for i, (grade_i, value_i) in enumerate(observed):
        for grade_j, value_j in observed[i + 1:]:
            if grade_i == grade_j:
                continue
            pairs += 1
            signed = (grade_j - grade_i) * (value_i - value_j)
            wins += 1 if signed > 0 else (0.5 if signed == 0 else 0)
    return wins / pairs if pairs else None, pairs


def compact_record(row):
    return {
        "id": row["id"],
        "human_category_id": row["human_category_id"],
        "environment_id": row["environment_id"],
        "sampling_mode": row["_mode"],
        "background_id": row.get("background_id"),
        "position": row.get("position"),
        "v1_local": {key: score(row, key) for key in METRICS},
        "v1_global": {key: score(row, key, "v1_global") for key in METRICS},
    }


def compare_extremes(group_rows, scope="v1_local"):
    """Explanatory score inversion, not a learned cutoff or a general error-rate."""
    complete = [r for r in group_rows if r["human_category_id"] == "complete" and score(r, scope=scope) is not None]
    almost = [r for r in group_rows if r["human_category_id"] == "almost_complete" and score(r, scope=scope) is not None]
    if not complete or not almost:
        return None
    low_complete = min(complete, key=lambda r: score(r, scope=scope))
    high_almost = max(almost, key=lambda r: score(r, scope=scope))
    gap = score(high_almost, scope=scope) - score(low_complete, scope=scope)
    return {
        "gap": gap,
        "score_scope": scope,
        "lower_scored_complete": compact_record(low_complete),
        "higher_scored_almost": compact_record(high_almost),
        "is_inverted": gap > 0,
    }


def analyze(rows, cohort_counts, backgrounds):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["environment_id"], row["_cohort"], row["_mode"])].append(row)
    stats = []
    inversions = []
    for (env, cohort, mode), items in sorted(groups.items()):
        counts = Counter(r["human_category_id"] for r in items)
        local = [score(r) for r in items if score(r) is not None]
        global_scores = [score(r, scope="v1_global") for r in items if score(r, scope="v1_global") is not None]
        c_local, comparable_pairs = ordinal_cindex(items, "v1_local")
        c_global, _ = ordinal_cindex(items, "v1_global")
        stat = {
            "environment": env, "cohort": cohort, "mode": mode,
            "n": len(items), "categories": {key: counts[key] for key, _ in GRADES},
            "local_available": len(local),
            "global_available": len(global_scores),
            "local_mean": average(local), "local_median": median(local),
            "global_mean": average(global_scores),
            "ordinal_c_local": c_local, "ordinal_c_global": c_global,
            "ordinal_pairs": comparable_pairs,
            "complete_vs_almost_auc_local": auc(items, "complete", "almost_complete", "v1_local"),
            "complete_vs_almost_auc_global": auc(items, "complete", "almost_complete", "v1_global"),
            "near_completion_auc_local": auc(items, "almost_complete", "excellent_plus", "v1_local"),
            "near_completion_auc_global": auc(items, "almost_complete", "excellent_plus", "v1_global"),
            "metric_means_by_category": {
                category: {
                    key: average([score(r, key) for r in items if r["human_category_id"] == category and score(r, key) is not None])
                    for key in METRICS
                }
                for category in ("complete", "almost_complete", "excellent_plus", "excellent")
                if counts[category]
            },
        }
        stats.append(stat)
        for scope in ("v1_local", "v1_global"):
            pair = compare_extremes(items, scope)
            if pair:
                inversions.append({"environment": env, "cohort": cohort, "mode": mode, **pair})
    bg_groups = defaultdict(list)
    for row in rows:
        bg_groups[(row["environment_id"], row.get("background_id") or "unavailable")].append(row)
    bg_summary = [
        {"environment": env, "background_id": bid, "n": len(items),
         "categories": dict(Counter(r["human_category_id"] for r in items)),
         "positions": len({(r.get("position") or {}).get("x", None) and str(r.get("position")) for r in items})}
        for (env, bid), items in sorted(bg_groups.items())
    ]
    result = {
        "report_version": 1,
        "data_snapshot_date": "2026-10-14",
        "method": "in-sample descriptive stratification, no v2 fitting",
        "n": len(rows),
        "cohorts": cohort_counts,
        "environment_counts": dict(Counter(r["environment_id"] for r in rows)),
        "overall_categories": dict(Counter(r["human_category_id"] for r in rows)),
        "background_snapshots": len(backgrounds),
        "background_strata": bg_summary,
        "groups": stats,
        "inversion_examples": inversions,
        "missing_local_score": sum(score(r) is None for r in rows),
        "missing_global_score": sum(score(r, scope="v1_global") is None for r in rows),
    }
    return result


def markdown(out):
    lines = [
        "# GITAI SCORE v1 — 人間評価1103件の初回診断",
        "",
        "**スコアリング改良のための記述的分析。v1の採点式・人間ラベル・原本・ゲームデータは変更していない。**",
        "",
        "## 1. データの検収",
        "",
        f"- 人間評価：**{out['n']}件**（ID重複0件）。樹皮{out['environment_counts']['bark_001']}、砂地{out['environment_counts']['sand_001']}。",
        "- 出典別： " + "、".join(f"{k} {v}件" for k,v in out["cohorts"].items()) + "。",
        f"- 人間カテゴリー： " + "、".join(f"{GRADE_LABEL[k]} {out['overall_categories'].get(k,0)}件" for k,_ in GRADES) + "。",
        f"- スナップショット背景：{out['background_snapshots']}件。v1局所スコア欠損{out['missing_local_score']}件、v1全体スコア欠損{out['missing_global_score']}件。",
        "",
        "## 2. 条件別集計",
        "",
        "サンプルの作られ方が異なるため、**背景×収集コホート×選抜モード**ごとに分ける。",
        "各行の並びは、完成域／ほぼ完成／非常に優秀／優秀／良好／よく目立つ。",
        "",
        "|背景|収集方法|件数|人間評価 6区分|v1局所中央値|局所C-index|完成域vsほぼ完成 局所AUC|全体AUC|",
        "|---|---|---:|---|---:|---:|---:|---:|",
    ]
    for s in out["groups"]:
        cats = "/".join(str(s["categories"][k]) for k,_ in GRADES)
        lines.append(f"|{s['environment']}|{s['cohort']} / {s['mode']}|{s['n']}|{cats}|{fmt(s['local_median'])}|{fmt(s['ordinal_c_local'],3)}|{fmt(s['complete_vs_almost_auc_local'],3)}|{fmt(s['complete_vs_almost_auc_global'],3)}|")
    lines += [
        "",
        "C-indexは人間の評価が異なるペアを比較した順位整合率（同点は0.5）。AUCは完成域がほぼ完成より高スコアになる割合（同点は0.5）。",
        "**少数例または片方のカテゴリーしかない比較は「—」とした。すべて既存データ上の値で、独立検証の精度ではない。**",
        "",
        "## 3. 人間評価とv1の逆転例",
        "",
        "「ほぼ完成」の高スコア個体と「完成域」の低スコア個体を同一背景・選抜条件内で比較。差は**前者−後者**。正ならv1の順位と人間カテゴリーが逆転する。",
        "",
        "|背景|条件|指標|差|ほぼ完成 (ID / v1)|完成域 (ID / v1)|",
        "|---|---|---|---:|---|---|",
    ]
    for e in out["inversion_examples"]:
        if not e["is_inverted"]:
            continue
        a=e["higher_scored_almost"];b=e["lower_scored_complete"]
        scope=e["score_scope"];va=a[scope]["total"];vb=b[scope]["total"]
        lines.append(f"|{e['environment']}|{e['mode']}|{scope}|+{e['gap']:.2f}|{a['id']} / {fmt(va)}|{b['id']} / {fmt(vb)}|")
    if not any(x["is_inverted"] for x in out["inversion_examples"]):
        lines.append("|—|今回の二値比較で逆転例なし|—|—|—|—|")
    lines += [
        "",
        "各個体の**色・明るさ・模様・輪郭の内訳、位置、背景ID**は機械可読JSONに保存。差の理由は画像を並べて確認するまでは断定しない。",
        "",
        "## 4. 背景スナップショット別の内訳",
        "",
        "|環境|背景ID（先頭12文字）|件数|記録された位置の種類|",
        "|---|---|---:|---:|",
    ]
    for b in out["background_strata"]:
        lines.append(f"|{b['environment']}|{b['background_id'][:12]}…|{b['n']}|{b['positions']}|")
    lines += [
        "",
        "## 5. 分析から導く検証方針（仮説）",
        "",
        "1. **最優先：輪郭検出と局所背景の比較。** スコア逆転個体を同じ表示サイズ・座標で人間の評価と見比べ、境界や筋の突出を確認する。画像の再現前に原因を決めつけない。",
        "2. **背景・場所の交絡を分離。** 同じGenomeでも背景IDや座標が違えば擬態しやすさは変わる。『位置固定の局所擬態』と『多数地点から上位を選ぶ全体擬態』を区別する。",
        "3. **最適化で選んだ個体の偏りを考慮。** optimized群はv1の点が高くなるよう選抜されている。v2の評価・パラメータ調整を同じ群だけで行うと性能を過大評価する。",
        "4. **v2の候補式は別モジュールとして作る。** v1は凍結、研究用の並走比較に限定。無作為サンプル＋既存の逆転個体を含む新規盲検評価を実施する。",
        "",
        "## 6. 結果の限界",
        "",
        "- 人間評価は**順序尺度（6段階）**。『完成域＝100点』のような数値置換はしていない。",
        "- 同一ユーザー・同一系列・固定座標の評価が含まれ、**独立標本とは限らない**。信頼区間や一般化精度を安易に表示しない。",
        "- この実行では色特徴の追加設計・画像再描画・新しい学習・v2の優劣判定は行っていない。",
        "- 異なる背景／選抜モードをまとめた単一のスコア閾値は設定しない。",
        "",
        "## 再現方法",
        "",
        "GitHubのソースルートから：",
        "",
        "    python3 research/calibration/analysis/analyze_v1.py --output-dir /tmp/gitai_score_audit",
        "",
        "同フォルダに markdown と JSON を出力する。オリジナルの研究ファイルやゲームコードは一切変更しない。",
    ]
    return "\n".join(lines) + "\n"


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="/tmp/gitai_score_audit")
    args=parser.parse_args()
    output_dir=Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    rows, totals, backgrounds = load_data()
    result=analyze(rows, totals, backgrounds)
    report=markdown(result)
    (output_dir/"v1_diagnostic_20261015.md").write_text(report, encoding="utf-8")
    (output_dir/"v1_diagnostic_20261015.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("GITAI_V1_ANALYSIS_OK rows=1103 environment=bark_001:494,sand_001:609")
    print(report)
    print("GITAI_V1_JSON_BEGIN")
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    print("GITAI_V1_JSON_END")


if __name__ == "__main__":
    main()
