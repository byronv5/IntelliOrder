"""同步 datasource 目录，生成 manifest.json 与 JSON 数据缓存"""
import glob
import json
import os
import sys
from datetime import date, datetime

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

if getattr(sys, "frozen", False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    PROJECT_ROOT = os.environ.get("APP_EXE_DIR") or os.path.dirname(BACKEND_DIR)

LOCAL_DS = os.path.join(PROJECT_ROOT, "datasource")
CACHE_DS = os.path.join(LOCAL_DS, "cache")


def cell_value(value):
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S") if value.time().isoformat() != "00:00:00" else value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()
    return value


def find_header_row(all_rows, markers):
    need = set(markers)
    for idx, row in enumerate(all_rows):
        headers = {str(cell).strip() for cell in row if cell is not None and str(cell).strip()}
        if need.issubset(headers):
            return idx
    return 0


def export_xlsx_to_json(xlsx_path, json_path):
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    preview = list(ws.iter_rows(values_only=True))
    wb.close()
    if not preview:
        return 0

    header_idx = find_header_row(
        preview[:30],
        ("区域", "款号", "颜色"),
    )
    if header_idx == 0 and not any(
        str(cell).strip() in ("区域", "款号", "货号", "颜色")
        for cell in preview[0]
        if cell is not None
    ):
        header_idx = find_header_row(preview[:30], ("区域", "货号", "颜色"))

    header_row = preview[header_idx]
    headers = [str(h).strip() if h is not None else "" for h in header_row]
    rows = []
    for row in preview[header_idx + 1 :]:
        if not any(cell is not None and str(cell).strip() for cell in row):
            continue
        item = {
            headers[i]: cell_value(row[i])
            for i in range(min(len(headers), len(row)))
            if i < len(headers) and headers[i]
        }
        if item:
            rows.append(item)

    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    tmp_path = json_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    os.replace(tmp_path, json_path)
    return len(rows)


def main():
    os.makedirs(LOCAL_DS, exist_ok=True)
    os.makedirs(CACHE_DS, exist_ok=True)
    pic_dir = os.path.join(LOCAL_DS, "PIC")
    os.makedirs(pic_dir, exist_ok=True)

    files = sorted(
        os.path.basename(f)
        for f in glob.glob(os.path.join(LOCAL_DS, "*.xlsx"))
        if not os.path.basename(f).startswith("~$")
    )

    manifest_path = os.path.join(LOCAL_DS, "manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(files, f, ensure_ascii=False, indent=2)
    print(f"manifest: {len(files)} 个文件 -> {manifest_path}")

    try:
        import openpyxl  # noqa: F401
    except ImportError:
        print("[警告] 未安装 openpyxl，无法生成 JSON 缓存。请运行: pip install openpyxl")
        return

    for name in files:
        xlsx_path = os.path.join(LOCAL_DS, name)
        json_name = os.path.splitext(name)[0] + ".json"
        json_path = os.path.join(CACHE_DS, json_name)
        count = export_xlsx_to_json(xlsx_path, json_path)
        note = "" if count else " [警告: 无有效行，前端将尝试从尺码明细回退]"
        msg = f"缓存: {name} -> cache/{json_name} ({count} 行){note}"
        print(msg)

    pic_count = sum(
        1
        for name in os.listdir(pic_dir)
        if os.path.splitext(name)[1].lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
    )
    print(f"图片: PIC/ ({pic_count} 张，按文件名款号匹配)")


if __name__ == "__main__":
    main()
