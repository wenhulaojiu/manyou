# 慢游可复用 GitHub 项目调研

核查日期：2026-10-25（北京时间）。本次读取仓库 README、部分源码、许可证、数据样例与发布信息；没有安装新依赖、执行第三方代码或验证真实票务报价。

## 优先采用

| 项目 | 用于慢游的具体位置 | 成本 | 限制 |
| --- | --- | --- | --- |
| [Joooook/12306-mcp](https://github.com/Joooook/12306-mcp) | 扩展 providers.mjs，调用中转与列车经停查询，辅助选择中转候选 | 低至中，已经依赖 0.3.10 | 中转结果不能代替跨方式、主动停留计算；城市代码不意味着自动查询全城车站 |
| [wensimehrp/chinese-railway-gtfs](https://github.com/wensimehrp/chinese-railway-gtfs) | 建立站点、班次和时刻索引，为 rail-scan.mjs 与 search-engine.mjs 安排查询顺序 | 中，需要数据导入与更新 | 无票价和余票；必须核对运营日期，不能把离线时刻视为实时可购 |
| [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) | 统一查询队列、优先级、有限并发、限速和取消 | 低至中 | 正在执行的工作必须自行响应 signal；引入库不会自动解决旧任务清理竞态 |
| [GoogleChromeLabs/comlink](https://github.com/GoogleChromeLabs/comlink) | 把 planner.mjs 放入 Web Worker，前端异步读取推荐、计数和分页 | 低至中 | 不降低算法复杂度；仍需时间索引、增量计算及查询版本隔离 |
| [mborsetti/airportsdata](https://github.com/mborsetti/airportsdata) | 生成机场目录、城市多机场映射及坐标 | 中 | 地名主要是拉丁字母；机场存在不代表报价商支持；不能直接按 city 字段归并全部中国机场 |
| [mswjs/msw](https://github.com/mswjs/msw) | 在测试中模拟 /api/search、取消、超时、429、部分响应及断流 | 低至中，开发依赖 | 不模拟 MCP stdio；这部分仍应注入假的 providers。中文原始字节分块问题需真实 Node HTTP 集成测试 |

### 12306-mcp：优先利用已有能力

上游架构提供 get-interline-tickets、get-train-route-stations、get-stations-code-in-city 等工具。目前慢游只调用 get-tickets。建议先用少量主要车站的中转结果发现候选枢纽，再进行独立分段查价与现有成本计算。

已核对源码：get-station-code-of-citys 返回代表城市的车站代码，不能据此声称一次调用覆盖所有车站。必须保留站点覆盖统计。

许可证 MIT；README 写明仅用于学习。代码许可不代表票务数据的收费再分发授权。

来源：[架构](https://github.com/Joooook/12306-mcp/blob/main/docs/architecture.md)、[源码](https://github.com/Joooook/12306-mcp/blob/main/src/index.ts)。GitHub 元数据本次返回最后推送日期 2026-07-31，上游 package.json 版本仍为 0.3.10。

### 中国铁路 GTFS：减少无效查询

仓库提供线路、车站坐标、时刻表；标注数据许可证 CC BY 4.0。发布页已核对到 gtfs-20261024-052143，包含 output_gtfs.zip（约 58.7 MB）和 lines.json。尚未下载、校验完整 feed 的质量和具体日期覆盖。

建议在后端导入并建立索引，不把整个文件发送到浏览器。根据起终点、有效运营日期、换乘时间生成候选，再实时核验票价与席位。数据缺失或过期时回退到当前查询，并展示覆盖限制。便宜的慢车仍需保留，不能只用最快到达候选代替最低价搜索。

坐标为 WGS84；若将来连接使用 GCJ-02 的地图，需要正确转换。仓库注明坐标来自 OpenStreetMap，导入时保留来源与署名信息。

来源：[说明](https://github.com/wensimehrp/chinese-railway-gtfs/blob/main/README.md)、[发布](https://github.com/wensimehrp/chinese-railway-gtfs/releases/tag/gtfs-20261024-052143)。

### p-queue 与 Comlink：分别解决调度和交互

p-queue 为 MIT；当前主分支 package.json 要求 Node >=22，与本项目声明匹配。支持优先级、限并发、限速和 AbortSignal。官方文档明确：取消运行中的任务不会强制停止底层函数。仍需为每次搜索保留独立 ID、控制器和资源归属。

Comlink 为 Apache-2.0，用于简化主线程和 Worker 通信。建议让 Worker 保留候选及索引，主线程只接收推荐和当前页，避免每次传回数万条路线。停止或重查时丢弃旧版本结果。

来源：[p-queue 取消说明](https://github.com/sindresorhus/p-queue#signal)、[Node 要求](https://github.com/sindresorhus/p-queue/blob/main/package.json)、[Comlink API](https://github.com/GoogleChromeLabs/comlink#api)。本次 GitHub 元数据返回最后推送日期分别为 2026-10-16、2026-10-14；主分支内容不等于已发布 npm 版本，接入时另行锁定版本。

### airportsdata：数据可用，城市映射需要加工

已检查 CSV 中 PEK、PKX、SHA、PVG、CTU、TFU 六个机场记录。TFU 的 city 为 Tianfu，CTU 为 Chengdu；不能仅通过 city == Chengdu 查全成都机场。项目附带 iata_macs.csv，其中有北京、上海的多机场关系，但不能代替我们完整的中文城市别名表。

建议将所需中国机场转换成本地 JSON，并维护“中文城市 → 一个或多个 IATA 机场”的显式映射。无需为了使用 CSV 给运行服务增加 Python 依赖。

已读 LICENSE 正文，为 MIT（GitHub 自动检测显示 Other，因此不能只看 API 的许可证字段）。本次元数据返回最后推送日期 2026-10-24。

来源：[机场 CSV](https://github.com/mborsetti/airportsdata/blob/main/airportsdata/airports.csv)、[多机场城市 CSV](https://github.com/mborsetti/airportsdata/blob/main/airportsdata/iata_macs.csv)、[许可证](https://github.com/mborsetti/airportsdata/blob/main/LICENSE)。

## 适合参考，暂不直接移植

### huanchong-99/Go-Home

与慢游目标接近，提供空铁组合、查询档位、枢纽选择、结构化路线计算和导出。可以参考“快速/推荐/全面”搜索策略及结果解释。README 声明 MIT，但根目录未发现完整 LICENSE；嵌入的两个上游项目各有许可证，不能把它们的许可直接推定为整个项目的许可。

现有 route_calculator.py 使用 Python，计算规则与慢游不同；README 还描述超出铁路窗口时自动调整日期、固定住宿费和固定换乘档位，这些不适合原样搬进来。机票依赖浏览器查询，不能解决稳定供应商问题。

来源：[README](https://github.com/huanchong-99/Go-Home)、[计算源码](https://github.com/huanchong-99/Go-Home/blob/main/route_calculator.py)。本次元数据返回最后推送日期 2026-03-06。

### planarnetwork/raptor

适合研究按时刻表找换乘、多起终点、跨日和多线程规划。当前文档要求 GTFS 输入，并明确未实现 mcRaptor 多标准算法；不能直接视为最低票价或时间价值优化器。

README 与 package.json 标明 GPL-3.0。考虑数据适配和分发许可，暂不作为当前版本直接依赖；先借助论文理解算法，再决定是否需要完整路由引擎。

来源：[README](https://github.com/planarnetwork/raptor)、[package.json](https://github.com/planarnetwork/raptor/blob/master/package.json)。本次元数据返回最后推送日期 2026-10-21。

### xiaonie7/FlightTicketMCP

MIT；源码通过 Python + DrissionPage 打开携程页面、等待加载并解析航班，异常时返回空数组。适合本机小范围试验，不建议作为当前默认生产报价源。需要先验证失败能否与“无航班”区分，以及页面变动、登录、速度和覆盖。

来源：[仓库](https://github.com/xiaonie7/FlightTicketMCP)、[实际查询源码](https://github.com/xiaonie7/FlightTicketMCP/blob/main/flight_ticket_mcp_server/tools/flight_search_tools.py)。本次元数据返回最后推送日期 2025-09-01。

### fzk888/airticket-compare

README 声称四平台比价，携程和去哪儿需要登录 Cookie，依赖 Python/Playwright，且注明网页价格可能与 App 不同。仓库树中未发现 LICENSE，暂不复制其实现。其“飞猪官方 API”说法未独立核实，不能据此认定获得稳定公开接口或商用授权。

来源：[README](https://github.com/fzk888/airticket-compare/blob/master/README.md)。本次元数据返回最后推送日期 2026-06-29。

## 建议落地顺序

1. 先修搜索 ID、取消归属和过期回调，再引入 p-queue，避免并发放大现有竞态。
2. 接入 Worker/Comlink，缓存计算结果，按页返回；同时用索引缩小两段路线的组合范围。
3. 扩展已有 12306 中转接口，校验 GTFS 样本后增加静态时刻索引，减少无效车站组合查询。
4. 用 airportsdata 补机场目录与中文映射，再用真实授权的机票供应商验证覆盖。
5. 用 MSW 加浏览器流程测试；HTTP 编码和 MCP 生命周期用专门的集成测试验证。

维护日期仅表示仓库推送活动，不保证功能可用。GitHub 匿名 API 在后半段出现额度限制，铁路 GTFS 的更新情况改由发布页面核查。
