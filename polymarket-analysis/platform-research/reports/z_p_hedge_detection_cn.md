# Z / P 对冲识别结论

生成时间：2026-03-29

输入：

- `Z`：[MyBets_20260329.wpsjson.normalized.json](../normalized/z/MyBets_20260329.wpsjson.normalized.json)
- `P`：[wallet_a.normalized.json](../normalized/p/wallet_a.normalized.json)

输出：

- 严格阈值：[z_p_hedge_candidates.v2.json](../normalized/z_p_hedge_candidates.v2.json)
- 低阈值探索：[z_p_hedge_candidates.v2.low.json](../normalized/z_p_hedge_candidates.v2.low.json)

## 结论

当前数据再次支持你的经验判断：

`Z` 和 `P` 很少形成真正意义上的对冲关系。`

## 证据

### 严格阈值

- 候选数：`0`

说明：

- 在时间、品类、对阵、盘口家族、方向提示这些维度综合打分后，没有出现高可信对冲对。

### 低阈值探索

- 候选数：`7`

但这 7 条主要只有两个特征：

- 同品类
- 时间接近

它们缺少真正关键的对冲证据：

- 相同对阵
- 相同事件日
- 相同盘口家族
- 明确相反方向

因此这些更像“边缘相似记录”，不是强对冲。

## 含义

这意味着：

1. `Z` 和 `P` 当前更像两个不同主战场的平台
2. `R` 更有可能出现在对冲关系层，而不是直接来自 `Z/P` 的自然配对
3. 继续研究 `R`，关键不在 `Z-P`，而在未来补进：
   - `Z-R`
   - `R-P`

## 当前最重要的工作结论

如果你接下来要把精力集中在最有效的方向上，那么优先级应该是：

1. 保留 `Z/P` 的平台画像研究
2. 不再期待从 `Z/P` 直接挖出大量对冲
3. 未来一旦拿到任何 `R` 相关样本，立刻走同一套对冲识别流程
