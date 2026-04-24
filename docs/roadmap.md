下面是一份可以直接放进仓库 `docs/technical-roadmap.md` 的技术路线文档。我会按“产品经理 + 工程团队”的方式写，核心原则是：**先把分支导航的正确性做扎实，再做体验和传播；先解决系统不变量，再解决 UI 好看。**

# ChatGit 技术路线文档

## 1. 项目定位

ChatGit 的目标不是做一个普通的 ChatGPT 页面增强插件，而是做一个面向长对话、多分支对话的 **conversation version control layer**。

当前 ChatGPT 原生交互的问题是：当用户编辑旧消息、生成多个回复版本之后，对话会从线性结构变成隐式树结构，但 UI 仍然主要以线性滚动和局部版本切换的方式呈现。用户无法直观看到自己在哪个分支、历史分支如何连接，也很难一键恢复到某个旧分支路径。

所以 ChatGit 的核心产品价值应该定义为：

**把 ChatGPT 的隐式对话分支显式化、结构化、可导航化。**

当前仓库已经具备较好的基础：README 说明项目使用同一套 `src/content.js` / `src/content.css`，通过构建脚本生成 Chrome 和 Firefox 两套扩展产物；运行时也已经强调使用稳定 turn 位置、reply switcher index、fallback 策略，而不是单纯找附近按钮点击。 Chrome 和 Firefox manifest 目前都是 MV3 content script，匹配 `chatgpt.com` 和 `chat.openai.com`，这对权限收敛和用户信任是好事。 

## 2. 第一性原理分析

用户真正需要的不是“一个侧边栏”，而是三个能力：

第一，**知道自己在哪里**。也就是当前可见对话属于哪条分支路径，当前节点在整棵树里的位置是什么。

第二，**知道自己来过哪里**。也就是之前出现过哪些 user turn、assistant turn、版本组合、父子关系，不因为页面 DOM 变化而丢失。

第三，**能稳定回到任意一个地方**。也就是点击树上的某个节点后，系统能自动切换必要的父级回复版本，把页面恢复到目标路径。

因此，技术设计不应该从 UI 开始，而应该从状态不变量开始。

ChatGit 的核心不变量应该是：

**一个对话状态 = 一组 turn position + 每个有分支 turn 的 selected version。**

只要能恢复这一组 selected version，就能恢复目标路径。UI 树只是这个状态的可视化结果。

## 3. 当前主要问题判断

目前项目的方向是对的，但技术路线需要从“可用 MVP”升级到“稳定插件产品”。

当前最大风险有五个。

第一，**DOM 依赖风险高**。项目强依赖 ChatGPT 前端的 `data-testid`、`data-message-id`、`aria-label`、`.tabular-nums`、按钮层级等信息。一旦 ChatGPT 前端改版，导航逻辑可能失效。

第二，**核心逻辑集中在单个 content script**。当前构建只复制 `content.js`、`content.css`、assets 和 manifest。 这种结构在早期很快，但随着 branch restore、debug、cache、theme、UI 渲染都放进同一个文件，后续维护成本会明显上升。

第三，**测试体系不足**。`package.json` 目前只有 build 相关脚本，没有 lint、test、format、typecheck。 对这种强依赖第三方页面 DOM 的插件来说，没有自动化测试会导致每次修一个选择器都可能破坏另一个场景。

第四，**产品表达还不够强**。现在 README 主要讲结构、构建和安装，但还缺少核心动图、前后对比、使用场景、已知限制、隐私说明、上架说明。对开源传播和 Chrome Web Store 审核都不够有利。

第五，**“ChatGit”这个名字的潜力还没有完全发挥**。现在更像“ChatGPT branch navigator”，但如果继续加入导出、分支命名、历史快照、对话图谱，它才真正像 Git。

## 4. 总体技术目标

未来 4 个版本的目标应该这样排：

`v1.2`：修复可靠性问题，让现有功能稳定。

`v1.3`：重构工程结构，让后续功能可维护。

`v1.4`：完善测试、日志、错误恢复，让插件可发布。

`v2.0`：从“分支导航器”升级为“对话版本控制工具”。

不要一开始就加复杂功能。这个项目的护城河不是 UI，而是 **branch restore 的正确性**。

## 5. 目标架构

建议把当前单体 content script 拆成如下模块：

