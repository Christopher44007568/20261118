from __future__ import annotations

from pathlib import Path

from .islands import generate_islands
from .packer import find_packing
from .report import build_mapping, metrics_row, write_json, write_metrics_csv
from .validate import validate_mapping, write_validation_report
from .visualize import write_svg


MARGINS = (0.0025, 0.005, 0.01)
OUTPUT_DIR = Path("artifacts/output")


def main() -> None:
    islands = generate_islands()
    rows: list[dict[str, object]] = []

    for margin in MARGINS:
        result = find_packing(islands, margin=margin, atlas_size=1.0)
        mapping = build_mapping(result)
        tag = f"m{str(margin).replace('.', 'p')}"

        mapping_path = OUTPUT_DIR / f"mapping_{tag}.json"
        write_json(mapping, mapping_path)
        write_svg(result, OUTPUT_DIR / f"atlas_{tag}.svg")

        validation = validate_mapping(mapping)
        write_validation_report(validation, OUTPUT_DIR / f"validation_{tag}.json")
        row = metrics_row(mapping)
        row["passed"] = all(
            [
                validation["boundaryPassed"],
                validation["gapPassed"],
                validation["orientationPassed"],
                validation["sampleOutsideFailures"] == 0,
                validation["maxInverseError"] < 1e-12,
            ]
        )
        rows.append(row)

    write_metrics_csv(rows, OUTPUT_DIR / "comparison.csv")
    write_markdown_summary(rows, OUTPUT_DIR / "summary.md")


def write_markdown_summary(rows: list[dict[str, object]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# UV 图集打包对比",
        "",
        "| 边距 | 像素边距 | 全局缩放 | 多边形利用率 | 最小岛间距 | 最小边界留白 | 通过 |",
        "|---:|---:|---:|---:|---:|---:|:---:|",
    ]
    for row in rows:
        lines.append(
            "| {margin} | {marginPixels} | {globalScale} | {polygonUtilization} | "
            "{minimumIslandGap} | {minimumBoundaryClearance} | {passed} |".format(**row)
        )
    lines.extend(
        [
            "",
            "多边形利用率按实际凸多边形面积 / 归一化图集面积计算；",
            "JSON 中同时提供每类岛的紧外接框利用率。",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
