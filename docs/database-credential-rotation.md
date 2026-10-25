---
title: "PostgreSQL 数据库凭证轮换操作与验收"
date: 2026-10-26
source: "旧应用源码与 a3b05be 文档差异；2026-10-25 Dokploy 页面；2026-10-26 复核 v0.29.4 源码；PostgreSQL 16／Docker 官方文档；隔离演练；用户 2026-10-26 最新决定"
status: "用户决定本次不轮换；取消轮换维护窗口等待，不作为本次上线前置；生产未轮换"
---

# 当前决定（2026-10-26）

用户根据现有信息明确决定本次不改数据库密码。此前等待维护窗口及用户密码输入的安排取消，数据库密码轮换不再作为本次上线或 0006–0009 升级的前置。此决定不代表密码已轮换、旧凭证已失效或风险已消除。

下文保留此前只读预检、隔离演练、平台源码结论及未执行的轮换方案。观测结果仅对应其记录时点，隔离演练和源码推导不等于生产变更。所有轮换步骤、窗口及验收要求仅供未来另行决定轮换时重新核准使用，不构成本次待办；升级本身仍按[独立升级切换](deployment.md#cost-moderation-cutover)执行。

# 范围与发布边界

本手册保留的备选方案仅针对本项目现有 PostgreSQL 16 登录角色的密码轮换，保留角色、权限、数据库、数据卷和应用版本。工作树 `30777d3` 的 `compose.yaml`、`docs/deployment.md`、`src/server/db.ts` 已核读；另只读比对了 `b197051` 的 Compose 和连接池实现。2026-10-25 22:52 的 Dokploy 只读页面显示最近成功部署记录为 `a3b05be`；本地 Git 比对确认它相对 `b197051` 仅修改三份文档。随后通过现有 Web 容器的真实运行时连接，只读核得 PostgreSQL `160015`、五项迁移名称及 SHA-256 全部与源码一致；容器架构为 x64。经江昪明确批准限定字段读取，已取得 Web／worker／db 的不可变镜像 ID，并从挂载页核得既有数据卷与目标目录。实际值保存在库外受限记录，未输出或保存环境变量。江昪登录 Hostinger 后，通过既有 VPS 网页终端仅提取限定字段，已核三个容器相同的 Compose 项目标签、各服务标签、工作目录及配置文件路径。PR3 成本／审核迁移 0006–0009 尚未发布。

本轮页面确认平台版本 v0.29.4、Git main 自动部署开启。容器菜单只有 Restart／Start／Stop 等生命周期动作，没有已验证的固定镜像重建入口。该版本官方源码的 [rebuildCompose](https://github.com/Dokploy/dokploy/blob/v0.29.4/packages/server/src/services/compose.ts) 调用 [getBuildComposeCommand](https://github.com/Dokploy/dokploy/blob/v0.29.4/packages/server/src/utils/builders/compose.ts)，默认包含 `up -d --build --remove-orphans`。因此不把界面 Reload 当成仅重启，也不把 Restart 当成重新载入环境。本轮未点击这些动作、停服务或保存配置。后续已核主机镜像、部署定义及只读配置合并；保存新环境后的实际注入仍是切换验收项，不能用只读检查替代。

23:29 前的接续检查确认平台有 Patches 文件覆盖与 Advanced 自定义 Command；当前补丁为空、自定义命令为空。下面的固定镜像组合已通过本机 Compose 演练，但没有保存到 Dokploy，也没有在生产执行。平台主机终端两次均在 SSH 握手阶段超时；本机既有、严格核主机指纹的 SSH 登录可用，但账号无 Docker socket 权限，`sudo -n` 明确要求密码。没有新增权限、修改 SSH 设置或尝试密码。江昪随后完成 Hostinger 登录，既有 VPS 网页终端已可用。没有新增管理员权限；网站仍未停止。

## 已演练的固定镜像重建方式

仅在窗口前提全部满足后，将每个原镜像的完整本机 `sha256:` ID 放入**平台私有覆盖文件**；不可把真实 ID、项目标识或配置写进开源仓库。下列为占位结构：

```yaml
services:
  web:
    image: sha256:REPLACE_WITH_VERIFIED_ORIGINAL_WEB_IMAGE_ID
  worker:
    image: sha256:REPLACE_WITH_VERIFIED_ORIGINAL_WORKER_IMAGE_ID
```

自定义 Docker 子命令须保留原项目、原 Compose 路径及覆盖文件顺序，显式只重建两个应用服务：

```text
compose -p VERIFIED_PROJECT -f ORIGINAL_COMPOSE_PATH -f PRIVATE_PIN_FILE up -d --no-build --pull never --no-deps --force-recreate web worker
```

本机 Docker Compose `v2.34.0-desktop.1` 实测两次命令均退出 0：使用故意不存在的 build context、已有镜像 ID、无网络／端口的 idle Node 进程；第二次两个容器 ID 都改变，镜像 ID 不变，完整环境差异只有合成 MARKER 从 old 变 new；声明的第三个依赖未启动。临时容器已清理，原镜像保留。该本机演练不覆盖 Dokploy 补丁应用／环境注入、数据库连接、迁移或真实入口行为。生产主机另核 Compose `2.39.1`，只读渲染 stdin 覆盖后的配置，确认唯一变化是 Web／worker 的 image 字段，两个原镜像均在本地；没有运行 up 或保存覆盖文件。`--no-deps` 不会阻止所选服务自身执行启动迁移；生产必须使用已核的原镜像，不能换成新分支镜像。实际重建命令、平台环境保存后的注入结果和密码变更后的正反 TCP 认证仍须在维护窗口逐项验收。

### 平台环境生效路径（2026-10-26 源码核查）

已核官方 v0.29.4 对应提交 `b109e0ebc4a4b5e5d22571f13c63328e4c423886`。以下是代码调用链证据，尚未在生产保存或执行；适用现有 Git 来源、docker-compose 类型的服务。

- Environment **Save 只更新平台数据库**，不写部署目录 `.env`，也不重建容器。依据：[saveEnvironment](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/apps/dokploy/server/api/routers/compose.ts#L206-L230)。
- General **Reload** 调用 `rebuildCompose`，先应用已启用的 Patch，再由 builder 改写 Compose、生成 `.env`，最后执行 Docker 命令。Reload 的这条调用链不拉取 Git；Advanced 中非空的 Command 替换默认子命令，不追加默认 `--build`。依据：[rebuildCompose](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/packages/server/src/services/compose.ts#L338-L390)、[builder 与命令选择](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/packages/server/src/utils/builders/compose.ts#L18-L96)。不能因此将默认 Reload 当作安全重启，或忽略平台对域名标签、网络和随机化配置的处理。
- Patch 路径相对本服务部署的 `code/`；生成的 `.env` 位于平台原 Compose 路径的同目录，custom command 的工作目录则为 `code/`。上面的原 Compose 必须作为第一个 `-f`，覆盖文件作为第二个，并核变量插值实际读取同一份新环境。平台并不直接 export 整套服务环境到 docker-compose 子进程。依据：[环境文件路径](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/packages/server/src/utils/builders/compose.ts#L99-L144)、[Patch 落地](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/packages/server/src/services/patch.ts#L145-L174)。不要用 Patch 保存新密码或覆盖 `.env`；新密码仍由用户保存到平台环境设置。
- **禁用或删除 Patch 记录不会删除已经写到主机的覆盖文件**。只有执行删除类型的 Patch 才会删文件，而 Reload 仍会继续执行 Docker 命令。维护收尾须分别核自定义命令、Patch 记录和实际覆盖文件；不能清空 Command 后再 Reload 来“清理”，那会回到默认构建。依据：[Patch 记录删除](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/packages/server/src/services/patch.ts#L83-L107)及上述 Patch 落地源码。创建 Patch 的编辑器另会克隆独立的 patch 仓库，这不等同于 Reload 拉取部署代码，见 [patch-repo](https://github.com/Dokploy/dokploy/blob/b109e0ebc4a4b5e5d22571f13c63328e4c423886/packages/server/src/services/patch-repo.ts#L22-L70)。

因此维护时可采用已演练命令：先核并暂停本项目自动部署，准备仅含原镜像 ID 的私有覆盖文件及固定命令；用户完成角色密码和两项平台环境更新后，沿上述 Reload 路径加载配置。恢复仍须核实际容器的新环境、原镜像、原五项迁移与正反 TCP 认证，不能以源码推导或保存提示替代。若未来实际配置了这些覆盖项，后续升级前必须协调移除固定旧镜像的命令及覆盖记录／文件，否则可能继续运行旧版；清理应纳入独立升级步骤，不为清理另触发未审阅的部署。

生产轮换与[0006–0009 升级切换](deployment.md#cost-moderation-cutover)是独立变更。此前「先轮换、再升级」的安排已由 2026-10-26 用户决定取消，本次升级不等待轮换。若未来重新决定轮换，须依据届时实际版本和迁移状态重新制定方案；不能在密码故障中顺手部署 main、运行当前 checkout 的迁移器或启动新账单进程。`scripts/start.mjs` 启动应用前会自动迁移；把新镜像当作“重启”会改变恢复边界。

| 对象 | 原轮换方案处理范围（本次不执行） |
|---|---|
| `db` | `db/Dockerfile` 基于 `postgres:16-alpine`；既有 `video-db` 挂载 `/var/lib/postgresql/data`。逻辑卷名不是宿主机实际卷名，必须核实际挂载与项目归属 |
| `web`、generation `worker` | `b197051` 已有两个服务，共用 `DATABASE_URL`。轮换后均须以原镜像、新运行时环境重建进程和连接池 |
| 将来的 `billing-reconciliation` | 当前准备代码使用同一个 `DATABASE_URL`，未来部署后须纳入同一轮换窗口；本次不启动它，不部署其迁移。未部署应记 N/A，不能记“验收通过” |
| 官方支付沙盒及其他项目 | 独立边界，不读写其凭证、数据库、卷、容器或浏览器；主会话的移动收银台验收与本任务无关 |

本文只包含变量名和通用占位符；实际容器 ID、网络、镜像摘要、卷名、角色、连接串、备份位置均由执行者在受限的库外记录中映射。不给数据库新增公网或宿主端口，不创建持久管理脚本、登录角色或额外权限。

# 已核官方依据

2026-10-25 实际打开并核对以下原文：

- PostgreSQL 16 的 [`\password [username]`](https://www.postgresql.org/docs/16/app-psql.html) 会交互询问新密码，在客户端加密后通过 `ALTER ROLE` 发送；不把明文密码写进命令历史或服务器日志。省略角色时修改当前用户。使用这个入口，不拼接含明文密码的 SQL、命令行或 heredoc。
- [Docker 官方 postgres 镜像说明](https://hub.docker.com/_/postgres)明确：初始化环境变量只对空数据目录生效，已有数据库在启动时保持原状。修改 `POSTGRES_PASSWORD`、重建 db 容器或重启服务，都不能替代对现有角色执行密码变更；更不能删卷以强制生效。
- [`pg_isready`](https://www.postgresql.org/docs/16/app-pg-isready.html) 不要求正确的用户名、密码或数据库名即可报告服务器状态。Compose 的 healthy 只说明可接受连接，不能证明密码正确。
- [PostgreSQL 16 错误码表](https://www.postgresql.org/docs/16/errcodes-appendix.html)中 `28P01` 是 `invalid_password`。旧密码必须在明确的同一目标上、通过全新 TCP 连接得到此码；拒绝连接、超时、DNS 错误、`28000` 或库不存在均不算验收。

## 生产只读预检结果（2026-10-25）

Hostinger 既有管理终端已连接。Web 的真实运行时 URL 新建 TCP 连接成功，数据库／角色与 URL 匹配；仅替换成随机错误密码后，以 `28P01` 拒绝。现有 Web／worker URL 一致，角色／库名／密码与 db 初始化环境一致，保存的 Compose 配置与当前应用 URL 一致；三者具有共同内部网络，服务集合恰为 db／web／worker。只输出布尔值，没有输出或保存环境值。

视频任务汇总为 success 4、failed 2，本次快照没有 submitting／pending／unknown；正式停机前须重查。HBA 配置同时存在 host scram-sha-256 与 host／local trust；不能概括成全库只允许密码认证。本次应用实际 TCP 路径的错误密码对照已拒绝，没有修改 HBA。备份、新密码、平台新配置注入、重建和恢复验收仍未执行。

# 人与 Agent 的分工

这是留存的备选方案，不是生产变更授权，本次不安排轮换窗口。未来另行决定执行时，执行者须先重新核准窗口、具体操作对象和恢复入口。Agent 可以准备步骤、核对非敏感对象标识、读回掩码状态、运行经授权的只读探针并汇总安全结果。

**浏览器内修改密码必须由用户接管，亲自输入新密码、确认并提交。Agent 不能代用户在 UI 输入、粘贴或提交新密码，也不能用 DOM、页面脚本、请求注入绕过。** Dokploy 环境设置中的 `POSTGRES_PASSWORD` 和含新密码的 `DATABASE_URL` 同样按此交接；网页终端中的 `\password` 提示也由用户输入并确认。用户接管时 Agent 停止该页面自动操作和截屏，完成后只核保存状态及认证结果，不点击显示密码。

本手册采用用户在受控交互终端私下生成、保管和输入真实新密码的方式；这不是将浏览器交接规则扩展为所有终端工具的通用禁令。禁止把密码发到对话、终端命令参数、剪贴板日志、截图、Git、issue 或完整环境输出中；不查询 `pg_authid` 的密码验证器。关闭 shell tracing／录屏，不用 `printenv`、完整 `docker inspect`、渲染后的 Compose 输出或异常对象输出作为证据。库外临时秘密目录 0700、文件 0600；真实配置不复制或软链接进 checkout。本轮准备未读取真实 `~/.vibefriends` 配置。

# 执行前置清单

本清单当前不启用。未来另行决定轮换时，须先按届时运行版本更新原五项迁移及旧镜像等历史基线，所有项完成后才进入密码变更。实际值只存受限执行记录，公开报告只写匹配与否。

1. 核准 Dokploy 的本项目／环境、Compose project label、准确的 db／web／worker 容器 ID、各自镜像 ID／digest、数据库网络以及 db 的实际卷名、挂载目标。核对当前所有副本和一次性运维进程；不能依赖一个叫 `db` 的服务名就认定项目。发现沙盒、其他项目、不同卷或不同角色立即停下。
2. 核准实际运行镜像与上述旧应用基线相符（最新部署记录 `a3b05be` 与 `b197051` 应用代码相同），迁移记录只有 0001–0005，记录完整名称和校验和。确认保留了可重新启动的原 Web／worker 镜像和旧部署定义；不要引用会移动的 tag。若代码不同或出现 0006–0009，停止套用本窗口，按真实状态重新评审，不把数据库退回五项迁移。
3. 暂停本项目自动部署／定时重建，记录原状态；确保保存环境不会自动拉 main 或重建新代码。若平台不能只更新环境并固定原镜像／版本，先解决这一能力缺口，不点击通用 Redeploy 试运气。不要改全局或其他应用的 webhook。
4. 确认可用的项目专属管理入口，以及当前备份的存在和可读性；备份可读不等于已完成恢复演练。密码轮换不需要还原数据，备份也不是默认回滚动作。保留一个已验证身份的受控管理会话，直到新认证和应用验收完成；禁止临时扩大权限或把 `pg_hba.conf` 改成 `trust` 解锁。
5. 从应用所在网络核实际数据库／角色、PostgreSQL 大版本及匹配的 HBA 规则。TCP 必须要求密码认证，例如 `scram-sha-256`，不能靠 socket／peer／trust 通过。轮换前用旧密码新建 TCP 连接应成功，另一个随机错误密码应返回 `28P01`；这一对照排除“任何密码都能过”的假验证。不要为轮换顺带改变认证方式。
6. 用户准备唯一的新强密码及受限的新配置副本，核 `DATABASE_URL` 的角色、主机、端口、库名和连接参数保持不变。URL 中只对密码组件做正确的百分号编码，`POSTGRES_PASSWORD` 使用原始密码，避免双重编码。临时保留旧密码仅用于负向验收，验收后清理；不要把它作为恢复计划。
7. 清点全部凭证消费者：现有 web／worker 及副本、经批准的迁移／备份／运维入口；未来存在的 billing-reconciliation 也在内。确认共享 URL 指向同库同角色。不同消费者若实际使用不同角色，必须分别制定轮换，不能假设一个 `\password` 改了所有角色。

可用以下限定字段检查对象，变量必须先由操作者映射并确认。禁止用名称模糊匹配后批量 stop／rm：

```sh
docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}} {{.Image}}' "$DB_CID" "$WEB_CID" "$WORKER_CID"
docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}} {{.Name}} {{.Destination}}{{end}}{{end}}' "$DB_CID"
```

在受控管理会话中只读核对；结果留库外，不公开实际身份：

```sql
SELECT current_database(), current_user, current_setting('server_version_num');
SELECT name, checksum FROM schema_migrations ORDER BY name;
SELECT pid, backend_start, state, xact_start
FROM pg_stat_activity
WHERE datname = current_database() AND usename = current_user
  AND backend_type = 'client backend' AND pid <> pg_backend_pid();
```

应用会话清点还要结合准确容器／网络归属。不要仅凭同库同角色就批量终止所有会话；不认识的管理连接先查明。

# 有维护窗口的轮换顺序

同一登录角色在常规密码认证下没有新旧密码重叠窗口。本方案接受短暂停机，避免连接池部分可用、部分持续认证失败。

## 1．隔离请求并停止旧应用进程

在旧应用之外启用维护页或阻断本项目流量，停止 web 和 worker 的全部已确认副本，并暂停其自动拉起。旧版 Web 处理查询也可能推进任务，只停 worker 不够。未来已部署账单对账进程时一并停止并等待在途批次退出，参考其 8 分钟 grace period；当前不存在则跳过，不新建。

按平台已核准的停止入口操作；若用 Docker，只针对预先核验的容器 ID，例如 `docker stop --time 480 "$WEB_CID" "$WORKER_CID"`。读回确认进程已退出、没有替代副本、连接已释放，再继续。数据库保持运行、原卷保持挂载。禁止 `compose down -v`、卷删除、全局 prune 或扫其他项目。

外部已接受的任务可能继续执行；维护前记录既有任务／订单标识与处理状态到受限记录，不重提任务、付款或退款。旧连接不会因密码变更自动失效，不能把旧连接还能查询当作轮换失败，也不能让它们掩盖新连接认证失败。

## 2．用户在数据库中实际变更角色密码

从已核准的 db 容器进入 PostgreSQL 16 `psql`。这里的本地管理连接用于执行变更，不是 TCP 密码验收：

```sh
docker exec -it "$DB_CID" psql -X -U "$DB_ROLE" -d "$DB_NAME"
```

先运行上面的身份查询，确认 `current_user` 正是应用连接串的现有登录角色。若不是，不继续。随后由用户在私密交互会话输入：

```text
\password
```

用户亲自完成两次新密码输入；这是当前角色的实际密码修改，不另建角色，不变更授权。使用默认自动提交，不包在未提交的事务里；收到错误时先核提交状态，不能仅凭已输入密码宣布成功。管理会话暂时保留，等待下一节全新 TCP 正反验证。

## 3．先验数据库的新旧认证，再更新所有运行时配置

按下一节一次性探针对同一数据库执行：新密码成功 → 旧密码 `28P01` → 新密码再次成功。任一失败保持维护状态，进入故障处理。用保留的管理会话查询成功、`pg_isready` healthy、UI 保存成功，都不替代这一关。

通过后由用户更新 Dokploy 的共享 `DATABASE_URL` 和 `POSTGRES_PASSWORD`，以及清单内的库外运维／备份配置。两项应表达同一个新密码；不更改角色、库名、网络、支付开关或其他密钥。Agent 只读回掩码保存状态及非敏感配置标识；最终以使用保存后的运行时配置建立连接为准。

`POSTGRES_PASSWORD` 同步是配置一致性工作，真正生效点是前一步数据库 `\password`。现有 db 容器仍可能保留旧初始化环境，本次默认不重建 db，以免混入额外停机。若平台保存配置并不会更新这个容器，必须记录这一残留和清理责任；在本次窗口明确批准后，才可用**相同已固定的 db 镜像与同一个既有卷**重建 db，随后重跑正反认证和数据检查。既不能假称旧容器环境已清除，也不能为清理它删卷或更换 PostgreSQL 版本。

## 4．以原版本、新环境重建应用并验收

使用执行前确认的 Dokploy 环境更新入口／固定镜像重建入口，逐个重建 web、worker 的所有副本。普通 `docker restart` 不会装载更新后的环境；旧 Node 进程也不会自动重读配置。`src/server/db.ts` 缓存 `postgres` client，连接池 `max: 4`、`idle_timeout: 20`、`connect_timeout: 10`，所以等待 idle timeout 不能代替进程替换。

重建只能使用窗口开始时核准的原镜像摘要和旧部署定义，不运行准备分支的 Compose build/up。启动包装器会核迁移，重启后仍须只有原五项名称／校验和。本次不启动 billing-reconciliation；将来它已部署时，同样更换环境、重建进程并独立验 DB，不能拿空 adapter 的全零 tick 证明连库成功。

逐服务使用其**实际运行时 `DATABASE_URL`**执行下面的只读检查。先确认服务新容器 ID、镜像 digest、启动时间及项目归属，确保模块解析目录为镜像内 `/app`。命令不启动业务代码、不迁移、不触发生成或支付；不手工注入替代 URL，否则只能证明探针配置正确：

```sh
docker exec -i -w /app "$APP_CID" node --input-type=module <<'JS'
import postgres from 'postgres';
let sql;
try {
  const u = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || u.hostname.startsWith('/')) throw Error();
  sql = postgres(u.href, { max: 1, connect_timeout: 5, onnotice: () => {} });
  const [r] = await sql`SELECT current_database() AS db, current_user AS role,
    inet_client_addr() IS NOT NULL AS tcp,
    current_setting('server_version_num')::int AS version`;
  if (r.db !== decodeURIComponent(u.pathname.slice(1)) || r.role !== decodeURIComponent(u.username)
      || !r.tcp || r.version < 160000 || r.version >= 170000) throw Error();
  console.log('PASS runtime_new_connection identity_match tcp PostgreSQL16');
} catch {
  console.log('FAIL runtime_new_connection');
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 2 });
}
JS
```

这是每个新容器内的独立客户端，证明该容器实际环境能新建连接；还需核应用自身启动日志和业务数据库读路径。`/api/health` 在当前源码只返回固定状态，不查询数据库。使用经核准且无外部副作用的账户／账单只读路径，不能把任务轮询、worker once 或实际生成当作无成本探针。若无法证明某业务入口无副作用，就仅执行只读 SQL 并记录业务验收缺口。

# 一次性 TCP 正反认证探针

在有授权的 Docker 管理终端运行，连接到**已核对的本项目内部网络**，不映射端口。使用已存在、对应旧部署的 worker 镜像 ID／digest，显式覆盖入口为 Node；不调用 `scripts/start.mjs`、迁移、worker 或支付模块。只读诊断容器不是新增常驻服务，退出即删除。

用户在库外受限文件 `$ROTATION_PROBE_ENV` 私下准备以下变量，Agent 不读取文件内容。文件只供本次诊断，不使用现有全量生产配置，不包含支付／模型凭证：

| 变量 | 内容 |
|---|---|
| `ROTATION_NEW_URL` | 同一目标的新密码连接串，密码组件已编码 |
| `ROTATION_OLD_PASSWORD` | 同一角色的旧原始密码，仅用于负向认证 |
| `ROTATION_EXPECT_HOST` / `ROTATION_EXPECT_PORT` | 已独立核准的内部数据库主机、端口 |
| `ROTATION_EXPECT_DB` / `ROTATION_EXPECT_ROLE` | 已独立核准的库名、角色 |

变量 `$PROJECT_NETWORK`、`$PINNED_WORKER_IMAGE`、`$PROBE_NAME` 为操作者确认的非秘密目标，`$PROBE_NAME` 必须唯一且未被占用。镜像不存在、依赖缺失或网络不符时停止，不自动拉取替代镜像，不退回 socket。Docker env-file 的引号／转义行为须按执行环境核对；不能因解析错误把错误密码当成旧密码失效证据。

```sh
docker run --rm -i --pull=never --name "$PROBE_NAME" \
  --network "$PROJECT_NETWORK" --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --env-file "$ROTATION_PROBE_ENV" --entrypoint node \
  "$PINNED_WORKER_IMAGE" --input-type=module <<'JS'
import postgres from 'postgres';
const e = process.env;
let stage = 'configuration';
try {
  const target = new URL(e.ROTATION_NEW_URL);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
      || !e.ROTATION_EXPECT_HOST || !e.ROTATION_EXPECT_PORT
      || !e.ROTATION_EXPECT_DB || !e.ROTATION_EXPECT_ROLE
      || target.hostname !== e.ROTATION_EXPECT_HOST
      || (target.port || '5432') !== e.ROTATION_EXPECT_PORT
      || decodeURIComponent(target.pathname.slice(1)) !== e.ROTATION_EXPECT_DB
      || decodeURIComponent(target.username) !== e.ROTATION_EXPECT_ROLE
      || !target.password || !e.ROTATION_OLD_PASSWORD
      || decodeURIComponent(target.password) === e.ROTATION_OLD_PASSWORD
      || target.search || target.hash) throw Error();
  // This bounded example accepts no query overrides. If TLS parameters are
  // required, review a variant retaining them; never silently remove TLS.
  async function connect(password) {
    const u = new URL(target);
    u.password = encodeURIComponent(password);
    const sql = postgres(u.href, { max: 1, connect_timeout: 5, onnotice: () => {} });
    try {
      const [r] = await sql`SELECT current_database() AS db, current_user AS role,
        inet_client_addr() IS NOT NULL AS tcp,
        current_setting('server_version_num')::int AS version`;
      if (r.db !== e.ROTATION_EXPECT_DB || r.role !== e.ROTATION_EXPECT_ROLE
          || !r.tcp || r.version < 160000 || r.version >= 170000) throw Error();
    } finally { await sql.end({ timeout: 2 }); }
  }
  stage = 'new_tcp';
  await connect(decodeURIComponent(target.password));
  console.log('PASS new_tcp identity_match PostgreSQL16');
  stage = 'old_tcp';
  let rejected = false;
  try { await connect(e.ROTATION_OLD_PASSWORD); }
  catch (error) { if (error.code === '28P01') rejected = true; else throw error; }
  if (!rejected) throw Error();
  console.log('PASS old_tcp rejected SQLSTATE=28P01');
  stage = 'new_tcp_again';
  await connect(decodeURIComponent(target.password));
  console.log('PASS new_tcp_again');
} catch {
  console.log(`FAIL ${stage}; keep maintenance; no secret output`);
  process.exitCode = 1;
}
JS
```

此示例拒绝带 query／fragment 的 URL，防止参数覆盖已核对的目标；需要 TLS 参数的环境须先审阅保留原 TLS 要求的变体，不能为运行示例剥掉 TLS。每次 `connect()` 都创建并关闭独立客户端，不能复用已认证连接。正反测试完成后核退出码、容器已不存在；中断时只清理本次已核准的探针容器 ID，不按全局名称前缀清理。用户清理含旧密码的诊断文件；长期新凭证仍留既有安全存储，不进入日志。

# 验收、恢复与交接

| 必需证据 | 通过标准 |
|---|---|
| 对象与数据 | 同一项目、PostgreSQL 16、同一实际卷／库／角色；原迁移名称及校验和不变；原数据及关键记录仍在，无重新初始化 |
| 数据库凭证 | 全新 TCP：新密码成功并匹配身份，旧密码只以 `28P01` 失败，新密码复测成功 |
| 每个消费者 | 实际保存的新配置、原版本镜像、新进程／新连接；web、worker 及其全部副本各验一次；未来 billing-reconciliation 同标准，本次 N/A |
| 应用恢复 | 启动成功、无持续认证失败／重启循环，至少连续观察 5 分钟；health 之外另有真实只读 DB 证据。仍需独立验收的生成／支付功能不据此放行 |
| 轮换边界 | 保持窗口开始时核准的原应用镜像／0001–0005，不启用新收费、不运行 0006–0009、不影响官方沙盒或其他项目 |
| 秘密与残留 | 旧密码诊断副本已清理；平台源配置已同步；旧进程／旧配置容器残留逐项说明，旧初始化环境未清理不能记完全收尾 |

失败时先维持维护／停止消费者，使用下表恢复，不默认改回旧密码：

| 失败位置 | 处理 |
|---|---|
| `\password` 执行前 | 未发生 DB 密码变更。若环境也未改变，可恢复原进程／配置与流量；仍须核状态，不凭记忆推断 |
| DB 已改，新密码验证失败 | 保留管理会话，核目标、输入、编码、HBA 与连接路线。用户通过原授权入口修正新密码，必要时换第三个全新密码，再做全套正反验证；不改 trust、不新增超级用户 |
| 新密码可用，旧密码也可用 | 检查是否用了旧连接、错误目标、trust 或错误的旧密码样本，保持维护。不能宣告成功或继续更新更多对象 |
| DB 已验，新环境未保存／某消费者失败 | 保留新 DB 密码，修正保存位置或 URL 编码，仅重建受影响的已核准消费者并复验；不要重置数据或改回疑似已泄露旧密码 |
| 管理入口不可用 | 停在维护状态，交现有授权管理员恢复访问，报告具体阻点；不借其他项目凭据、不修改全局认证、不创建持久后门 |
| 意外部署新代码或应用了 0006–0009 | 已超出纯密码轮换，停止本手册恢复路径；保留新凭证与数据，按独立升级方案处理。禁止直接回退旧代码或还原备份抹去新任务／交易事实 |

全部必需证据齐备后才解除本项目维护，按执行前记录恢复自动部署状态。若恢复自动部署可能立即发布尚未批准的 main，继续暂停并明确交接，不因密码轮换完成就放行升级。

交接记录只保留日期、操作者、对象匹配结果、镜像／迁移是否不变、各项 PASS／FAIL、旧认证的 `28P01`、观察窗口、残留项及责任人。真实资源标识和受限备份位置在库外记录；密码、完整 URL、密码哈希、环境导出和原始异常不进入报告。

# 2026-10-25 本机隔离演练实录

实际开始时间为 `2026-10-25T03:41:44Z`。仅使用本机已有 PostgreSQL 16 镜像、新建 `127.0.0.1:55454` 监听和专属随机名称的临时卷；旧／新／错误对照密码均在内存生成，无真实配置。没有运行应用入口或迁移、支付、模型调用，也没有浏览器操作。

演练顺序：旧密码建立初始库并写合成标记 → 只改容器初始化环境、用同一卷重建 → 容器内交互 `psql \password` → 新旧 TCP 认证 → 重启后复验。所有认证使用独立 Node `postgres` 客户端，密码不输出。以下为工具实际返回的安全日志摘录：

```text
baseline_old_tcp: {"result": "PASS", "tcp": true, "major": 16}
baseline_wrong_tcp: {"result": "FAIL", "code": "28P01"}
env_only_old_tcp: {"result": "PASS", "tcp": true, "major": 16}
env_only_new_tcp: {"result": "FAIL", "code": "28P01"}
psql_password_interactive: PASS (synthetic secret; output suppressed)
rotated_new_tcp: {"result": "PASS", "tcp": true, "major": 16}
rotated_old_tcp: {"result": "FAIL", "code": "28P01"}
pg_isready_with_old_password: exit=0 (not an authentication proof)
restart_new_tcp: {"result": "PASS", "tcp": true, "major": 16}
restart_old_tcp: {"result": "FAIL", "code": "28P01"}
persistent_marker: PASS; payments=0; model_calls=0; app_migrations=0
own_container_removed: True
own_volume_removed: True
```

日志中的预期 `FAIL / 28P01` 是负向认证成功拦截，不是演练失败。用容器与卷的准确 ID／名称删除后又分别查询确认不存在；未删除已有镜像，未触碰其他容器／卷。此演练证明 PostgreSQL 关键行为，不证明 Dokploy 配置已保存、生产轮换已做、业务连接池已替换或生产数据已验收。上面的生产命令模板尚未在生产执行。

文档生成后另在同一允许端口的新临时库中，直接提取本文两段 JavaScript，用本机现有 Node／postgres 依赖运行，核验成功与拒绝分支；新合成密码包含 URL 保留字符，证明编码路径可用。未运行生产 Docker 包装命令或使用生产镜像／网络。实际安全结果如下；容器、卷均已删除并回查不存在：

```text
document_auth_probe: PASS new_tcp identity_match PostgreSQL16 | PASS old_tcp rejected SQLSTATE=28P01 | PASS new_tcp_again
document_same_password_guard: FAIL configuration; keep maintenance; no secret output
document_wrong_new_guard: FAIL new_tcp; keep maintenance; no secret output
document_runtime_new: PASS runtime_new_connection identity_match tcp PostgreSQL16
document_runtime_old: FAIL runtime_new_connection
URL_reserved_characters: PASS; no app entrypoint or migration executed
document_test_container_removed: True
document_test_volume_removed: True
```

两段 JavaScript 通过 `node --check`，四段 shell 通过 `bash -n`，本地文档链接目标存在。失败对照均以退出码 1 拒绝，正常探针以退出码 0 完成；没有把语法检查或预期失败当成生产完成证据。
