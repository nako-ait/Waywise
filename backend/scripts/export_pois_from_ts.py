"""把前端的 shanghaiPois.ts 导出为后端 data/shanghai_pois.json。

单一数据源：前端 TS 文件是权威版本，后端 JSON 由本脚本生成，
避免两边手改导致 POI 数据不一致。

用法（在 backend/ 目录下）：
    python scripts/export_pois_from_ts.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
ROOT = BASE_DIR.parent                                      # 项目根
TS_FILE = ROOT / "frontend" / "src" / "data" / "shanghaiPois.ts"
OUT_FILE = BASE_DIR / "data" / "shanghai_pois.json"

# 匹配形如：
# { name: '外滩', lng: 121.4903, lat: 31.2397, openTime: '00:00', closeTime: '23:59', stayMin: 60, tags: ['地标', '夜景'], district: '黄浦区' },
LINE_RE = re.compile(
    r"\{\s*name:\s*'(?P<name>[^']*)'\s*,"
    r"\s*lng:\s*(?P<lng>-?\d+(?:\.\d+)?)\s*,"
    r"\s*lat:\s*(?P<lat>-?\d+(?:\.\d+)?)\s*,"
    r"\s*openTime:\s*'(?P<open>[^']*)'\s*,"
    r"\s*closeTime:\s*'(?P<close>[^']*)'\s*,"
    r"\s*stayMin:\s*(?P<stay>\d+)\s*,"
    r"\s*tags:\s*\[(?P<tags>[^\]]*)\]\s*,"
    r"\s*district:\s*'(?P<district>[^']*)'\s*\}",
)


def main() -> int:
    if not TS_FILE.exists():
        print(f"[x] 找不到 {TS_FILE}", file=sys.stderr)
        return 1

    text = TS_FILE.read_text(encoding="utf-8")
    pois: list[dict] = []
    for m in LINE_RE.finditer(text):
        tags = re.findall(r"'([^']*)'", m.group("tags"))
        pois.append(
            {
                "name": m.group("name"),
                "lng": float(m.group("lng")),
                "lat": float(m.group("lat")),
                "openTime": m.group("open"),
                "closeTime": m.group("close"),
                "stayMin": int(m.group("stay")),
                "tags": tags,
                "district": m.group("district"),
            }
        )

    if not pois:
        print("[x] 没有解析到任何 POI，检查 TS 文件格式", file=sys.stderr)
        return 1

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        json.dumps(pois, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[ok] 写入 {OUT_FILE}（{len(pois)} 个 POI）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
