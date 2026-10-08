# 家庭药箱

面向长期用药家庭的中文药品库存管理网站。它管理“药放在哪里、理论还剩多少、谁可以共同维护”，不用于服药打卡，也不提供医疗建议。

## 首版包含

- Supabase 邮箱注册、登录、会话刷新和跨设备持久化数据链路。
- 每位用药人拥有独立私人空间；按 owner/editor/viewer 单独授权，同一家庭不会自动公开私人数据。
- 家庭成员邀请具有明确的接受/拒绝步骤。
- 按盒或最小单位录入，支持“3盒零5粒”“155粒”等输入；历史操作保留当时的包装规格。
- 多地点库存、原子调拨、库存不足校验、直接修改实际数量、入库、损耗和操作历史。
- 库存页可按“全部地点”或单个地点筛选；空地点仍可选择，数量、临期提示和低库存提醒随筛选更新。
- 地点可设为一个“主要地点”和多个“备用地点”；备用地点按可配置天数和当前吃药计划计算需求，并向上取整为整盒储备目标，提示不足或偏多。
- 每个用药空间共用独立药品库，支持同名不同品牌/剂型/规格、可输入品牌、可选药盒照片和从药品库快速入库。
- 首次录入和后续入库分别填写“整盒数量”和“零散数量”，系统自动换算为最小单位。
- 用补偿记录撤销最近误操作，不删除原始记录；存在后续依赖时会要求使用“修改数量”纠正。
- 版本化用药计划、所在地生效时间、药品专属消耗地点，以及按明确时间区间推算的理论消耗。
- 低库存、临期提醒和保留家中最低数量的简单调拨建议。
- 数据库事务、幂等键、乐观并发版本与 RLS 权限隔离。
- 未配置 Supabase 时使用醒目标注的浏览器演示模式；它不是生产数据。

## 本地检查

按照需求，Codex 没有自动安装依赖，也没有运行测试或构建。项目维护者可手动执行：

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

打开 `http://localhost:3000`。没有 `.env.local` 时显示演示模式；演示修改保存在当前浏览器中，点击“恢复示例”可重置。

项目使用 Next.js 静态导出，`npm run build` 的可部署文件位于 `out/`。本地开发时 `NEXT_PUBLIC_BASE_PATH` 保持为空。

## 配置 Supabase

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard)，创建项目并妥善保存数据库密码。
2. 进入 **SQL Editor**，按文件名顺序执行：
   - `supabase/migrations/202610080001_initial.sql`
   - `supabase/migrations/202610090001_medicine_library.sql`
   - `supabase/migrations/202610090002_schedule_weekdays.sql`
3. 进入 **Authentication → Providers → Email**，启用 Email；生产环境建议保留邮箱确认。
4. 进入 **Authentication → URL Configuration**。本地开发时将 Redirect URLs 加入 `http://localhost:3000/auth/callback/`。GitHub Pages 部署完成后，还需要加入下文列出的正式回调地址。
5. 进入 **Project Settings → API**，复制 Project URL 和 publishable/anon key。不要使用或暴露 `service_role` key。
6. 复制 `.env.example` 为 `.env.local` 并填写：

```env
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的公开匿名密钥
NEXT_PUBLIC_BASE_PATH=
```

重新启动开发服务器后进入真实模式。建议使用两个不同邮箱注册，验证邀请、接受、共同修改及未授权空间不可见。

### 已部署项目升级药品库

如果现有 Supabase 项目已经成功执行过首个迁移，不要再次执行或重建初始迁移。只需：

1. 打开 Supabase Dashboard 的 **SQL Editor → New query**。
2. 完整复制 `supabase/migrations/202610090001_medicine_library.sql` 并点击 **Run**。
3. 该增量迁移为现有药品增加选填资料字段，为地点增加主要/备用及储备天数设置，并新增安全 RPC、计划储备计算、地点临期统计和照片策略；不会清空或覆盖现有库存及历史记录。已有空间会自动把排序最前的有效地点标记为主要地点，其余地点默认备用 7 天，之后可在页面调整。
4. 迁移会自动创建私有 Storage bucket `medicine-photos`，并限制为已获授权的空间成员读取、editor/owner 上传和删除。无需在 Storage 页面手动新建公开 bucket。
5. 将更新后的项目文件上传 GitHub，等待原有 GitHub Pages 工作流重新部署。无需新增环境变量，也不要把 `service_role` key 放到前端。

### 修复所在地与用药计划保存

已经执行过 `202610090001_medicine_library.sql` 的项目，只需再在 **SQL Editor → New query** 中完整执行 `supabase/migrations/202610090002_schedule_weekdays.sql`。这份增量迁移只更新用药计划保存函数，使“指定星期”能够写入已有的 `days_of_week` 字段；不会删除或重建现有计划、库存和历史数据。所在地切换的修复仅涉及前端，无需额外数据库变更。

## 建议的人工验收

