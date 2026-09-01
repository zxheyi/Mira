# Apple FY2024 Research Case 来源笔记

生成日期：2026-09-01
研究时点：2024-11-01（包含当日已公开信息）
用途：Mira Research Case v0 的真实公开案例与验收夹具
边界：仅整理可追溯事实与候选判断，不构成投资建议，也不生成或修改 thesis state。

## 1. 研究口径

- 公司：Apple Inc.（NASDAQ: AAPL）
- 会计期间：截至 2024-09-28 的 FY2024；补充截至 2024-09-28 的 Q4 FY2024。
- 一手来源：SEC EDGAR 上 Apple 的 FY2024 Form 10-K、Apple 官方 FY2024 Q4 earnings release；仅为 stale/revision 演示加入 SEC 上的 FY2023 Form 10-K。
- `accessedAt` 使用本次核验日期 `2026-09-01`。研究结论仍严格冻结在 `as-of 2024-11-01`，不会把之后发生的事件倒灌进案例。
- `validThrough: null` 表示历史期已发生且可由审计报表持续引用的事实；不表示后续期间仍保持同样趋势。时点状态和风险判断建议在下一份季度报告前失效，本笔记统一建议为 `2025-01-30`。
- stale 的语义是“对当前研究问题已被更新期间覆盖”，不是“旧来源失实”。

## 2. 已核验官方来源

