"""一键自检：依次运行模块与交通决策回归测试，输出汇总表。

用法（在 backend/ 目录下）：
    .venv\\Scripts\\python.exe scripts\\verify_all.py

实现细节：直接在**同一个进程内** import 并调用各脚本的 main()，
不用 subprocess 管道 —— 这样在任何受限环境里都能跑（也更快）。
每个脚本的输出会被捕获，只有失败的套件才回显末尾若干行。
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

SUITES: list[tuple[str, str, str]] = [
    ("smoke_test.py", "模块 1", "POI 数据与接口冒烟"),
    ("test_plan.py", "模块 2", "单日路线规划（5 种交通方式 + 权重）"),
    ("test_module3.py", "模块 3", "多日分天 + 等时圈"),
    ("test_module4.py", "模块 4", "AI 解析 / 一句话重规划 / 解释"),
    ("test_transport_policy.py", "交通决策", "跨江长步行 / 手动方式 / 体力与时间窗"),
    ("test_agent_transport.py", "交通提案", "混合交通比较 / 往返统计 / 预览与执行一致"),
    ("test_taxi_data.py", "打车数据", "车辆出入口 / 接口费用 / 时效与缓存"),
    ("test_llm_probe.py", "模型连接", "思考模型输出额度 / 截断诊断 / 敏感内容不回显"),
]

FAIL_TAIL_LINES = 18


def load_module(filename: str):
    path = HERE / filename
    spec = importlib.util.spec_from_file_location(f"verify_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    print("=" * 84)
    print("路书编译师 TripCompiler —— 全链路自检")
    print("=" * 84)

    results: list[tuple[str, str, str, int, float, str]] = []
    overall_started = time.perf_counter()

    for filename, module_no, title in SUITES:
        buffer = io.StringIO()
        started = time.perf_counter()
        status = 0
        try:
            with contextlib.redirect_stdout(buffer):
                result = load_module(filename).main()
            status = int(result or 0)
        except SystemExit as exc:  # 脚本里用了 raise SystemExit
            status = int(exc.code or 0)
        except Exception as exc:  # noqa: BLE001 - 自检要吞掉异常并报告，而不是自己崩
            status = 1
            buffer.write(f"\n[verify_all] 套件抛出异常：{type(exc).__name__}: {exc}\n")
        elapsed = time.perf_counter() - started
        results.append((module_no, title, filename, status, elapsed, buffer.getvalue()))
        print(f"  {'✅' if status == 0 else '❌'} {module_no}  {title}  ({elapsed:.1f}s)")

    total_elapsed = time.perf_counter() - overall_started
    failed = [item for item in results if item[3] != 0]

    print("-" * 84)
    print(f"  合计 {len(results)} 个套件，通过 {len(results) - len(failed)} 个，"
          f"总耗时 {total_elapsed:.1f}s")

    for module_no, title, filename, _status, _elapsed, output in failed:
        print("-" * 84)
        print(f"  ❌ {module_no} {title}（{filename}）失败输出末尾 {FAIL_TAIL_LINES} 行：")
        tail = output.strip().splitlines()[-FAIL_TAIL_LINES:]
        for line in tail:
            print(f"     {line}")

    print("=" * 84)
    print("[verify_all]", "PASS" if not failed else "FAIL")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