```text
src/
  core/
    model.js              # 对话树数据模型
    scanner.js            # ChatGPT DOM 扫描
    switcher-index.js     # 回复版本切换器索引
    navigator.js          # 分支恢复与跳转
    storage.js            # localStorage/cache/migration
    selectors.js          # selector registry
    invariants.js         # 状态校验
  ui/
    panel.js              # 侧边栏渲染
    row.js                # 节点行渲染
    status.js             # toast/status
    debug.js              # debug 面板
    theme.js              # 主题检测
  platform/
    browser.js            # Chrome/Firefox API 兼容层
    url-watch.js          # SPA URL 变化监听
  content.js              # 入口，只负责装配
  content.css
  manifests/
```

拆分后的原则是：

`scanner` 只负责读 DOM，不修改状态。

`model` 只负责维护树，不操作 DOM。

`navigator` 只负责把目标路径恢复到页面，不关心 UI 长什么样。

`ui` 只负责展示状态，不直接计算分支关系。

这会让项目从“能跑的脚本”变成“可维护的软件系统”。

## 6. 核心数据模型重构

建议重新定义内部状态，避免后面越修越乱。

核心对象可以这样设计：

```ts
type TurnPosition = {
  positionKey: string;        // conversation-turn-7 这类稳定位置
  order: number;              // 页面顺序
  role: "user" | "assistant";
};

type MessageVariant = {
  variantKey: string;         // positionKey + versionIndex + contentHash
  positionKey: string;
  messageId?: string;
  versionIndex: number;
  versionTotal: number;
  summary: string;
  contentHash: string;
  firstSeenAt: number;
  lastSeenAt: number;
};

type BranchEdge = {
  parentVariantKey: string | null;
  childVariantKey: string;
  selectedParentVersion?: number;
};

type ConversationGraph = {
  conversationKey: string;
  variants: Record<string, MessageVariant>;
  edges: BranchEdge[];
  activePath: string[];
  switchers: Record<string, ReplySwitcherState>;
};
```

这里的重点是：**不要把 messageId 当成稳定主键。**

`messageId` 可以作为辅助信息，但主键应该由 `positionKey + versionIndex + contentHash` 组成。因为 ChatGPT 编辑消息、切换版本时，messageId 很可能变；但 turn 的位置、版本序号和内容摘要组合更适合作为恢复依据。

## 7. Branch Restore 算法路线

点击任意节点时，不应该直接滚动到 DOM 节点，而应该执行四步。

第一步，找到目标节点对应的目标路径：

```text
targetNode -> parent -> parent -> ... -> root
```

第二步，计算当前 active path 和 target path 的差异：

```text
current: A1 -> B2 -> C1
target:  A1 -> B1 -> D1

公共前缀: A1
需要切换: B 从 version 2 切到 version 1
需要等待: D1 出现在 DOM
```

第三步，从最近公共祖先开始切换版本。每次点击 previous/next 后，都要等待 DOM 更新，并重新扫描 switcher index。

第四步，验证目标节点是否出现在 live path。只有验证成功，才执行 scroll/highlight。否则进入 fallback：尝试重建 index、尝试按版本循环搜索、最后给用户明确错误提示。

伪代码：

```js
async function restorePath(targetNodeKey) {
  const targetPath = graph.getPath(targetNodeKey);
  const currentPath = graph.activePath;

  const lcaIndex = findCommonPrefix(currentPath, targetPath);

  for (let i = lcaIndex; i < targetPath.length; i++) {
    const target = graph.getNode(targetPath[i]);
    const parent = graph.getParent(target);

    if (!parent) continue;

    const desiredVersion = target.parentSelectedVersion;
    const switcher = switcherIndex.get(parent.positionKey);

    if (!switcher) {
      throw new RestoreError("SWITCHER_NOT_FOUND", parent);
    }

    await goToVersion(switcher, desiredVersion);
    await waitForDomStable();
    await rebuildGraphFromDom();
  }

  if (!graph.isNodeVisible(targetNodeKey)) {
    throw new RestoreError("TARGET_NOT_VISIBLE_AFTER_RESTORE", targetNodeKey);
  }

  scrollToNode(targetNodeKey);
}
```

这部分就是项目最核心的技术资产。应该单独写测试，而不是埋在 UI click handler 里。

