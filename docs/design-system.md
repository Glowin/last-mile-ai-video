---
title: "KakaReel 设计规范（Botanical Editorial Studio v1.0）"
date: 2026-10-26
source: "江昪 2026-10-26 审定实施计划；基于首版奶油色／苔绿／深森林绿品牌基调扩展"
status: "现行正本"
scope: "kakareel.com 全站视觉令牌（Design Tokens）、三级字体排印、空间与圆角阶梯、核心组件规范及响应式无障碍要求"
---

# KakaReel 设计规范（Botanical Editorial Studio）

本规范定义 **KakaReel**（`kakareel.com`）的视觉设计与前端样式体系。品牌定位为 **Independent Editorial AI Video Studio（独立杂志感 AI 视频创作室）**，在延续首版「奶油色、苔绿与深森林绿」自然色盘（见 [brand.md](brand.md)）的基础上，融合**独立出版物（Editorial Magazine）的排版秩序**与**专业摄影棚取景器（Studio Viewfinder）的精密控件质感**。

## 1. 核心设计原则

1. **Botanical Warmth（植物志温润感）**：摒弃高饱和霓虹与冰冷纯黑背景，以温暖奶油纸色（`--bg: #f7f8f3`）承载长时阅读与创作，用深森林墨色（`--ink: #202820`）保证高对比度可读性，所有投影均带有低饱和森林色温（`rgba(21, 42, 35, ...)`）。
2. **Editorial Precision（杂志级排版精度）**：通过「衬线斜体点睛（Editorial Serif）＋现代无衬线正文（Geometric Sans）＋技术参数等宽体（Technical Mono）」的三级字体分工建立清晰的信息层级；消除低于 `11px` 的不可读微字号。
3. **Tactile Studio Controls（摄影棚级实体控件感）**：工作台参数面板采用编号分区（`01 MODEL`、`02 PROMPT`、`03 OUTPUT`），预览区采用光学取景框角标（Viewfinder Corner Brackets）与胶片边码（Film Gate Marks），让每一次生成都具备导演监视器般的仪式感。
4. **Honest State Disclosure（诚实透明的状态与计费披露）**：预览模式（Invite Preview）、沙盒测试（Test Mode）、积分报价有效期与退费规则均通过语义化状态色块与等宽数字清晰呈现，绝不用模糊视觉弱化计费与限制说明。

---

## 2. 色彩系统（Semantic Color Tokens）

全站样式统一引用 `:root` 语义变量（定义于 `src/app/globals.css`），禁止在业务组件或 CSS Module 中散落硬编码十六进制色值。

### 2.1 背景与表面（Surfaces & Elevation）

| Token | 色值 | 语义与适用场景 |
|---|---|---|
| `--bg` | `#f7f8f3` | 全站默认温暖奶油纸底色（Page Canvas） |
| `--bg-subtle` | `#f1f4ea` | 工作台背景、表单输入框静态底色、表格行悬停底色 |
| `--bg-tinted` | `#eaf0df` | 植物浅苔绿强调区块底色（首页 Steps、定价页 Explainer、费率表头、Preview Tag） |
| `--bg-sidebar` | `#eef1e6` | Studio 左侧导航栏与Segmented Control 轨道底色 |
| `--bg-active` | `#dfead0` | 侧边栏导航激活态、次要按钮悬停态、标签计数底色 |
| `--panel` | `#ffffff` | 卡片、控制面板、浮动登录框等纯白抬升表面（Elevated Surface） |
| `--dark` | `#152a23` | 深森林暗部舞台基调（Hero 画幅暗部、视频播放器背景） |

### 2.2 文本与墨色（Typography Ink）

| Token | 色值 | 语义与适用场景 |
|---|---|---|
| `--ink` | `#202820` | 一级标题、核心正文、主按钮背景与高对比度文本 |
| `--ink-secondary` | `#3d4a3a` | 二级小标题、表格表头、强调说明文字 |
| `--muted` | `#5e6858` | 次要正文、卡片摘要、FAQ 正文、字段说明（满足 WCAG AA 对比度） |
| `--subtle` | `#76816f` | 索引编号（`01`～`03`）、时间戳、面包屑分隔、输入框占位符 |

### 2.3 品牌点缀与交互强调（Brand & Accents）

| Token | 色值 | 语义与适用场景 |
|---|---|---|
| `--accent` | `#d5f47b` | 核心创作主行动色（Studio `.generate-button` 背景） |
| `--accent-hover` | `#c4e664` | `.generate-button` 悬停态背景 |
| `--accent-border` | `#b8dc58` | `.generate-button` 边框色，增强浅色背景下的边界清晰度 |
| `--moss` | `#597937` | 植物苔绿品牌点缀色（Logo 句点、Eyebrow 圆点、Tab 激活下划线、列表勾选图标） |
| `--moss-strong` | `#374731` | 主按钮悬停背景、标题中 `<em>` 衬线斜体强调色 |
| `--focus-ring` | `#597937` | 全站统一键盘无障碍焦点环（`3px solid var(--focus-ring)`，`offset 3px~4px`） |

