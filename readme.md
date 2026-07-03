# IntelliOrder

面向零售/服装行业的智能订货与业绩监看系统。基于 Excel 订货数据，提供年度对比分析、历史销售查询、智能尺码推荐与订货单管理；另含店铺业绩可视化大屏。

## 功能概览

### 智能订货系统

访问地址：`http://127.0.0.1:8765/`

| 模块 | 功能 |
|------|------|
| **概览** | 同期 vs 当前订货对比（款色数、订货量、买货额、件单价）；大类/性别图表；OTB 买货额与增长率；区域/中类明细表，支持导出 CSV |
| **历史数据** | 按区域、品牌、年份、季节、款号 Bi 等条件筛选历年销售记录，查看尺码分布 |
| **新建订货** | 从当前商品目录选款，基于历年历史销量智能推荐订货量与尺码分配，支持手动调整 |
| **订货单** | 管理已下订单，编辑尺码明细，批量智能匹配未下款项色，数据持久化至 SQLite |

### 店铺业绩监看大屏

访问地址：`http://127.0.0.1:8765/dashboard/`

展示总业绩、完成率、同比、店铺排名、完成率分布等 KPI 图表（当前为 Mock 演示数据）。

---

## 快速开始

### 环境要求

- **Python 3**（已加入系统 PATH）
- **openpyxl**（Excel 转 JSON 缓存）

```bash
pip install openpyxl
```

### 准备数据

克隆仓库后，在项目根目录创建 `datasource/` 目录，放入以下 Excel 文件：

| 文件名 | 用途 |
|--------|------|
| `历年数据.xlsx` | 历史销售数据，用于智能推荐 |
| `同期数据.xlsx` | 概览对比·同期基准 |
| `当前数据.xlsx` | 概览对比·当前订货、商品目录 |
| `当前数据尺码明细.xlsx` | 款色级尺码明细 |
| `OTB.xlsx` | OTB 买货额目标 |

商品图片（可选）放入 `datasource/PIC/`，文件名与款号一致（如 `AM0AM13008ACI.jpg`）。

> `datasource/` 已加入 `.gitignore`，不会随仓库分发，需自行准备业务数据。

### 启动

双击或在命令行运行：

```bat
start.bat
```

启动流程：

1. 释放端口 `8765`
2. 运行 `backend/generate_manifest.py`，将 Excel 转为 `datasource/cache/*.json`
3. 启动 HTTP 服务并自动打开浏览器

| 地址 | 应用 |
|------|------|
| `http://127.0.0.1:8765/` | 智能订货系统 |
| `http://127.0.0.1:8765/dashboard/` | 业绩监看大屏 |

按 `Ctrl+C` 停止服务。

> 请勿直接打开 `frontend/order/index.html`，订货 API 依赖后端服务。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8765` | 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址 |

---

## 打包发布

运行 `build.bat` 可生成独立可执行文件：

```bat
build.bat
```

输出目录 `dist/`：

```
dist/
├── IntelliOrder.exe      # 双击启动
├── datasource/           # 需放置 Excel 与 PIC 图片
└── README.txt
```

运行后订货数据保存在 `dist/data/orders.db`。

---

## 目录结构

```
IntelliOrder/
├── backend/                # Python 后端
│   ├── main.py             # EXE 打包入口
│   ├── server.py           # HTTP 静态服务 + REST API
│   └── generate_manifest.py
├── frontend/
│   ├── order/              # 智能订货系统
│   └── dashboard/          # 业绩监看大屏
├── datasource/             # Excel 数据源（本地，不入库）
│   ├── *.xlsx
│   ├── cache/*.json        # 启动时自动生成
│   ├── manifest.json
│   └── PIC/
├── data/                   # SQLite 订货库（运行时生成）
├── start.bat               # 开发启动
└── build.bat               # PyInstaller 打包
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5、CSS3、原生 JavaScript（ES Module） |
| 后端 | Python 3 标准库（`http.server`、`sqlite3`） |
| 数据 | SQLite、JSON 缓存 |
| 图表 | ECharts 5.5.0（大屏，CDN） |
| 打包 | PyInstaller |

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/orders` | 列出全部订货单 |
| PUT | `/api/orders` | 新增/更新订货单 |
| DELETE | `/api/orders/{id}` | 删除单条 |
| DELETE | `/api/orders` | 清空全部 |
| POST | `/api/orders/migrate` | localStorage → SQLite 迁移 |
| GET | `/api/product-images` | 商品图片索引 |

---

## 常见问题

**启动后页面无数据**

确认 `datasource/` 下 Excel 文件名与上表一致，并重新运行 `start.bat` 生成缓存。

**提示未安装 openpyxl**

```bash
pip install openpyxl
```

**端口被占用**

`start.bat` 会自动释放 8765 端口；也可通过环境变量 `PORT` 指定其他端口。