1. [Apple Inc. FY2024 Form 10-K，SEC accession 0000320193-24-000123](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm)，报告期 2024-09-28，提交日 2024-11-01。SEC 的[提交索引页](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm)确认 Form 10-K、filing date 与 period of report。
2. [Apple reports fourth quarter results](https://www.apple.com/newsroom/2024/10/apple-reports-fourth-quarter-results/)，Apple Newsroom，2024-10-31；附有 Apple 官方的[合并财务报表 PDF](https://www.apple.com/newsroom/pdfs/fy2024-q4/FY24_Q4_Consolidated_Financial_Statements.pdf)。
3. [Apple Inc. FY2023 Form 10-K，SEC accession 0000320193-23-000106](https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm)，报告期 2023-09-30，提交日 2023-11-03。仅用于 stale/revision 流程。

## 3. Evidence 候选（15 项）

### E01 — FY2024 Q4 收入与一次性税务影响

- `key`: `E01_Q4_REVENUE_AND_EPS`
- `sourceType`: `company_material`
- `uri`: https://www.apple.com/newsroom/2024/10/apple-reports-fourth-quarter-results/
- `sourceTitle`: `Apple reports fourth quarter results`
- `locator`: `正文首段；脚注 1（Non-GAAP reconciliation）`
- `excerpt/paraphrase`: Apple 披露 Q4 FY2024 收入为 949 亿美元，同比增长 6%；GAAP 稀释 EPS 为 0.97 美元，排除与欧盟 State Aid 决定有关的一次性费用后为 1.64 美元。见[官方新闻稿正文与 Non-GAAP 脚注](https://www.apple.com/newsroom/2024/10/apple-reports-fourth-quarter-results/)。
- `publishedAt`: `2024-10-31`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2025-01-30`

### E02 — FY2024 全年收入、净利润与 EPS

- `key`: `E02_FY24_INCOME_STATEMENT`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 8, Consolidated Statements of Operations, Form 10-K pp. 28–29`
- `excerpt/paraphrase`: FY2024 总净销售额 3,910.35 亿美元，FY2023 为 3,832.85 亿美元；FY2024 净利润 937.36 亿美元，稀释 EPS 6.08 美元。见[合并利润表](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_121)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E03 — Services 收入增长到 961.69 亿美元

- `key`: `E03_FY24_SERVICES_GROWTH`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Products and Services Performance, Form 10-K p. 22，表格及 Services 段`
- `excerpt/paraphrase`: Services FY2024 净销售额为 961.69 亿美元，同比增加 13%；Apple 将增长主要归因于广告、App Store 与云服务。见[产品与服务收入表和解释](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_22)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E04 — Services 毛利率显著高于 Products

- `key`: `E04_FY24_GROSS_MARGIN_MIX`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Gross Margin, Form 10-K p. 23`
- `excerpt/paraphrase`: FY2024 Services 毛利率为 73.9%，Products 为 37.2%，公司总毛利率为 46.2%；上年分别为 70.8%、36.5% 与 44.1%。见[毛利率分部表](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_25)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E05 — iPhone 全年收入基本持平

- `key`: `E05_FY24_IPHONE_FLAT`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Products and Services Performance, Form 10-K p. 22，iPhone 行及解释段`
- `excerpt/paraphrase`: FY2024 iPhone 净销售额 2,011.83 亿美元，FY2023 为 2,005.83 亿美元；Apple 将同比变化描述为基本持平。见[产品类别收入表](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_22)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E06 — Greater China 收入下降 8%

- `key`: `E06_FY24_GREATER_CHINA_DECLINE`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Segment Operating Performance, Form 10-K pp. 21–22，Greater China 行及解释段`
- `excerpt/paraphrase`: Greater China FY2024 净销售额为 669.52 亿美元，同比下降 8%；Apple 指出主要原因是 iPhone 与 iPad 销售下降，人民币走弱也有不利影响。见[地区分部表与解释](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_19)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E07 — State Aid 决定带来 102 亿美元一次性所得税费用

- `key`: `E07_STATE_AID_TAX_CHARGE`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Provision for Income Taxes, Form 10-K p. 24`
- `excerpt/paraphrase`: FY2024 有效税率 24.1%，上年 14.7%；Apple 将主要差异之一归因于与 State Aid Decision 有关的约 102 亿美元一次性净所得税费用。见[所得税分析](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_28)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E08 — 经营活动现金流 1,182.54 亿美元

- `key`: `E08_FY24_OPERATING_CASH_FLOW`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 8, Consolidated Statements of Cash Flows, Form 10-K pp. 32–33`
- `excerpt/paraphrase`: FY2024 经营活动产生现金 1,182.54 亿美元，上年为 1,105.43 亿美元。见[合并现金流量表](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_145)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E09 — FY2024 股票回购现金支出约 949.49 亿美元

- `key`: `E09_FY24_SHARE_REPURCHASES`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 8, Consolidated Statements of Cash Flows, financing activities, Form 10-K p. 33`
- `excerpt/paraphrase`: FY2024 用于回购普通股的现金为 949.49 亿美元；Apple 另披露全年回购约 4.99 亿股。见[现金流量表融资活动](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_145)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `null`

### E10 — 流动性充足但仍有较大债务余额

- `key`: `E10_FY24_LIQUIDITY_AND_DEBT`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Liquidity and Capital Resources, Form 10-K p. 24`
- `excerpt/paraphrase`: 截至 FY2024 末，不受限现金、现金等价物和有价证券合计 1,408 亿美元；固定利率票据本金 973 亿美元，另有 100 亿美元商业票据。见[流动性与债务披露](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_31)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2025-01-30`

### E11 — DMA 调查可能触发最高相当于全球年收入 10% 的罚款

- `key`: `E11_DMA_INVESTIGATIONS`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part I, Item 3, Legal Proceedings — Digital Markets Act Investigations, Form 10-K p. 17`
- `excerpt/paraphrase`: 欧盟委员会在 2024 年开启三项 DMA 相关调查；若最终认定违规，可要求停止相关行为并处以最高相当于公司全球年度净销售额 10% 的罚款。Apple 同时表示其认为自身符合 DMA。见[法律程序披露](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_81)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2025-01-30`

### E12 — 制造主要由亚洲多地外包伙伴完成

- `key`: `E12_MANUFACTURING_CONCENTRATION`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part I, Item 1A, Risk Factors — international disputes and business interruptions, Form 10-K p. 5`
- `excerpt/paraphrase`: Apple 披露其几乎全部制造至少部分由外包伙伴完成，地点主要分布在中国大陆、印度、日本、韩国、台湾与越南；贸易限制可能增加成本并迫使供应链调整。见[供应链与国际贸易风险](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_34)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2025-01-30`

### E13 — 制造采购义务 530 亿美元

- `key`: `E13_MANUFACTURING_COMMITMENTS`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part II, Item 7, Liquidity and Capital Resources — Manufacturing Purchase Obligations, Form 10-K p. 25`
- `excerpt/paraphrase`: FY2024 末制造采购义务为 530 亿美元，其中 529 亿美元将在 12 个月内支付。见[制造采购义务](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_31)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2025-01-30`

### E14 — 复杂监管可能提高成本并改变产品或商业模式

- `key`: `E14_REGULATORY_CHANGE_RISK`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm
- `sourceTitle`: `Apple Inc. 2024 Form 10-K`
- `locator`: `Part I, Item 1A, Legal and Regulatory Compliance Risks, Form 10-K pp. 12–13`
- `excerpt/paraphrase`: Apple 说明，反垄断、数字平台、隐私、AI 等法律变化可能增加成本，限制功能供给，要求改变产品设计、业务或供应链。见[法律与监管风险](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_57)。
- `publishedAt`: `2024-11-01`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2025-01-30`

### E15 — FY2023 Services 增长 9%（stale 演示）

- `key`: `E15_FY23_SERVICES_GROWTH_OLD`
- `sourceType`: `regulatory_filing`
- `uri`: https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm
- `sourceTitle`: `Apple Inc. 2023 Form 10-K`
- `locator`: `Part II, Item 7, Products and Services Performance, Form 10-K pp. 21–22，Services 行及解释段`
- `excerpt/paraphrase`: FY2023 Services 净销售额为 852 亿美元，同比增加 9%。该历史数字仍真实，但用于判断 FY2024 增速时已被 E03 覆盖。见[FY2023 产品与服务收入表](https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm#i6e1e1bf50a934b4d829cbf91e57b4555_22)。
- `publishedAt`: `2023-11-03`
- `accessedAt`: `2026-09-01`
- `validThrough`: `2024-10-31`
- `state`: `stale`（在导入后执行 `markResearchEvidenceStale`；理由：FY2024 10-K 已给出更新期间的 Services 增速）

## 4. Claim 候选（8 项）

下列 `confidence` 只是对“来源足以支持当前措辞”的置信度，不是股价或投资回报概率。`reviewStatus` 初始均应为 `pending`；除 C00 外，均建议由人工或 Mira 研究协议审阅。

### C00 — FY2023 Services 增速为 9%（旧 Claim，随后 supersede）

- `statement`: 截至 FY2023，Apple Services 年度收入增速为 9%。
- `evidenceStatus`: `supported`
- `confidence`: `0.99`
- `thesisImpact`: `watch`
- `invalidationConditions`: 新年度或季度正式文件披露更新的 Services 收入增速。
- `lifecycle`: 先创建为 active；E15 标记 stale 后自动进入 `changes_requested`，再由 C01 修订并设为 `superseded`。
- links:
  - `E15 supports C00`：FY2023 10-K 直接给出 9%。
  - `E03 contradicts C00`：若 C00 被误读为“当前年度增速”，FY2024 的 13% 已取代该口径；矛盾来自期间过时，不是数字错误。

### C01 — Services 增长在 FY2024 加速（C00 的 revision）

- `statement`: Apple Services 收入从 FY2023 的 852 亿美元增至 FY2024 的 961.69 亿美元，FY2024 同比增速为 13%，高于 FY2023 的 9%。
- `supersedes`: `C00`
- `evidenceStatus`: `supported`
- `confidence`: `0.98`
- `thesisImpact`: `strengthen`
- `invalidationConditions`: 后续正式文件重述 FY2024 Services 收入，或下一期间显示 Services 收入同比下降。
- links:
  - `E03 supports C01`：FY2024 收入额、13% 增速及增长来源。
  - `E15 contextual C01`：提供 FY2023 的 9% 对比基线，但保持 stale，不作为当前期间主证据。
  - `E04 contextual C01`：补充 Services 的利润结构，但不证明收入增长本身。

### C02 — 全年收入恢复增长，但增长结构并不均衡

- `statement`: FY2024 总收入同比增长约 2%，但 iPhone 全年基本持平且 Greater China 收入下降 8%，因此收入增长主要不是由所有核心区域和硬件品类同步扩张驱动。
- `evidenceStatus`: `supported`
- `confidence`: `0.96`
- `thesisImpact`: `watch`
- `invalidationConditions`: FY2024 报表被重述，或后续期间 iPhone 与 Greater China 同时恢复持续同比增长。
- links:
  - `E02 supports C02`：总收入从 3,832.85 亿增至 3,910.35 亿美元。
  - `E05 supports C02`：iPhone 全年基本持平。
  - `E06 supports C02`：Greater China 下降 8%。
  - `E01 contextual C02`：Q4 单季收入增长 6%，说明年末动能强于全年，但不能单独外推到下一年度。

### C03 — Services 组合改善支持 FY2024 毛利率，但监管风险构成反证

- `statement`: FY2024 Services 的收入增长与更高毛利率改善了 Apple 的收入/毛利组合；与此同时，DMA 调查与更广泛的数字平台监管可能削弱这种经济性。
- `evidenceStatus`: `contested`
- `confidence`: `0.92`
- `thesisImpact`: `strengthen`
- `invalidationConditions`: Services 毛利率回落至接近 Products 水平，Services 收入下滑，或监管措施实质压低 App Store 等业务的费率和收入。
- links:
  - `E03 supports C03`：Services 收入增长 13%。
  - `E04 supports C03`：Services 毛利率 73.9%，显著高于 Products，并同比提升。
  - `E11 contradicts C03`：DMA 调查可能要求业务改变并带来重大罚款。
  - `E14 contradicts C03`：数字平台等法律变化可能限制功能或要求改变商业模式。

> 审核建议：由于存在有效 `contradicts` links，若批准 C03，review reason 必须明确说明“确认的是 FY2024 已观察到的组合改善，而非断言该经济性可无条件持续”。

### C04 — 经营现金流足以覆盖 FY2024 的高额资本回报，但并非无杠杆

- `statement`: FY2024 经营现金流为 1,182.54 亿美元，高于当年约 949.49 亿美元的股票回购现金支出；同时公司仍持有 973 亿美元固定利率票据和 100 亿美元商业票据。
- `evidenceStatus`: `supported`
- `confidence`: `0.98`
- `thesisImpact`: `strengthen`
- `invalidationConditions`: 经营现金流持续低于资本回报现金支出，流动性明显下降，或债务再融资能力恶化。
- links:
  - `E08 supports C04`：经营现金流规模。
  - `E09 supports C04`：股票回购现金支出。
  - `E10 contextual C04`：现金与证券余额以及债务余额，防止把“现金流覆盖”误写成“无杠杆”。

### C05 — 一次性税务费用扭曲 FY2024 GAAP 盈利同比比较

- `statement`: FY2024 GAAP 净利润和 EPS 同比下降，比较受到约 102 亿美元 State Aid 一次性所得税费用的显著影响；排除此项的 Q4 EPS 口径与 GAAP 口径不可混用。
- `evidenceStatus`: `supported`
- `confidence`: `0.98`
- `thesisImpact`: `watch`
- `invalidationConditions`: Apple 或 SEC 后续重述该费用的金额、性质或会计处理。
- links:
  - `E02 supports C05`：GAAP 净利润及稀释 EPS 同比下降。
  - `E07 supports C05`：一次性税务费用及有效税率变化。
  - `E01 contextual C05`：官方提供 Q4 排除一次性费用后的 Non-GAAP EPS，并明确要求对账。

### C06 — 供应链地域与外包伙伴集中仍是实质经营风险

- `statement`: Apple 的制造高度依赖亚洲多地外包伙伴，且一年内到期的制造采购义务接近 529 亿美元，贸易限制或供应中断可能带来成本和执行风险。
- `evidenceStatus`: `supported`
- `confidence`: `0.96`
- `thesisImpact`: `weaken`
- `invalidationConditions`: Apple 正式披露制造来源已显著分散、关键单一来源风险大幅下降，且短期采购义务明显降低。
- links:
  - `E12 supports C06`：制造地点、外包模式和贸易限制风险。
  - `E13 contextual C06`：量化短期制造采购承诺，但不单独证明供应中断概率。

### C07 — 监管是 Services 持续性的关键反向监测变量

- `statement`: 截至 2024-11-01，欧盟 DMA 调查和全球数字平台监管可能要求 Apple 改变 App Store 等业务实践，因而是 Services 增长与利润率持续性的关键风险变量。
- `evidenceStatus`: `supported`
- `confidence`: `0.94`
- `thesisImpact`: `weaken`
- `invalidationConditions`: DMA 调查终结且无重大整改或罚款，或后续证据表明相关变更不影响 Services 收入与利润率。
- links:
  - `E11 supports C07`：具体调查、潜在救济与罚款上限。
  - `E14 supports C07`：广泛监管变化可能提高成本并改变产品、业务或供应链。
  - `E03 contextual C07`：Services 当前增长良好，是需要监测的暴露面。
  - `E04 contextual C07`：Services 当前毛利率较高，说明潜在影响的重要性，但不证明未来损失。

## 5. stale → revision 验收脚本

该流程刻意演示“旧事实仍真，但不能继续作为当前结论的主证据”：

1. 提交包含 E15 与 C00 的初始 research packet；C00 为 active/pending。
2. 同一 packet 保留 E03，然后对 E15 执行 `markResearchEvidenceStale`，reason：`FY2024 10-K supersedes the prior-period growth rate for current-period analysis`。
3. 预期结果：E15 变为 `stale`；C00 自动变为 `changes_requested`；同一事务留下 audit event。
4. 用 C01 执行 `reviseResearchClaim`，显式声明 `supersedes: C00`，仅链接 E03、E15、E04。
5. 预期结果：C00 变为 `superseded`；C01 为 active/pending；E15 仍保留且清楚标注 stale。
6. 审核 C01 时，批准理由只覆盖 FY2024 已披露的增长，不把 13% 外推为未来增长率。

## 6. 最小验收断言

- Evidence 总数：15；官方文档源：3；域名仅 `sec.gov` 与 `apple.com`。
- Claim 总数：8（含 1 条 superseded 前身和 1 条 revision 后继）。
- 至少一个 `contradicts`：E11/E14 → C03；另有 E03 → C00 的期间更新型冲突。
- stale：E15；revision：C00 → C01。
- 历史审计值与时点状态分开设置 `validThrough`，避免把已发生的 FY2024 数字误判为“过期”，也避免把监管/流动性状态无限延长。
- 所有候选只进入 Research Case；不得直接写入正式 Memory，更不得修改外部 thesis state。

## 7. 关键风险与使用限制

1. **期间错配**：Apple FY2023 有 53 周，FY2024 有 52 周；同比解释不应假设周数完全一致。该事实见[FY2024 10-K 的 Fiscal Period](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm#i76a7e3b1866f4c49821d52719f1e6d1c_16)。
2. **GAAP/Non-GAAP 混用**：E01 的 1.64 美元是排除一次性费用的 Q4 Non-GAAP 指标；全年与法定报表应优先使用 10-K GAAP 数字。
3. **管理层因果说明的边界**：诸如“增长主要来自广告、App Store 与云服务”属于公司在正式文件中的管理层解释，不等于经第三方独立证明的因果结论。
4. **风险披露不是发生概率**：DMA 罚款上限、供应链中断与监管变化是暴露与情景，不应被编码为已发生损失。
5. **as-of 边界**：本笔记检索于 2026-09-01，但案例只能使用截至 2024-11-01 已公开信息；实现验收时应禁止后来材料改变当时 claim 的证据状态。
