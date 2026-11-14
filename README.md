# 能力与成本-硬件

Nous 插件：CPU、GPU 各一页，页内是能力-成本散点图与排行。横轴价格（对数刻度），纵轴能力，绿色阶梯线是当前快照里的能力前沿——每一档价格上买到的最强型号。悬停任一型号，图上与排行里同时亮起。

图表只画能力最高的 100 款，排行列出全部。点上的型号标签按疏密自动取舍：能力高的先放，碰撞就换位置，放不下就不放，所以缩放以后同一片区域能放更多。图表可缩放（− / +、Ctrl/⌘ + 滚轮、双指捏合）、可拖拽平移、可全屏（浏览器全屏，不支持时退回铺满窗口）。普通滚轮仍然滚动页面。

## 数据快照

插件页面在宿主 iframe 里不联网，所以能力与价格不是打开时去抓的，而是随包携带一份**快照**（`ui/data.js`）。快照按天刷新：

1. `tools/snapshot.mjs` 读取上游数据，校验、排序、加上生成时间，写出 `ui/data.js`；
2. 定时任务每天跑一次，然后重新打包发布；
3. 用户安装或更新后，打开插件看到的就是最近一次快照。

页面右下角显示快照日期，也可以点「导入快照」手动载入一份 JSON（存进当前账户的插件存储，换账户互不影响）。

当前仓库内的快照来自 `tools/reference-scores.json`：CPU、GPU 各 104 款，CPU 用 Cinebench R23 多核，GPU 用 3DMark Time Spy 图形分，价格为首发建议零售价（美元）。其中一部分是社区参考值（`"ref": true`）。正式发布前应换成有授权的数据源：

```sh
node tools/snapshot.mjs --url https://你的数据源/snapshot.json
```

上游 JSON 的形状与 `tools/reference-scores.json` 相同：`{cpu:{metric,spec,items:[{name,brand,spec,score,price,ref?}]}, gpu:{…}}`。

## 发行

发行包：<https://github.com/liveldy/Nous-Plugin-Hardware-Capability-Cost/releases/download/v1.1.0/app.nous.hardware-cost-1.1.0.nous-plugin.json>

SHA-256：`SHA_PLACEHOLDER`

## 命令

```sh
node sdk/dev.mjs .            # 本机模拟宿主，浏览器打开 http://127.0.0.1:8088/
node sdk/check.mjs .          # 协议、权限、方法、资源预检
node sdk/pack.mjs .           # 生成 dist/app.nous.hardware-cost-1.1.0.nous-plugin.json
node tools/snapshot.mjs       # 重新生成快照（--from、--url、--date 可选）
```

## 结构

```
manifest.json            插件清单（Plugin Interface 1.3，需要 Nous 1.2.0+）
ui/index.html            页面骨架：标题、图、排行、快照栏
ui/style.css             设计令牌与样式（Archivo，随包字体）
ui/app.js                渲染图表（缩放/全屏/智能标注）、排行、悬停联动、快照导入
ui/data.js              快照（由 tools/snapshot.mjs 生成，勿手改）
ui/nous-plugin.js        宿主页面 SDK（MIT）
ui/fonts/                Archivo latin 子集与 OFL 许可
tools/snapshot.mjs       快照生成器
tools/reference-scores.json  离线参考表
.github/workflows/snapshot.yml  每日刷新任务
```

权限只有 `storage`：保存导入的快照，按账户隔离。没有原生模块，网页、Windows、Android 用同一份页面。

## 验证

- `node sdk/check.mjs .`：三个平台的协议、权限、必需方法、资源检查通过。
- `node sdk/pack.mjs .`：打包通过，资源与摘要见打包输出。
- taste-skill：`copy-lint` 0 FAIL 0 WARN；`perf` PASS；完成度闸门 `GATE: PASS`；1440/1024/768/390 截图逐张看过，另看过深色、缩放、悬停、全屏与 GPU 页。
- 闸门最后剩下 5 条按落地页写的规则，按"判断为误报"豁免，理由写在 `.taste-skill/waivers.json`：排行榜不需要配图（no-visual）、数据视图没有转化按钮（cta）、入场由页面 CSS 负责而非随包 motion.js（hero-enter）、图表本身即这一版的举动（moment-none）、104 行排行不做整屏裁切（section-height）。
- 未验证：真实 Nous 客户端内的导航与账户存储（需要安装后手动走一遍），以及导入快照的端到端流程（只在浏览器里验证过解析与渲染）。

数据是参考值，不是实测；发布前需要接入有授权的数据源并确认价格口径。