### 2.4 边框与状态反馈（Borders & Semantic Status）

| Token | 色值 | 语义与适用场景 |
|---|---|---|
| `--line` | `#dfe3d8` | 默认卡片、顶栏、底栏与行分割线 |
| `--line-strong` | `#c5d0b5` | 强调卡片（Starter Pack）、图片上传虚线框、卡片悬停态边框 |
| `--line-subtle` | `#e9ece2` | 面板内部弱分割线、表格内部细线 |
| `--status-success` / `--status-success-bg` | `#4d7a28` / `#eef5e4` | 生成成功（Ready）、订单已支付状态指示 |
| `--status-warning` / `--status-warning-bg` / `--status-warning-border` | `#645225` / `#fff8e5` / `#d8c68d` | 沙盒测试提示（`.testNotice`）、排队生成中状态点（`#b8943c`） |
| `--status-danger` / `--status-danger-bg` / `--status-danger-border` | `#974b31` / `#fff0e9` / `#f2d6c5` | 错误横幅（`.error-message`）、生成失败状态指示 |

---

## 3. 字体排印系统（Typography Scale）

为确保 Docker 离线构建（`output: "standalone"`）零外部网络依赖且跨平台渲染优雅，采用三级系统增强字体栈：

### 3.1 字体族分工

- **UI 与正文无衬线体（`--font-sans`）**：
  `"KakaReel Inter", "Plus Jakarta Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`（主字体 `"KakaReel Inter"` 由 `/fonts/inter-variable.woff2` 自托管加载，零外部请求）
  用于全局正文、按钮、导航、表单标签与卡片标题。
- **编辑部展示衬线体（`--font-serif`）**：
  `"Instrument Serif", "Newsreader", "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`
  专用于 `h1 em`、`h2 em` 倾斜点睛词及侧边栏品牌引言（`.side-bottom p`），营造杂志刊头气质。
- **摄影棚技术等宽体（`--font-mono`）**：
  `"JetBrains Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, "Liberation Mono", monospace`
  专用于序号（`01`、`02`、`03`）、字数统计（`120/500`）、模型规格角标（`720p · 5s`）、积分数值、订单号与取景器边码，统一开启 `font-variant-numeric: tabular-nums`。

### 3.2 模块化字号阶梯

| 级别 | Token / 选择器 | 桌面端尺寸 | 移动端尺寸（`<=650px`） | 字距（Letter Spacing） | 行高 |
|---|---|---|---|---|---|
| **Display XL** | `h1`（首页／模型页） | `clamp(3.25rem, 5.5vw, 4.75rem)` (`52px–76px`) | `clamp(2.5rem, 9vw, 3.25rem)` | `-0.04em` | `1.04` |
| **Display LG** | `.closing h2` / `.prose h1` / Pricing `h1` | `clamp(2.25rem, 4.5vw, 3.625rem)` (`36px–58px`) | `clamp(2rem, 7.5vw, 2.625rem)` | `-0.035em` | `1.08` |
| **Heading 2** | `h2`（章节主标题） | `clamp(1.75rem, 3vw, 2.5rem)` (`28px–40px`) | `1.875rem` (`30px`) | `-0.025em` | `1.15` |
| **Studio H1** | `.studio-title h1` | `2.0625rem` (`33px`) | `1.75rem` (`28px`) | `-0.025em` | `1.15` |
| **Heading 3** | `h3`（卡片／步骤标题） | `1.375rem–1.625rem` (`22px–26px`) | `1.25rem–1.375rem` | `-0.018em` | `1.25` |
| **Lead** | `.hero-copy > p` / `.lead` | `1.0625rem` (`17px`) | `0.9375rem` (`15px`) | `-0.005em` | `1.62` |
| **Body** | 正文段落 `.prose p` / FAQ 标题 | `0.9375rem–1rem` (`15px–16px`) | `0.9375rem` (`15px`) | `0` | `1.68` |
| **UI / Small** | 卡片正文、按钮、表格、控制面板 | `0.84375rem–0.90625rem` (`13.5px–14.5px`) | `13.5px–14.5px`（输入框 `16px`） | `0` | `1.55` |
| **Micro / Helper** | `.micro` 辅助条款、提示词计数 `.prompt-helper`、上传与底部提示 | `0.78125rem–0.84375rem` (`12.5px–13.5px`) | `12px–13px` | `0` | `1.6` |
| **Eyebrow / Code** | `.eyebrow` / `.preview-tag` / 边码 | `0.75rem` (`12px`) | `0.6875rem–0.75rem` (`11px–12px`) | `0.12em–0.14em`（大写） | `1.5` |

> **字号可读性底线（江昪 2026-10-26 审阅定案）**：桌面端严禁对提示、辅助说明或表单标签使用 `10px–11px` 小字号；提示词辅助栏（`.prompt-helper`）、创作贴士（`.studio-tip p`）、扣费与审核说明（`.controls-panel .centered`）、定价补充说明（`.small`）及 18+ 年龄确认说明统一保持在 **`12.5px–13.5px`**，表单字段名与控件正文保持在 **`13.5px–14.5px`**，眉题与技术角标底线为 **`12px`**。

