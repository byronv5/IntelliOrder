"""EXE 打包入口 — 处理路径分离后启动服务"""
import os
import sys
import threading
import time
import webbrowser


def resolve_dirs() -> tuple[str, str]:
    """返回 (project_root, bundle_dir)。
    project_root — EXE 所在目录，存放外部文件：datasource/, data/
    bundle_dir   — 内嵌静态资源目录（frozen 时为 _MEIPASS，开发时为项目根）
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable), sys._MEIPASS  # type: ignore[attr-defined]
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(backend_dir)
    return project_root, project_root


def open_browser_delayed(url: str, delay: float = 2.0) -> None:
    def _task() -> None:
        time.sleep(delay)
        webbrowser.open(url)

    threading.Thread(target=_task, daemon=True).start()


def main() -> None:
    project_root, bundle_dir = resolve_dirs()
    os.environ["APP_EXE_DIR"] = project_root
    os.environ["APP_BUNDLE_DIR"] = bundle_dir

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    import generate_manifest

    try:
        generate_manifest.main()
    except Exception as exc:
        print(f"[警告] 数据同步失败: {exc}", flush=True)

    port = int(os.environ.get("PORT", "8765"))
    open_browser_delayed(f"http://127.0.0.1:{port}/")

    import server

    server.main()


if __name__ == "__main__":
    main()
