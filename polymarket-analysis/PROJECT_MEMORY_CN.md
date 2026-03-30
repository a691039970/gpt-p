# 项目总入口

更新时间：2026-03-30

## 1. 项目目标

项目目录：
- `D:\gpt\polymarket-analysis`

核心方向：
- 先不优先做 UI
- 当前重点是研究 `Z` 平台的可复制盈利规律
- 最终目标是把平台规律转成可执行的半自动跟随逻辑

## 2. 平台定义

- `Z`：你提供的历史 `.xls` 数据平台，不是某个人
- `P`：目前等同于 Polymarket 地址 `0x490b4fE78B2FB36f733FeF1b340759e03500eec9` 的公开信号流
- `R`：不是完整原始数据平台，当前按“关系层/对冲层平台”理解，未来通过 `Z-R` 或 `R-P` 样本重建
- `B`：地址 `0x115edF00e95798fcE4B1c2786942Dc4A5da7f21c`，用于执行复核

## 3. 已完成的执行层

网页项目：
- `D:\gpt\polymarket-analysis\web-dashboard`

关键状态：
- 已做成平台视角而不是“跟人”视角
- `A` 地址实时轮询与 SSE 推送已接好
- `B` 地址 5 分钟复核已接好
- 已匹配信号会归档隐藏

当前网页地址：
- [http://127.0.0.1:3187/](http://127.0.0.1:3187/)

但当前优先级：
- 先不继续 UI
- 先继续 `Z` 平台研究

## 4. 研究目录

- `D:\gpt\polymarket-analysis\platform-research`

重要子目录：
- `reports`
- `normalized`
- `scripts`

## 5. 当前最重要的研究结论

### 5.1 Z 不是高命中平台

`Z` 不是靠高胜率赚钱的平台。  
它更像：
- 赔率差平台
- 结构选择平台
- 仓位分层平台
- 尾部利润驱动平台

### 5.2 Z 的真正 edge 不平均分布

不是所有品类、盘口、赔率区都一样。  
真正重要的是：
- 哪个品类
- 哪种盘口
- 哪个赔率区
- 当前状态是否偏强

### 5.3 当前最强的主线

最像核心 edge 的方向：
- `Dota2`
- `LoL`

特别是 `Dota2` 的：
- `独赢盘`
- `地图1独赢盘`
- `地图2独赢盘`

### 5.4 当前明显偏弱的方向

- `Basketball`
- 特别是很多 `赛局让球盘 / 赛局大小盘 / 赛局独赢盘`
- 全局 `4.0+`
- 一些中赔率但结构偏差的组合

## 6. 已完成的关键报告

先读这些：

1. 总体研究主线  
[current_system_and_platform_thesis_cn.md](D:/gpt/polymarket-analysis/platform-research/reports/current_system_and_platform_thesis_cn.md)

2. Z 年度深度分析  
[z_yearly_deep_analysis_cn.md](D:/gpt/polymarket-analysis/platform-research/reports/z_yearly_deep_analysis_cn.md)

3. Z 分品类子策略  
[z_category_strategy_models_cn.md](D:/gpt/polymarket-analysis/platform-research/reports/z_category_strategy_models_cn.md)

4. Z 状态评分模型  
[z_state_model_cn.md](D:/gpt/polymarket-analysis/platform-research/reports/z_state_model_cn.md)

5. Z 盘口类型与赔率区间  
[z_market_price_edges_cn.md](D:/gpt/polymarket-analysis/platform-research/reports/z_market_price_edges_cn.md)

6. Z 盈利方式拆解  
[z_profit_engine_cn.md](D:/gpt/polymarket-analysis/platform-research/reports/z_profit_engine_cn.md)

## 7. 已完成的关键数据文件

1. 年度总样本  
[z_merged.yearly.current.json](D:/gpt/polymarket-analysis/platform-research/normalized/z/z_merged.yearly.current.json)

2. 年度平台摘要  
[z_yearly_vs_p.summary.json](D:/gpt/polymarket-analysis/platform-research/normalized/z_yearly_vs_p.summary.json)

3. 周期摘要  
[z_yearly_periodicity.summary.json](D:/gpt/polymarket-analysis/platform-research/normalized/z_yearly_periodicity.summary.json)

4. 子策略摘要  
[z_category_models.summary.json](D:/gpt/polymarket-analysis/platform-research/normalized/z_category_models.summary.json)

5. 状态模型摘要  
[z_state_model.summary.json](D:/gpt/polymarket-analysis/platform-research/normalized/z_state_model.summary.json)

6. 盘口与赔率摘要  
[z_market_price_edges.summary.json](D:/gpt/polymarket-analysis/platform-research/normalized/z_market_price_edges.summary.json)

7. 盈利方式摘要  
[z_profit_engine.summary.json](D:/gpt/polymarket-analysis/platform-research/normalized/z_profit_engine.summary.json)

## 8. 已完成的关键脚本

- [analyze_z_periodicity.js](D:/gpt/polymarket-analysis/platform-research/scripts/analyze_z_periodicity.js)
- [analyze_z_category_models.js](D:/gpt/polymarket-analysis/platform-research/scripts/analyze_z_category_models.js)
- [build_z_state_model.js](D:/gpt/polymarket-analysis/platform-research/scripts/build_z_state_model.js)
- [analyze_z_market_price_edges.js](D:/gpt/polymarket-analysis/platform-research/scripts/analyze_z_market_price_edges.js)
- [analyze_z_profit_engine.js](D:/gpt/polymarket-analysis/platform-research/scripts/analyze_z_profit_engine.js)

## 9. 当前最接近真实的判断

目前最重要的判断不是“Z 强不强”，而是：

`Z` 的盈利方式是通过筛选少数高价值结构，再靠这些高贡献单决定总账。`

所以未来真正可复制的，不会是“全量复制 Z”，而是：
- 复制它赚钱的那部分结构
- 回避它长期净亏的那部分结构

## 10. 下一步最优先任务

当前下一步不要先做 UI。  
最优先做：

`Z 可复制策略回测原型`

建议顺序：

1. 做样本内 / 样本外拆分
2. 用固定仓位回放
3. 只保留最强结构
4. 看这些结构能否在样本外继续成立
5. 再叠加状态评分模型

## 11. 新窗口接力建议

在新窗口直接发：

```text
继续 D:\gpt\polymarket-analysis 项目。
先读 D:\gpt\polymarket-analysis\PROJECT_MEMORY_CN.md
当前重点不是 UI，而是继续研究 Z 平台的可复制盈利规律。
下一步先做 Z 可复制策略回测原型。
```