## 8. Selector Registry 机制

当前最大外部不确定性是 ChatGPT DOM 会变，所以需要把 selector 管理产品化。

建议做一个集中式 `selectors.js`：

```js
export const SELECTOR_GROUPS = {
  userTurns: {
    stable: [
      'main section[data-testid^="conversation-turn-"][data-turn="user"]',
      'main [data-testid^="conversation-turn-"][data-turn="user"]'
    ],
    fallback: [
      '[data-message-author-role="user"][data-message-id]'
    ]
  },
  assistantTurns: {
    stable: [
      'main section[data-testid^="conversation-turn-"][data-turn="assistant"]'
    ],
    fallback: [
      '[data-message-author-role="assistant"][data-message-id]'
    ]
  },
  versionText: {
    stable: ['.tabular-nums'],
    fallback: ['span', 'div']
  },
  switchButtons: {
    previous: [
      /Previous response/i,
      /上一回复/,
      /上一個回覆/
    ],
    next: [
      /Next response/i,
      /下一回复/,
      /下一個回覆/
    ]
  }
};
```

这里有一个必须立刻修的问题：如果代码里存在中文 label 的乱码文本，要全部替换成正常中文，并保留英文、简中、繁中三类匹配。这个问题不大，但会严重影响中文用户体验。

## 9. 稳定性策略

稳定性优先级应该是：

1. 能识别当前页面是否是 ChatGPT 对话页。
2. 能识别当前可见 turns。
3. 能识别每个 assistant turn 的版本状态。
4. 能构建当前 live path。
5. 能保存已发现 graph。
6. 能恢复目标 path。
7. 能在失败时明确告诉用户失败原因。

失败时不要静默失败。用户点击节点后，如果恢复失败，应该给出类似：

```text
无法恢复该分支：目标回复版本按钮未找到。
建议：手动切换一次回复版本后，再点击“采集图谱”。
```

这比“什么都没发生”强很多。

## 10. 缓存与迁移

当前 localStorage 缓存是合理的，因为插件没有后端，也不需要账号级同步。下一步要补版本化 schema：

```js
const CACHE_SCHEMA_VERSION = 5;
```

缓存结构建议：

```js
{
  schemaVersion: 5,
  appVersion: "1.2.0",
  conversationKey: "https://chatgpt.com/c/xxx",
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
  graph: {},
  selectorHealth: {},
  debugSummary: {}
}
```

每次升级缓存结构都写 migration：

```js
function migrateCache(raw) {
  if (!raw.schemaVersion) return migrateV4ToV5(raw);
  if (raw.schemaVersion === 5) return raw;
}
```

不要直接清空旧缓存。用户好不容易采集到的分支树，直接丢失会很伤体验。

## 11. 测试路线

这个项目必须上测试，否则后面会越来越不敢改。

建议分三层。

第一层，纯函数单元测试。

测试对象：`parseVersion`、`contentHash`、`findCommonPrefix`、`buildPath`、`migrateCache`、`scoreSwitcherButton`。

第二层，DOM fixture 测试。

用本地 HTML fixture 模拟 ChatGPT 页面结构：

```text
fixtures/
  simple-chat.html
  single-branch.html
  nested-branch.html
  zh-cn-labels.html
  changed-dom-layout.html
```

用 Vitest + jsdom 测 scanner 和 model。

第三层，Playwright 端到端测试。

不要一开始试图自动登录真实 ChatGPT，这很麻烦。先做一个 mock ChatGPT page，模拟：

点击 next response -> DOM 替换。

编辑 user message -> message-id 改变。

多层分支 -> 需要连续切换父级版本。

只要 mock 页面能覆盖核心 restore 逻辑，就足够证明算法稳定。

## 12. 构建工程升级

当前 build 脚本简单可控，这是优点。短期不一定要引入复杂框架，但建议升级为：

```json
{
  "scripts": {
    "dev": "vite build --watch",
    "build": "node scripts/build.mjs",
    "lint": "eslint src",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc --noEmit"
  }
}
```

是否迁移 TypeScript 可以分阶段。

短期：保留 JS，加 JSDoc 类型。

中期：核心模块迁移 TS。

长期：UI 和 content entry 也迁移 TS。

不建议一上来全面 TS 重写。这个项目核心风险是 DOM 行为，不是类型系统。先把模块边界和测试建起来，TS 才会真正有收益。

