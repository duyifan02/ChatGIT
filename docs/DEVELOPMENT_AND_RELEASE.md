# ChatGIT 开发与自动 Release 标准流程

## 版本号规则

版本号遵循语义版本 `MAJOR.MINOR.PATCH`：

- **patch**：修 bug、小优化、不改变功能行为
- **minor**：新增功能，保持兼容
- **major**：重大重构、破坏性变化

`package.json` 是唯一版本源，manifest 版本由脚本自动同步。

## 日常开发

```bash
git checkout -b feat/some-feature
# 修改 src/ 下的源码
npm run build
# 在浏览器中加载 dist/chrome 或 dist/firefox 测试
git add .
git commit -m "feat: add xxx"
git push origin feat/some-feature
# 开 PR 合并到 main
```

## 发版流程

```bash
git checkout main
git pull --ff-only
# 确保 git status 是干净的

npm run release:patch   # 1.1.0 -> 1.1.1
npm run release:minor   # 1.1.1 -> 1.2.0
npm run release:major   # 1.2.0 -> 2.0.0
```

执行后自动完成：版本递增 → manifest 同步 → git commit + tag → push → GitHub Actions 构建 → 打包 zip → 创建 GitHub Release。

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run build` | 构建 Chrome + Firefox |
| `npm run check:version` | 检查版本一致性 |
| `npm run sync-version` | 同步 manifest 版本 |
| `npm run release:patch` | 发 patch 版本 |
| `npm run release:minor` | 发 minor 版本 |
| `npm run release:major` | 发 major 版本 |

## Release 产物

每次 Release 包含：

- `chatgit-chrome-x.y.z.zip` — Chrome / Edge
- `chatgit-firefox-x.y.z.zip` — Firefox
- `SHA256SUMS.txt` — 完整性校验

## 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档
style: 样式或格式调整
refactor: 重构
chore: 构建、脚本、依赖、release
```
