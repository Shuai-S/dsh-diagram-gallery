# dsh-diagram-gallery

DeepSeek Harness 插件:在会话顶部视图栏(对话 / 轨迹 / …)增加一个「**图示**」标签页,聚合并在线预览项目里的全部图示;**自带 Archify skill(v0.2.0 起)**,安装即含"生成 → 聚合 → 预览"完整闭环,无需另行安装任何 skill。

## 功能

- **工作区图示聚合**:扫描所有注册工作区的 `.archify/<run>/*.html`(archify 交付物)与 `docs/diagrams/**`、`diagrams/**`、`docs/**` 下的 `.mmd` / `.mermaid`
- **会话内 Mermaid 聚合**:只读扫描当前会话的代码卡片,列出会话中出现过的 mermaid 图(不改动会话 DOM)
- **在线预览**:`.html` 以沙箱 iframe 直接交互(节点聚焦 / 追踪 / 导出全可用);`mermaid` 源码查看 + 一键复制;一键在浏览器打开

## 安装

```bash
# web profile(CLI 可管理)
dsh plugin --profile web add link:<本仓库本地路径>

# desktop profile:桌面 App 独占管理,请在 App 插件页从本地路径安装,重启生效
```

## 架构

| 部分 | 职责 |
|---|---|
| `lib/index.js` | host 服务:启动回环 HTTP(127.0.0.1:3988),dispose 三事件兜底关闭 |
| `lib/server.js` | `GET /api/diagrams` 列表;`GET /preview?path=` 白名单文件服务 |
| `lib/scanner.js` | 读 `~/.dsh/storages/workspace.json`(全局注册表)→ 逐工作区扫描 |
| `client/client.js` | `window.__ModuleLoader__` 懒加载 CJS;经 `slots.register("conversation.view")` 注册顶部 tab |
| `skills/archify/` | 内置 **Archify skill 3.2.0**(官方 stable 通道;10 种图 + 一页 explainer);经第二条 patch 行插入 `@deepseek-ai/dsh-skill-filesystem` 实例(providerName: `diagram-gallery-plugin`,bundledSkillDir 锚定安装位),安装即提供图示生成。**不依赖 @tt-a1i/archify-dsh**——skill 直接取自上游 [tt-a1i/archify](https://github.com/tt-a1i/archify) 官方分发,来源记录见 `skills/archify/.bundle-source.json` |

## 技能交互逻辑(唤起方式)

| 入口 | 机制 | 行为 |
|---|---|---|
| `/diagram` 斜杠命令 | 宿主命令注册表(`ctx.get('commands').register`,codemap 先例契约) | `/diagram list` 列出全部图示;`/diagram template erd` 输出对应类型的生成提示词(共 architecture/workflow/sequence/dataflow/erd/explainer 六种),直接发送即触发 archify skill 生成 |
| 「图示」tab 生成按钮 | client 经 `conversation.input.for(scope).setDraft(text)` 程序化写入输入框(官方草稿 API);探测不到时回退剪贴板复制 | 六个类型按钮,一键把模板提示词填进输入框,回车即生成 |
| 自然语言 | skill 描述自动匹配 | 直接说"用 archify 画出…"/"分析这个仓库生成架构图" |

生成产物落在工作区 `.archify/<run>/`,「图示」tab 点刷新即聚合预览。

## 许可

本插件 MIT;内置 `skills/archify/` 为 [Archify](https://github.com/tt-a1i/archify) skill(3.2.0),**Apache-2.0**(见 `skills/archify/LICENSE`、`LICENSE-MIT`、`NOTICE` 与 `THIRD_PARTY_NOTICES.md`),bundle 保留其原始许可与第三方声明。同名个人副本(`~/.dsh/skills/archify` 或项目级 `<项目>/.agents/skills/archify`)优先于本 bundle。

## 安全边界

- HTTP 仅绑定 127.0.0.1;每次请求实时重读工作区注册表,**realpath 必须落在某个注册工作区内**,且后缀白名单(.html/.mmd/.mermaid);无写端点、无目录遍历
- iframe `sandbox="allow-scripts allow-popups"`(无 same-origin),HTML 无法读取 gallery API 之外的宿主数据
- 会话扫描为只读,不修改会话 DOM

## 已知边界

- 端口固定 3988,被占用时服务启动失败并在 host 日志提示(可用 `DIAGRAM_GALLERY_PORT` 覆盖)
- 会话 mermaid 列表在进入 tab 时扫描一次,新图产生后需点「刷新」
- mermaid 引擎未内置:会话图请配合已装的 dsh-mermaid 在对话内直接查看,tab 内提供源码与复制