---

## 4. 空间尺度、圆角与阴影（Spacing, Radii & Elevation）

### 4.1 容器与布局网格

- **营销与内容页容器（`.shell`）**：最大宽度 `--page-max-width: 1264px`，左右内边距桌面端 `--page-gutter: 40px`、移动端 `22px`。
- **长文阅读容器（`.prose`）**：最大宽度 `820px`，正文段落最大行宽控制在 `68ch` 以内。
- **创作工作台容器（`.studio-content`）**：最大宽度 `1550px`，双栏网格 `minmax(320px, 390px) minmax(0, 1fr)`（超大屏 `>=1500px` 左栏 `410px`），兼顾参数操作密度与右侧视频画布尺度。

### 4.2 圆角阶梯（Border Radii）

- `--radius-xs: 4px`：小标签、行内数字徽章、取景器微标签
- `--radius-sm: 6px`：表单输入框、下拉框、Segmented Control 按钮、侧边栏导航项
- `--radius-md: 8px`：主次按钮（`.button`）、错误／测试提示框、历史记录条目
- `--radius-lg: 12px`：工作台控制面板（`.controls-panel`）、视频预览舞台（`.video-stage`）、模型卡片（`.model-card`）、费率表外框
- `--radius-xl: 16px`：首页 Hero 主画框（`.hero-art`）、定价大卡（`.card`）、Explainer 区块、浮动登录卡

### 4.3 森林色温阴影（Tinted Shadows）

- `--shadow-xs`: `0 1px 3px rgba(21, 42, 35, 0.06)`（Segmented Tab 选中态）
- `--shadow-sm`: `0 6px 20px -4px rgba(21, 42, 35, 0.06), 0 2px 6px -1px rgba(21, 42, 35, 0.04)`（静态抬升卡片）
- `--shadow-md`: `0 16px 36px -8px rgba(21, 42, 35, 0.10), 0 4px 12px -2px rgba(21, 42, 35, 0.05)`（卡片悬停抬升、浮动提示卡）
- `--shadow-lg`: `0 24px 64px -12px rgba(21, 42, 35, 0.16)`（Hero 主视觉画幅、全局浮层）

---

## 5. 核心组件规范（Component Standards）

1. **按钮体系（Buttons）**：
   - **Primary（`.button` / `.primaryButton`）**：深森林墨底 `var(--ink)`＋纯白字，圆角 `var(--radius-md)`，悬停态 `var(--moss-strong)` 并微抬升 `translateY(-1px)`。
   - **Accent Generate（`.generate-button`）**：嫩苔绿底 `var(--accent)`＋深墨字 `var(--ink)`＋细边框 `var(--accent-border)`，专用于工作台主生成动作。
   - **Secondary（`.button.secondary` / `.secondaryButton`）**：透明底＋细边框 `var(--line-strong)`，悬停态 `var(--bg-active)`。
   - **Small（`.button.small`）**：紧凑内边距，顶栏与侧栏内保持最小触控高度 `44px`（或视觉紧凑但具备充足点击热区）。
2. **取景框与杂志眉题（Eyebrow & Viewfinder Marks）**：
   - `.eyebrow` 统一采用 `12px` 大写、字距 `0.14em`；带 `<i />` 时前置 `6px` 苔绿圆点（`var(--moss)`）。
   - `.art-frame` 与 `.preview-corners` 四角采用 `1px` 光学取景折线，配合等宽字体边码，强化摄影棚监视器语言。
3. **编号表单控件（Indexed Studio Controls）**：
   - `.field-label` 左侧为 `13.5px` 加粗字段名，右侧 `<span>` 为 `12px` `--font-mono` 编号（`01`、`02`、`03`）；底部 `.prompt-helper` 与参数标签统一采用 `12.5px–13.5px` 确保辅助说明清晰易读。
   - 输入框、下拉框与文本域在静态下采用柔和底色或纯白底色＋`var(--line)` 边框，悬停时边框加深为 `var(--line-strong)`，聚焦时呈现 `3px solid var(--focus-ring)`。
4. **数据表与订单台账（Tables & Receipt Ledgers）**：
   - 费率表（`.rates table`）与订单明细（`.orderDetails`）中的金额、积分、时长、订单编号统一启用 `tabular-nums`，确保纵向数字列严格对齐。

---

## 6. 响应式与无障碍硬约束（Accessibility & Responsiveness）

- **断点体系**：`1500px`（宽屏工作台扩展）、`1150px`（紧凑桌面端）、`960px/900px`（平板单列 Hero 与顶部横向工作台导航）、`760px/650px`（移动端单列卡片与防缩放 `16px` 表单字号）、`480px`（超小屏表格与账单明细折叠）。
- **键盘与焦点可见性**：全站所有可交互元素（`button`、`a`、`input`、`select`、`textarea`、`summary`、`[tabindex="0"]`）必须具备清晰的 `:focus-visible` 轮廓。
- **减弱动态效果**：在 `@media (prefers-reduced-motion: reduce)` 下关闭平滑滚动与所有 CSS 动画／过渡。
