---
title: "KakaReel 个人定价决策报告：Higgsfield、Runway、Invideo 页面与截图研究"
date: 2026-10-21
status: "已完成公开页面研究；建议未定案、未修改线上价格"
scope: "个人使用；排除团队与 Enterprise；Invideo 采用一席口径"
method: "Chrome Glow 实际访问、月年切换、截图观察、官方帮助与条款交叉核对"
source_file: "VibeFriends-Materials/kakareel-2026-10/pricing-20261021/"
---

# KakaReel 个人定价决策报告

**建议：先把个人用户的一次购买做清楚，再扩展订阅。页面学 Higgsfield 的用途表达、Runway 的比较清晰度、Invideo 的用量估算；不要复制它们的全年承诺、复杂席位和限时 Unlimited。**

“只做 Individual”确定的是服务对象，不等于已经决定采用自动续费。现有项目采用一次性积分包准备方案；本轮没有将它擅自改成订阅。月订阅仅作为未来另行批准的备选，本报告也列出三档候选和必须补齐的能力。价格数字是待验证假设，不能直接成为上线承诺。

## 1. 这次实际看了什么

2026-10-21，通过浏览器插件访问三家官方 Pricing，实际切换月／年、查看高用量选项与用量估算器，并观察截图。三家浏览器本轮均显示美元符号；Invideo 的独立 web 抽取曾显示欧元，因此本报告统一采用浏览器美元采样，不将两个展示版本混算。未购买、未进入支付确认、未使用它们的付费生成。

Higgsfield 和 Runway 选择 Individual。**Invideo 当前没有 Individual 标签**，只有 Team plans／Business plans；研究其公开 Starter／Plus／Max 的一席购买价格，不把赠送 guest seats 的额度计入个人可用量。它的计算器默认三席，已手动降到一席核验。

这份报告区分三种证据：**页面事实**是截图／界面所示；**官方规则**来自帮助与条款；**分析和建议**是对机制的判断。没有取得三家的转化率、留存、收入或利润，不能证明某个设计提升多少转化，也不能把成熟品牌的策略直接称为适合 KakaReel 的已验证答案。

截图归档于 frontmatter 指向的库外目录，文件名见末尾清单。报告附本机相对图片链接；公开 GitHub 只保存文本，二进制原图不入代码仓库。Higgsfield 的 Cookie 浮层保留原状，遮挡处以可见 DOM 和官方规则补证，不伪造无遮挡截图。

## 2. 先比较真实支付口径

下表的年付月均都**不是每月只扣这一金额**。年总额为月均乘 12 的税前名义金额／页面声明金额，未经结账核价；自动续费、税费和额外促销仍以实际购买条款为准。

| 产品／个人档位 | 月付展示 | 年付月均 | 年度名义付款 | 每月积分 | 最重要的升级理由 |
|---|---:|---:|---:|---:|---|
| Higgsfield Starter | $19 | $19 | $228 | 270 | 首次创作；模型选择受限 |
| Higgsfield Plus | $59 | $47 | $564 | 1,200 | 全模型、较高额度与并发；指定限时权益 |
| Higgsfield Ultra 默认 | $129 | $99 | $1,188 | 3,000 | 更大用量、指定 Unlimited 和付费并发 |
| Runway Free | $0 | — | — | 125，**一次性** | 体验入口，不是每月赠送 |
| Runway Standard | $15 | $12 | $144 | 625 | 付费模型、无水印、基本项目与存储 |
| Runway Pro | $35 | $28 | $336 | 2,250 | 更高并发、工作流及创作者能力 |
| Runway Max | $95 | $76 | $912 | 9,500 | 重度个人创作、结转一个月、专业输出 |
| Invideo Starter／1 席 | $20 | $10 | $120 | 400 | 基础编辑与有限模型 |
| Invideo Plus／1 席 | $60 | $30 | $360 | 2,000 | 解锁高级代理与 Seedance 高阶模型 |
| Invideo Max／1 席默认 | **首期 $135，续费 $150** | $75 | $900 | 5,000 | 大用量与低单位积分价格 |