1. 新建“我”的空间并添加每盒 50 粒的药品。
2. 建立家里和学校的库存后，从家里调拨 20 粒到学校，确认总量不变。
3. 在库存页依次选择全部地点、家里、学校和一个空地点，确认药品、数量及提醒按地点变化，切换空间后筛选恢复为全部地点。
4. 把家里设为主要地点、学校设为备用 7 天，设置吃药计划后确认学校显示向上取整的整盒目标，并能提示库存不足或偏多。
5. 登记两个同名但品牌或规格不同的药品，确认都能保留；从其中一个快速入库并确认没有新增重复资料。
6. 上传、替换、删除一张小于 5MB 的 JPG/PNG/WebP 药盒照片，确认药品及库存不受影响，并用未授权账号确认无法读取。
7. 把学校实际数量直接修改为 67，确认记录保存差异，重复刷新不会再次扣除。
8. 设置从今天生效的每日用量和专属地点；切换所在地后确认旧时间段不被改写。
9. 用另一个账号接受邀请，确认 editor 可修改、viewer 不可修改、未授权账号无法读取。
10. 撤销最后操作，确认新增“撤销”记录而非删除原记录。

## 部署到 GitHub Pages

项目已经配置 `output: 'export'`、仓库子路径、静态资源前缀、尾部斜杠和纯浏览器 Supabase PKCE 登录回调。GitHub Actions 会生成 `out/` 并发布到 Pages，不需要 Vercel 或其他服务端运行时。

1. 在 [GitHub](https://github.com/new) 创建空仓库，不勾选自动生成 README。
2. 在本目录执行 `git init`、提交并按 GitHub 页面命令推送。提交前确认 `.env.local` 没有被跟踪。
3. 打开 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables**，添加：
   - `NEXT_PUBLIC_SUPABASE_URL`：Supabase Project URL。
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase publishable/anon key，不要填 `service_role`。
   - 通常不需要手动设置 `NEXT_PUBLIC_BASE_PATH`，工作流会根据仓库名自动计算。只有使用自定义域名或特殊路径时才覆盖它。
4. 打开仓库 **Settings → Pages**，在 **Build and deployment → Source** 选择 **GitHub Actions**。
5. 将代码推送到 `main`。打开仓库 **Actions** 页面，等待“部署家庭药箱到 GitHub Pages”工作流完成。
6. 项目仓库的默认地址通常是 `https://你的用户名.github.io/仓库名/`；如果仓库名本身是 `你的用户名.github.io`，地址则是 `https://你的用户名.github.io/`。
7. 返回 Supabase **Authentication → URL Configuration**：
   - **Site URL** 填上一步的网站首页地址。
   - **Redirect URLs** 添加 `https://你的用户名.github.io/仓库名/auth/callback/`。
   - 用户站点仓库则添加 `https://你的用户名.github.io/auth/callback/`。
8. 完成 Supabase URL 配置后，使用真实邮箱注册并点击确认邮件，确认能够返回网站且保持登录。

工作流文件位于 `.github/workflows/deploy-pages.yml`。它会在构建前检查 Supabase 变量，避免误把演示模式发布为正式网站。

### GitHub Pages 路径说明

- `next.config.ts` 会读取 `NEXT_PUBLIC_BASE_PATH`。项目站点自动使用 `/仓库名`，因此 `/_next` 静态资源和登录回调不会指向域名根目录。
- 网站当前只有首页和固定的 `/auth/callback/` 页面，两者都会导出为实际 HTML 文件，直接刷新不依赖服务器重写规则。
- Supabase 会保存所有正式数据，GitHub Pages 只托管公开静态文件。anon key 出现在前端构建结果中是正常的，真正的数据安全由 RLS 和安全 RPC 保证。
- 如果以后增加带动态参数的页面，需要为每个路径提供静态参数，或继续使用客户端页面，不能依赖 Next.js 服务端路由。

## 尚未完成或需要增强

- 尚未接入短信登录、找回密码和邀请邮件自动发送；当前邀请在对应邮箱账号登录后显示。
- UI 尚未提供重命名/归档地点、成员权限修改、暂停计划和指定星期计划入口；数据库结构已预留。
- 入库可记录有效期，自动消耗、损耗和地点调拨会优先使用较早到期批次；人工盘点只确认地点总量，盘点后无法保留此前未知的批次构成，需要重新入库或后续批次记录才能恢复精确的分批临期统计。
- 补货建议目前是保守规则；复杂隔日/星期计划的原因提示仍可继续增强。
- 本次开发环境没有项目依赖和 npm，因此增量迁移、Storage 策略、双账号权限、照片上传及 GitHub Pages 静态构建需要按上方步骤人工验证。

## 安全说明

所有库存写操作由 Postgres `SECURITY DEFINER` RPC 在事务内完成，并检查当前 `auth.uid()` 的空间角色。私有表启用 RLS，浏览器只使用公开 anon key。不要把 Supabase `service_role`、数据库密码或 `.env.local` 提交到 GitHub。