## 13. UI/UX 改进路线

UI 的目标不是炫，而是降低认知负担。

建议做四个关键改进。

第一，节点层级更明确。每个节点左侧用缩进和连接线表达 parent-child，不要只靠列表。

第二，分支节点加版本 badge。例如 `2/4`、`branch x3`，让用户知道这里有可切换版本。

第三，当前路径高亮要强。用户最关心“我现在在哪条路径上”。

第四，失败状态可解释。比如 switcher 找不到、目标节点没出现、缓存过期，都应该有不同提示。

未来可以加一个“mini map”模式：只显示用户消息节点，把 assistant 节点折叠。因为真实使用时，用户往往是根据自己问过的问题来找分支。

## 14. 产品功能路线

### v1.2：可靠性修复版

目标：让现有功能稳定。

任务：

修复中文 label 乱码。

统一 selector registry。

增加 selector health debug。

增加缓存 schema version。

优化 restore 失败提示。

补 README 中的已知限制。

这个版本不要加新功能。

### v1.3：工程重构版

目标：让代码可维护。

任务：

拆分 `content.js`。

抽出 model/scanner/navigator/storage/ui。

补单元测试。

补 DOM fixture 测试。

引入 lint/format。

保持 UI 行为不变。

这个版本的原则是“重构不改产品”。

### v1.4：发布准备版

目标：可以上架或发 release。

任务：

增加 GitHub release zip。

增加隐私声明。

增加截图/GIF。

增加 Chrome Web Store 文案。

增加 Firefox Add-ons 文案。

增加手动测试 checklist。

增加 version changelog。

这个版本的重点是可信度。

### v2.0：Conversation Git 版

目标：从导航器升级成版本控制工具。

任务：

支持导出 conversation tree JSON。

支持导出 Markdown。

支持每个分支自动生成标题。

支持分支备注。

支持搜索节点。

支持只看 user turns。

支持 graph view / compact view 切换。

这个版本才真正呼应 ChatGit 的名字。

## 15. 推荐 Issue 拆分

可以直接在 GitHub 上拆这些 issue。

### P0

修复中文 aria-label 乱码匹配。

增加 selector registry。

增加 restore failure reason。

增加 cache schema version。

增加 README demo screenshot。

### P1

拆分 model/scanner/navigator/storage/ui。

增加 Vitest。

增加 DOM fixtures。

增加 branch restore 单元测试。

增加 debug export JSON。

### P2

增加 Playwright mock ChatGPT 页面。

增加 release workflow。

增加 privacy policy。

增加 Chrome/Firefox 打包脚本。

增加分支导出 JSON。

### P3

增加 branch naming。

增加 Markdown export。

增加 search。

增加 compact mode。

增加 graph layout view。

## 16. 成功指标

产品指标：

用户能在 3 秒内理解插件用途。

用户点击任意历史分支后，能成功恢复目标分支。

用户在长对话中能明显减少手动翻版本的次数。

工程指标：

核心 restore 测试覆盖 10 个以上分支场景。

selector 变化时，失败原因可定位。

content script 拆分后，单文件不超过 500 行。

每次 release 都有可复现构建产物。

稳定性指标：

普通线性对话识别成功率接近 100%。

单层分支恢复成功率接近 95% 以上。

多层分支恢复成功率接近 90% 以上。

失败时必须有明确错误提示，而不是静默失败。

## 17. 最关键的工程取舍

不要优先做复杂图可视化。图可视化看起来高级，但如果 restore 不稳定，用户会觉得插件不可信。

不要优先做云同步。这个项目目前不需要后端，localStorage 足够。

不要优先做 popup/options 页面。核心价值在 content UI，不在浏览器扩展设置页。

不要过早引入 React。content script 注入 UI 用原生 DOM 反而更轻。如果后续 UI 复杂，再考虑 Preact 或 Web Components。

最应该优先做的是：

**把 branch restore 做成一个可测试、可解释、可恢复的核心引擎。**

## 18. 一句话技术战略

ChatGit 的技术战略应该是：

**以稳定 turn position 为锚点，以版本选择状态为核心不变量，以可验证的 path restore 为核心能力，把 ChatGPT 的隐式分支对话升级成显式、可导航、可导出的对话版本树。**