来源：[Higgsfield 定价](https://higgsfield.ai/pricing)、[Runway 定价](https://runway.com/pricing)、[Invideo 定价](https://invideo.io/pricing/)。

**不要按“每 1,000 积分多少钱”横向排出谁最便宜。** 积分是各家的内部计量单位，模型、秒数、分辨率、是否带声音、失败规则都不同。它适合比较同一产品内部升级，不适合直接跨产品换算。各家还有图片、编辑、音频、存储等捆绑价值，KakaReel 当前只做视频生成，不能直接借这些捆绑产品的标价证明自身定价合理。

### 折扣中真正影响决策的细节

- **Higgsfield 不是所有个人档都打七折。** Starter 年付无差价；Plus 59→47，约省 20.3%；Ultra 默认 129→99，约省 23.3%。30% 是更高配置／活动的宣传入口，不应套到每一张卡。
- **Runway 三个付费档年付均比常规月付便宜 20%。** 个人账期切换旁的 UI 同时写“两个月免费”（见年付截图右侧）；与顶部 Enterprise 限时活动是不同位置的文案，预算仍按明确金额算。
- **Invideo Max 的首期和续费不同。** 默认档年付“省 $885”可由 `135 + 11×150 − 900 = 885` 解释，不能用 `150×12−900` 指责它算错。年付续费是否持续享受同一折扣未进入结账核验。
- **高用量档把加购放进同一张卡。** Higgsfield Ultra 6,000 积分首期 $220、续 $250，年付月均 $194；9,000 首期 $310、续 $375，年付月均 $270。Invideo Max 10,000 首期 $265、续 $300，年付月均 $150；15,000 首期 $373、续 $450，年付月均 $225。这能覆盖重度个人，未必需要单独造第四、第五个产品名称。

高档折扣基准仍有不一致：Higgsfield 年付 6k／9k 卡划线 $258／$387，而对应月续费是 $250／$375；Invideo 高档“省 $1,764／$2,624”与显示整数计算各差 $1。可能涉及未展示的小数或优惠基准，**原因未核，不替它们解释成确定事实**。KakaReel 应由同一份金额数据计算卡片、折扣、结账和续费文案。

## 3. Higgsfield：让用户觉得自己在买创作能力

![Higgsfield 年付个人卡片](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/higgsfield-pricing-annual.jpg)

![Higgsfield 月付个人卡片](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/higgsfield-pricing-monthly.jpg)

### 截图里的决策顺序

先看到折扣／Unlimited 横幅，再选择个人与账期；随后是三档主卡片、团队导流、用量推荐、细节矩阵和 FAQ。主卡用黑色背景、明亮的 Plus 区域和 Ultra 的高价值标签建立层次。套餐名下面先解释适用人群，再展示积分和可生成数量，然后才是付款按钮与功能差异。

**它同时在卖两件事：能做什么，以及用得是否更划算。** Starter 锁定初次使用，限制高级模型；Plus 从“试一试”变为日常创作；Ultra 面向更大项目。底档提供价格锚点，中档承接常见需求，高档增加数量、指定模型权益和并发。此为页面机制判断，未取得真实购买占比。

页面最值得学的是“积分旁边立刻给出作品数量的解释”。最需要警惕的也是这里：Plus 的约 80 条 Seedance 2.5，展开说明是 **480p、5 秒**。图片数和视频数是择一使用额度的等价示例，不能相加承诺。KakaReel 曾遇到 Seedance 480p 配置失败，不能把竞品的示例直接搬到自己的产品。

### 为什么高档更有吸引力

同站月付下，每 100 credits 的套餐金额分摊约为 Starter $7.04、Plus $4.92、Ultra 默认 $4.30。Plus 价格是 Starter 的 3.11 倍，积分却是 4.44 倍，还多模型权限；这使升级看起来同时解决数量和能力限制。这不是其真实模型成本，也不含限时权益价值。

Unlimited 和 free generations 单独分组，使正常消耗额度之外的赠送显得突出。但当前卡片是**指定模型的 7 天 Unlimited**，不是所有视频永久免费。年付 Plus 还展示指定 Kling 限时权益，而月付卡并不相同；不能只切价格而沿用另一账期的功能列表。并且 “Unlimited paid parallel generations” 指付费并发，不是无限免费生成。

![Higgsfield 用途与用量估算器](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/higgsfield-pricing-calculator.jpg)

### 估算器比功能清单更值得借鉴

用户选社交视频、口播、广告等用途，然后调视频／图片数量。采样示例是 50 条 Kling 3.0、8 秒、720p，加 60 张 Nano Banana Pro：`50×14+60×2=820` credits，推荐 1,200 的 Plus。它让“我该买多少”变成具体判断，右侧保留推荐卡和按钮。

也存在需要避免的歧义：采样时主卡已切月付，估算器仍独立选年付，推荐 $47 而非 $59。KakaReel 如果增加计算器，账期、模型规格、额度和 CTA 必须共享同一个状态；不能让用户在同页不知不觉换了购买口径。

**KakaReel 采用：**人群说明、明确作品规格、用量估算、一个推荐档。**暂不采用：**四面促销横幅、大量模型赠品、团队导流、没有采购保障的 Unlimited；也不宣称“最受欢迎”，除非已有真实数据。页面事实来源：[Higgsfield Pricing](https://higgsfield.ai/pricing)。

## 4. Runway：把升级理由整理成可比较的生产能力

![Runway 年付首屏](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/runway-pricing-annual.jpg)

![Runway 月付个人套餐](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/runway-pricing-monthly.jpg)

### 截图里的视觉层次

白底、大留白，先给标题与品牌信任信息，再分 Individual／Team & Enterprise／API。四张卡是 Free、Standard、Pro、Max。Free 和 Standard 用细边框按钮；Pro 的黑色条标记 Popular；Max 的紫色边框、浅紫底与按钮标记 Best value。卡片纵向位置略有差异，用强调框吸引视线，而不是堆叠全部活动。

**它把“多数创作者会选”与“单位用量划算”分成两个理由。** Pro 的 Popular 是平台自己的标签，不能作为已核销量；Max 的价值则由大额度、结转和专业输出支撑。KakaReel 初期更适合只强调一个明确推荐档，避免两种标签争抢注意力。

升级并非只有积分：Standard／Pro／Max 分别为 5／15／20 个并行生成，存储 20／100／500GB；高档增加项目、品牌资产、声音克隆、专业输出等工作流能力。个人用户也可能为节省时间和管理作品付费，团队协作不是高客单价的唯一来源。

### Free 的作用与成本边界

免费是一次性 125 credits，不是每月无限试用。它降低首次体验门槛，同时把赠送成本限制在一个用户生命周期内。KakaReel 可以学习“一次小额体验”的结构，但必须先有预算、防重复领取和稳定交付；当前邀请码预览不能直接包装成面向所有人的免费生成权益。

![Runway 每模型用量比较](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/runway-pricing-model-costs.jpg)

### 它最适合直接借鉴的部分

模型比较表把“积分”继续翻译成具体规格。月付下，Gen-4.5 每 5 秒 60 credits，三档分别能生成 10／37／158 个完整任务；Seedance 2.0 Pro 1080p 每 4 秒 160 credits，对应 3／14／59。这说明同一个套餐内，模型不同，数量可以相差数倍。[Runway Pricing](https://runway.com/pricing)

另一个细节需主动纠正：年付表用全年总积分除单次消耗，Standard 显示 125 条 Gen-4.5；但额度逐月发且不结转，如果每次都固定 5 秒、不加购、只做这一模型，则 `12×floor(625/60)=120`，不是 125。Pro 同理为 444，而非全年合并计算的 450。这是根据规则的数学推导，展示为什么 KakaReel 的估算器应按实际到期批次计算。[积分规则](https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work)

当前 Max 不能称为旧 Unlimited 的更名：它是更大额度，**没有旧 Explore Mode**。Pro／Max 的无限 4K upscaling 也不是无限视频生成。[迁移说明](https://help.runwayml.com/hc/en-us/articles/52068047744019-Unlimited-plan-is-switching-to-Max)

**KakaReel 采用：**清晰卡片、具体任务单位、付费后可获得的能力、独立的免费说明。**暂不采用：**尚未实现的品牌套件／存储承诺、旧 Unlimited 文案、借用合作品牌作自身背书。

## 5. Invideo：通过模型权限、编辑价值和年付优惠扩大购买理由

![Invideo 年付一席套餐](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/invideo-pricing-annual.jpg)

![Invideo 月付一席与续费价格](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/invideo-pricing-monthly.jpg)

### 截图说明它卖的不只是生成器

黑底，顶部黄色活动条和大幅模型活动图；Starter 中性灰、Plus 金色、Max 青绿色。大字强调模型图片 Unlimited 30 天、年付 50% OFF，套餐内则按 editor、模型权限、素材与存储分组。价格在积分／产量说明之后，Plus 与 Max 的彩色按钮强化升级选择。

它把编辑器、代理、素材、存储、协作和模型访问组合出售。**对 KakaReel 的价值是解释“用户买完之后能完成什么任务”，不是复制所有功能。** 我们现在没有完整时间线编辑器，不能将其编辑价值包含在自己的价格承诺里。

Starter 明确不含 Seedance 2.5／Seedance 2.0 高阶版本，但提供 Fast／Mini。Plus 获得高级代理和更多模型。与 Higgsfield 相似，这是用模型权限形成升级门槛；相比之下，Runway 入门付费卡更强调全模型与工作流数量。KakaReel 的品牌承诺是 All in One，建议首期让已验证可售模型共用钱包、按成本分别报价，而不是让低档用户付费后才发现无法用主推模型。

![Invideo 单人用量估算器](../../../VibeFriends-Materials/kakareel-2026-10/pricing-20261021/invideo-pricing-calculator.jpg)

### 单人用户必须特别注意的两个问题

第一，卡片标 per seat；上方选一席，不代表下面计算器也选一席。它默认三席，调为一席后才显示 $120 upfront 而非 $360。KakaReel 本次只做个人，不需要席位、guest seats、workspace 下拉框。

第二，编辑时长与生成积分分开：采样中 8 条视频×30，加 60 张图×2.5，共 390 credits；40 小时编辑不另消耗生成额度。这解释了“额度有限但产品仍持续有价值”。KakaReel 可以学习生成之外的历史查看、下载和复用提示词体验，但不能在未确认存储保留成本前承诺永久保存。

页面也有数值需要审慎：Starter 卡写约 15 条 Fast 视频，但估算器按约 30 credits／条，400 credits 只能做 13 条这一配置。未取得足够规格解释，不判定为相同条件；KakaReel 应确保卡片与计算器引用同一规格和计价表。Invideo 的年付比较矩阵仍显示 2,000/56≈35 条等**月额度**换算，不能因为选了年付就将表里条数当全年。[Invideo Pricing](https://invideo.io/pricing/)

**KakaReel 采用：**一席真实总价、续费价清楚分列、用途到用量的推荐、功能分组。**暂不采用：**大量赠送席位、50% 常年促销、复杂自动追加购买与未经核实的限时赠品。

## 6. 售后规则才是定价策略的另一半

以下是官方公开规则转述，不是退款实测，也不是 KakaReel 已承诺的政策。

| 问题 | Higgsfield | Runway | Invideo |
|---|---|---|---|
| 订阅额度结转 | 不结转；年付也分期刷新 | Standard／Pro 不结转，Max 可结转一个月 | 不结转；年付也按月刷新 |
| 额外购买 | 有效订阅才能买包，包 90 天；不自动解锁模型 | 付费用户最低买 1,000，购买额度不失效 | 普通 top-up 与 Extra Credits 不是同一机制，不能合并期限 |
| 取消 | 关闭续费，当期继续；到期后模型权限可能收窄 | 当期继续；加购留下，可用功能仍依当前档位 | 当期继续；剩余权益依类型及订阅有效状态处理 |
| 技术失败 | 通常返积分，Grok 开始生成收费是明确例外 | generation error 返；不满意不等于技术失败 | 未取得覆盖当前全部模型的统一失败返额规则 |
| Unlimited | 指定模型、规格、入口、期限与队列限制 | 当前新售 Max 无 Explore；upscale 无限不等于视频无限 | 本轮为年付特定图片模型 30 天活动，非无限视频 |

规则来源：Higgsfield 的[积分](https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work)、[加购](https://higgsfield.ai/creator-hub/help-center/credits/how-credit-packs-work)、[取消](https://higgsfield.ai/creator-hub/help-center/refunds/how-do-i-cancel-my-subscription)、[失败](https://higgsfield.ai/creator-hub/help-center/troubleshooting/generation-is-stuck-or-failed)、[Unlimited](https://higgsfield.ai/creator-hub/help-center/credits/what-are-unlimited-models-and-which-plans-include-them)；Runway 的[积分](https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work)、[订阅管理](https://help.runwayml.com/hc/en-us/articles/50205612565779-Managing-your-subscription)、[失败返还](https://help.runwayml.com/hc/en-us/articles/34266159290003-Can-I-have-credits-refunded)；Invideo 的[积分](https://invideo.io/help/billing/how-do-credits-work/)、[Extra Credits](https://invideo.io/help/billing/extra-credits/)、[订阅](https://invideo.io/help/billing/subscriptions-and-refunds/)。

### 需要向 KakaReel 用户说清楚的政策

**取消、现金退款、技术失败返积分是三件事。** Higgsfield 的首购退款一般要求七天内且未用积分；Runway 对 30 天内未用／几乎未用提供酌情处理，并非无条件保证。Invideo 新帮助写按比例／使用量退款，现行 2026-07-08 条款却不按未用订阅期比例退，通常要求首次购买／续费七天内未使用。这里存在官方内容冲突，不能把最宽松版本当确定权益。[Higgsfield 退款](https://higgsfield.ai/creator-hub/help-center/refunds/how-do-i-request-a-refund)、[Runway 退款](https://help.runwayml.com/hc/en-us/articles/24343363554067-Requesting-a-refund-for-your-plan-or-payment)、[Invideo 帮助](https://invideo.io/help/billing/subscriptions-and-refunds/)、[Invideo 条款 §3(d)](https://invideo.io/terms-and-conditions/)

Invideo 普通 top-up 帮助写随账期重置；另一个 Extra Credits 专页写购入起 12 个月、仍需有效订阅。其关闭“额度消耗”不等于关闭 auto-reload，购买可能继续。KakaReel 首期建议余额不足就停，不做自动充值；以后真要做，消费开关、购买开关和金额上限必须分开。[Extra Credits](https://invideo.io/help/billing/extra-credits/)

**成熟产品也会有信息不一致。** 真正值得学的是让用户能理解成本与选择，而不是照抄它们每个促销数字和复杂规则。

## 7. KakaReel 首期怎样定个人套餐

### 推荐路径：先一次性购买，再用复购验证月订阅

**同日后续决定：**江昪已确认该路线，并选择 Waffo Pancake 为首渠道。VibeToken 六模型详情及生成失败费用已追加核查；最新建议收敛为 $19／150 credits（尚未启售），单位歧义、情景测算及待核条件以[成本研究 §11](2026-10-21-video-pricing.md#11-vibetoken-成本复核失败损耗与首包建议2026-10-21)为准。下方 $9／$19 是这份截图报告形成时的候选历史，不再作为最新的双候选建议。

当前目标是从零取得真实用户和首 $100，尚没有稳定的使用频率、逐规格成本和复购证据。一次性包减少自动续费、取消、月结转和订阅升级的实现负担，也降低新品牌要求用户承诺一年的信任门槛。

建议首期只开一个 **Starter Pack**，帮助个人完成第一次可验证的视频任务，不为了像大站硬凑三档。沿用旧报告的 **$9 或 $19 一次性**两个价格候选；这是同一个 SKU 的备选价格，不是两档已定套餐。最终选一个价格版本，明确包含积分、可用规格、有效期与退款规则。已有真实复购后，再评估是否增加 Creator Pack。

这些数字是实验候选，不是从竞品得出的最优价格。所有积分数量暂不填写；不能先随意填 1,000 credits，再反过来猜供应商成本。也不要因为 $9／$19 低于竞品月费，就声称 KakaReel 更便宜：一次性包和一整月订阅内容不同。

积分包原则上共用所有**已验证可售**的视频模型，明确每模型、每规格消耗。首期先保守统一并发；只有上游能力和预算锁都验证后，再把更高并发作为权益。基本登录、历史归属、清楚的价格和故障处理不应该做高级档专属。

### 未来若改做月订阅：另行批准后才评估的路径

可以从 Starter **$15/月**、Creator **$29/月**、Pro **$59/月**做成本和用户访谈测算。推荐中档服务每周持续发布的个人；高档只在额度、真实可交付并发、优先处理等差异足够时保留。该梯度是策略假设，不是已验证价格；若能力不足以支撑三档，应删掉一档。

建议先只月付，不推出年付或 Unlimited。具备真实复购、成本稳定、退款储备和订阅生命周期验收之后，再考虑年付折扣；不能直接照搬 50%。**一次性包与三档月订阅不要同时塞进首版主卡片**，选一个主购买方式；额外购买可在已登录余额页提供。

首期一次性、不做订阅的决定继续有效；仍待负责人定案的是具体包价、额度和使用期限。未来改为订阅需另行批准，研究本身不重新打开既有决定，也不自动启用续费或收款。

## 8. 先算成本，再填积分和“约多少条”

逐规格成本表至少记录精确 model ID、输入方式、时长、分辨率、声音、参考视频输入量、最低收费、失败收费、供应商返还、币种和报价日期。技术成功率与用户满意率分开；用户换提示词重新生成通常是新任务，本站技术故障造成的免费重做则是本站成本。

设包售价为 `P`（不含代收税）、积分数 `Q`，规格 i 扣 `q_i` 积分，对每个最终向用户收费任务分摊后的实际生成成本为 `c_i`。可先用：

`模型成本压力估计 = Q × max(c_i / q_i)`

再扣支付费、存储传输、退款／拒付准备、汇兑与提现分摊，判断包贡献是否足够。这是允许组合下的保守期望估计，不是损失硬上限；失败率上涨、供应商涨价、重复任务仍需要单独压力测试和金额预算。不要靠用户积分过期、没用完才能盈利。

面向用户的条数应采用 `floor(Q / 每次积分)`，绑定明确规格；跨月到期额度不能先合并再取整。最终成片可能需要多个不同尝试，不能把“生成任务数”写成“保证满意作品数”。

真实 VibeToken 视频规格报价和完整损耗数据仍是缺口。本轮没有额外付费生成，不能给出可靠的包内积分，也不能宣称 60% 或其他利润率已实现。支付渠道费与现有账本边界沿用[原成本／后端研究](2026-10-21-video-pricing.md)和[支付接入报告](2026-10-21-payment-integration.md)，不要把对手的积分单价当我们的采购成本。

## 9. 可以直接交给页面与后端实施的清单

**以下是通过逐规格成本、许可、支付准入与交付／退款验收后的开售版本要求。当前线上仍保持 Preview＋Credit packs planned、购买禁用；研究和文案草案不得直接启售。**

### 页面从上到下

1. **一句话价值：**“AI video credits for your next idea.” 下方说明多模型共用额度、生成前可看本次价格。具体模型只列实际可用者。
2. **个人购买卡：**名称、任务人群、总价与币种、一次性或续费、额度、有效期、一个固定规格示例、CTA。同屏可读，不把关键限制藏到 tooltip。
3. **轻量用量估算：**模型＋秒数＋分辨率，显示每次积分与该包能完成的任务数。初期不必复制复杂场景问卷。
4. **比较表：**可用模型、并发、输出规格、下载／水印、保留期限。未实现的不列入售卖权益。
5. **信任说明：**Google 账号归属、订单与余额入口、技术失败处理、真实联系入口；开源代码链接可证明透明度，但不能替代履约证据。
6. **FAQ：**积分怎么算、到期、用完怎么办、失败是否扣、输出不满意怎么办、现金退款、商用许可、付款后如何获得额度。

可以保留的英文草案：CTA “Get Starter credits”；购买方式 “One-time payment. No subscription.”；估算说明 “Estimates use the model and settings shown.”。**购买方式虽已确定，仍须完成上述开售验收后才能把购买 CTA 和具体权益上线。** 不使用未经证实的 Most popular、不伪造划线原价、不写尚未验证的成功率与即时退款。

### 后端和售前承诺必须对应

| 定价决定 | 最小实现要求 |
|---|---|
| 一次性包／积分 | SKU 版本、整数金额与积分、订单快照、支付验签和幂等入账 |
| 每模型不同消耗 | 服务端 quote，参数／成本版本绑定；不能相信浏览器金额 |
| 生成失败返积分 | reserve → capture／release；未知任务保留核查，避免重单 |
| 积分到期 | 每笔购买批次、消费顺序、明确到期日与退款定位 |
| 并发升级 | 服务端并发额度与最大上游金额预留，防多请求穿透 |
| 月订阅（若选） | 续费成功发放、失败宽限、取消、升级降级、额度到期与对账 |
| 现金退款 | 现金事件与积分冲销分别记账；并发生成不能继续花已退款额度 |

现有 billing foundation 只代表部分准备就绪；真实渠道、生成扣费与完整退款链路仍须按[后端状态正本](../billing-backend.md)实施验收。本轮没有将调研建议写成已上线能力。

### 首 $100 应验证什么

记录每个购买者的来源、选包原因、首次成功交付、实际模型消耗、支持／退款和是否复购。产品事件至少覆盖 pricing viewed、package selected、checkout started、payment confirmed、first result delivered、repeat purchase；支付事件以服务端为准。

六笔 $19 为 $114，十二笔 $9 为 $108，是未扣退款和成本的销售额示例，不是净利润或提现到账。早期样本小，先访谈真实买家并复盘每笔履约，不急着把几次点击称为统计显著的 A/B 测试。首次价格版本与额度应保存，后续调整不得静默改变已购权益。

## 10. 证据清单与未核边界

| 截图文件 | 记录内容 |
|---|---|
| higgsfield-pricing-annual.jpg | Individual 默认年付卡片 |
| higgsfield-pricing-monthly.jpg | 同页切月付 |
| higgsfield-pricing-calculator.jpg | 用途、视频／图片数量及推荐，保留 Cookie 浮层 |
| runway-pricing-annual.jpg | 默认 Individual 年付与页面层级 |
| runway-pricing-monthly.jpg | 月付四卡、并发和功能差异 |
| runway-pricing-model-costs.jpg | 月付、具体模型与完整任务数 |
| invideo-pricing-annual.jpg | 一席年付卡片与活动横幅 |
| invideo-pricing-monthly.jpg | 一席月付、Max 首期与续费 |
| invideo-pricing-calculator.jpg | 手动改为一席后的额度、用量和年度总价 |

同目录保留各站月／年 DOM 采样文本作为可检索证据；截图只显示某个时刻和视口，不等于完成移动端购买流程或 checkout 测试。高档选项的价格来自实际点击后的 DOM，未逐个留截图。

未核：各站登录后额外优惠、真实税后结账和年付续费活动、所有模型的完整活动限制、付费生成体验、实际转化与盈利、KakaReel 的逐规格供应成本。它们都不妨碍学习页面结构，但会影响最终售价、额度和可承诺权益。

本报告更新了此前报告中未读取到 Higgsfield 动态价格的缺口；**本轮三站当前个人价格以本报告为准**，旧博客 $15／$49、旧额度不再作为现价。其余更广泛竞品、支付和成本背景继续查[原研究](2026-10-21-video-pricing.md)。
