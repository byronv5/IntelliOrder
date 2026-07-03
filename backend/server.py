"""本地静态服务 + SQLite 订货持久化"""
import json
import os
import posixpath
import sqlite3
import sys
import urllib.parse
import uuid
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))


def resolve_project_root() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.environ.get("APP_EXE_DIR") or os.path.dirname(BACKEND_DIR)


def resolve_bundle_dir() -> str:
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.environ.get("APP_BUNDLE_DIR") or resolve_project_root()


PROJECT_ROOT = resolve_project_root()
BUNDLE_DIR = resolve_bundle_dir()
FRONTEND_DIR = os.path.join(BUNDLE_DIR, "frontend")
DB_PATH = os.path.join(PROJECT_ROOT, "data", "orders.db")
PIC_DIR = os.path.join(PROJECT_ROOT, "datasource", "PIC")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}


def build_product_image_index() -> dict[str, str]:
    if not os.path.isdir(PIC_DIR):
        return {}
    index: dict[str, str] = {}
    for name in os.listdir(PIC_DIR):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in IMAGE_EXTENSIONS:
            continue
        key = stem.strip()
        if not key:
            continue
        index[key] = f"datasource/PIC/{name}"
    return index


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                region TEXT NOT NULL,
                style_no TEXT NOT NULL,
                color TEXT NOT NULL,
                product_no TEXT NOT NULL DEFAULT '',
                sub_category TEXT NOT NULL DEFAULT '',
                gender TEXT NOT NULL DEFAULT '',
                standard_price REAL NOT NULL DEFAULT 0,
                color_series TEXT NOT NULL DEFAULT '',
                fabric TEXT NOT NULL DEFAULT '',
                fit TEXT NOT NULL DEFAULT '',
                quantity INTEGER NOT NULL,
                sizes_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(region, style_no, color)
            )
            """
        )
        cols = {row[1] for row in conn.execute("PRAGMA table_info(orders)")}
        if "fabric" not in cols:
            conn.execute("ALTER TABLE orders ADD COLUMN fabric TEXT NOT NULL DEFAULT ''")
        conn.commit()


def row_to_order(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "region": row["region"],
        "styleNo": row["style_no"],
        "color": row["color"],
        "productNo": row["product_no"],
        "subCategory": row["sub_category"],
        "gender": row["gender"],
        "standardPrice": row["standard_price"],
        "colorSeries": row["color_series"],
        "fabric": row["fabric"],
        "fit": row["fit"],
        "quantity": row["quantity"],
        "sizes": json.loads(row["sizes_json"]),
        "status": row["status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def payload_to_fields(data: dict) -> dict:
    return {
        "region": str(data.get("region") or ""),
        "style_no": str(data.get("styleNo") or ""),
        "color": str(data.get("color") or ""),
        "product_no": str(data.get("productNo") or ""),
        "sub_category": str(data.get("subCategory") or ""),
        "gender": str(data.get("gender") or ""),
        "standard_price": float(data.get("standardPrice") or 0),
        "color_series": str(data.get("colorSeries") or ""),
        "fabric": str(data.get("fabric") or ""),
        "fit": str(data.get("fit") or ""),
        "quantity": int(data.get("quantity") or 0),
        "sizes_json": json.dumps(data.get("sizes") or {}, ensure_ascii=False),
        "status": str(data.get("status") or "draft"),
    }


def list_orders() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM orders ORDER BY updated_at DESC"
        ).fetchall()
    return [row_to_order(r) for r in rows]


def find_by_key(region: str, style_no: str, color: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM orders WHERE region = ? AND style_no = ? AND color = ?",
            (region, style_no, color),
        ).fetchone()


def upsert_order(data: dict) -> dict:
    fields = payload_to_fields(data)
    if not fields["region"]:
        raise ValueError("请选择区域")
    if not fields["style_no"]:
        raise ValueError("请选择款号")
    if not fields["color"]:
        raise ValueError("请选择颜色")
    if fields["quantity"] <= 0:
        raise ValueError("订货数量必须大于 0")

    existing = find_by_key(fields["region"], fields["style_no"], fields["color"])
    now = utc_now()
    order_id = data.get("id") or (existing["id"] if existing else f"ord-{uuid.uuid4().hex[:12]}")
    created_at = existing["created_at"] if existing else now
    status = existing["status"] if existing and not data.get("status") else fields["status"]

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO orders (
                id, region, style_no, color, product_no, sub_category, gender,
                standard_price, color_series, fabric, fit, quantity, sizes_json, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(region, style_no, color) DO UPDATE SET
                product_no = excluded.product_no,
                sub_category = excluded.sub_category,
                gender = excluded.gender,
                standard_price = excluded.standard_price,
                color_series = excluded.color_series,
                fabric = excluded.fabric,
                fit = excluded.fit,
                quantity = excluded.quantity,
                sizes_json = excluded.sizes_json,
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (
                order_id,
                fields["region"],
                fields["style_no"],
                fields["color"],
                fields["product_no"],
                fields["sub_category"],
                fields["gender"],
                fields["standard_price"],
                fields["color_series"],
                fields["fabric"],
                fields["fit"],
                fields["quantity"],
                fields["sizes_json"],
                status,
                created_at,
                now,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    return row_to_order(row)


def delete_order(order_id: str) -> None:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        conn.commit()
        if cur.rowcount == 0:
            raise ValueError("订货单不存在")


def clear_all_orders() -> int:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM orders")
        conn.commit()
        return cur.rowcount


def migrate_orders(items: list[dict]) -> int:
    count = 0
    for item in items:
        upsert_order(item)
        count += 1
    return count


def resolve_static_path(path: str) -> str:
    """路由：datasource/ → 项目根；/dashboard/ → 大屏；其余 → 订货前端。"""
    path = path.split("?", 1)[0].split("#", 1)[0]
    path = urllib.parse.unquote(path)
    path = posixpath.normpath(path)
    parts = [p for p in path.split("/") if p and p not in (".", "..")]

    if parts and parts[0] == "datasource":
        return os.path.join(PROJECT_ROOT, *parts)

    app = "dashboard" if parts and parts[0] == "dashboard" else "order"
    sub_parts = parts[1:] if app == "dashboard" else parts
    if not sub_parts:
        return os.path.join(FRONTEND_DIR, app, "index.html")

    target = os.path.join(FRONTEND_DIR, app, *sub_parts)
    if os.path.isdir(target):
        return os.path.join(target, "index.html")
    return target


class OrderHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def translate_path(self, path: str) -> str:
        return resolve_static_path(path)

    def log_message(self, fmt, *args):
        if str(args[0]).startswith("GET /api/") or " /api/" in str(args):
            super().log_message(fmt, *args)

    def _read_json(self) -> dict | list:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _send_json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str) -> None:
        self._send_json(status, {"message": message})

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/orders":
            self._send_json(200, list_orders())
            return
        if path == "/api/product-images":
            self._send_json(200, build_product_image_index())
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if urlparse(self.path).path != "/api/orders":
            self._send_error_json(404, "接口不存在")
            return
        try:
            order = upsert_order(self._read_json())
            self._send_json(200, order)
        except (ValueError, json.JSONDecodeError) as err:
            self._send_error_json(400, str(err))
        except Exception as err:
            self._send_error_json(500, f"保存失败: {err}")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/orders/migrate":
            self._send_error_json(404, "接口不存在")
            return
        try:
            payload = self._read_json()
            if not isinstance(payload, list):
                raise ValueError("迁移数据格式错误")
            count = migrate_orders(payload)
            self._send_json(200, {"migrated": count})
        except (ValueError, json.JSONDecodeError) as err:
            self._send_error_json(400, str(err))
        except Exception as err:
            self._send_error_json(500, f"迁移失败: {err}")

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/orders":
            try:
                deleted = clear_all_orders()
                self._send_json(200, {"deleted": deleted})
            except Exception as err:
                self._send_error_json(500, f"清除失败: {err}")
            return
        if not path.startswith("/api/orders/"):
            self._send_error_json(404, "接口不存在")
            return
        order_id = unquote(path[len("/api/orders/"):])
        try:
            delete_order(order_id)
            self._send_json(200, {"deleted": order_id})
        except ValueError as err:
            self._send_error_json(404, str(err))
        except Exception as err:
            self._send_error_json(500, f"删除失败: {err}")


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8765"))
    host = os.environ.get("HOST", "127.0.0.1")
    server = ThreadingHTTPServer((host, port), OrderHandler)
    print("=" * 40, flush=True)
    print("  智能订货系统", flush=True)
    print(f"  订货: http://{host}:{port}/", flush=True)
    print(f"  大屏: http://{host}:{port}/dashboard/", flush=True)
    print(f"  数据库: {DB_PATH}", flush=True)
    print("  按 Ctrl+C 停止", flush=True)
    print("=" * 40, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
