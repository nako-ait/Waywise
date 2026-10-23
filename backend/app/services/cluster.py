"""纯 Python 地理聚类：KMeans（等距投影 + k-means++）与「按天均衡」。

为什么不引 numpy / scikit-learn：
  1) 少两个重依赖，装环境更快，评审在别的机器上复现更省事；
  2) 城市尺度（几十个点、几十公里）用等距圆柱投影 + 欧氏距离，
     与球面距离的误差在 0.1% 量级，对「按地理位置分天」完全够用；
  3) 答辩时能直接用代码讲清楚 KMeans 的每一步。
"""
from __future__ import annotations

import math
import random

from .amap_client import LatLng, haversine_km

# 每个点用 (x, y) 表示：x = 经度 × cos(中心纬度)，y = 纬度 —— 等距圆柱投影
Point2D = tuple[float, float]


def project(points: list[LatLng]) -> list[Point2D]:
    """经纬度 -> 平面坐标（公里量级），让欧氏距离近似等于球面距离。"""
    if not points:
        return []
    lat0 = sum(p[1] for p in points) / len(points)
    kx = 111.32 * math.cos(math.radians(lat0))  # 每度经度的公里数
    ky = 110.57  # 每度纬度的公里数（上海纬度附近）
    return [(p[0] * kx, p[1] * ky) for p in points]


def _dist2(a: Point2D, b: Point2D) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def kmeans(points: list[LatLng], k: int, *, seed: int = 42, max_iters: int = 120) -> list[int]:
    """KMeans 地理聚类，返回每个点的簇标签（已压紧为 0..k'-1）。

    k-means++ 初始化 + Lloyd 迭代；点数小于簇数时直接一点一天。
    """
    n = len(points)
    if n == 0:
        return []
    if k <= 1:
        return [0] * n
    if k >= n:
        return list(range(n))

    xy = project(points)
    rng = random.Random(seed)

    # ---- k-means++ 初始化：让初始中心尽量互相远离 ----
    centers: list[Point2D] = [xy[rng.randrange(n)]]
    while len(centers) < k:
        d2 = [min(_dist2(p, c) for c in centers) for p in xy]
        total = sum(d2)
        if total <= 1e-12:  # 所有点几乎重合，随便补一个
            centers.append(xy[rng.randrange(n)])
            continue
        threshold = rng.random() * total
        acc = 0.0
        picked = xy[-1]
        for i, value in enumerate(d2):
            acc += value
            if acc >= threshold:
                picked = xy[i]
                break
        centers.append(picked)

    labels = [0] * n
    for _ in range(max_iters):
        changed = False
        for i, p in enumerate(xy):
            best = 0
            best_d = _dist2(p, centers[0])
            for c in range(1, len(centers)):
                d = _dist2(p, centers[c])
                if d < best_d:
                    best, best_d = c, d
            if labels[i] != best:
                labels[i] = best
                changed = True

        sums = [[0.0, 0.0, 0] for _ in centers]
        for i, p in enumerate(xy):
            slot = sums[labels[i]]
            slot[0] += p[0]
            slot[1] += p[1]
            slot[2] += 1
        for c, slot in enumerate(sums):
            if slot[2]:
                centers[c] = (slot[0] / slot[2], slot[1] / slot[2])
        if not changed:
            break

    return compact_labels(labels)


def compact_labels(labels: list[int]) -> list[int]:
    """把标签压紧成 0..m-1（KMeans 可能产生空簇）。"""
    mapping: dict[int, int] = {}
    out: list[int] = []
    for label in labels:
        if label not in mapping:
            mapping[label] = len(mapping)
        out.append(mapping[label])
    return out


def centroid(points: list[LatLng], indexes: list[int]) -> LatLng:
    """一组点的地理中心。"""
    if not indexes:
        return (0.0, 0.0)
    lng = sum(points[i][0] for i in indexes) / len(indexes)
    lat = sum(points[i][1] for i in indexes) / len(indexes)
    return (lng, lat)


def group_spread_km(points: list[LatLng], indexes: list[int]) -> float:
    """一组点的最大两两距离（公里）—— 用来判断「这天是不是跑太散」。"""
    if len(indexes) < 2:
        return 0.0
    worst = 0.0
    for i, a in enumerate(indexes):
        for b in indexes[i + 1 :]:
            worst = max(worst, haversine_km(points[a], points[b]))
    return round(worst, 2)
