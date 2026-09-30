# 识机

识机（shiji-workbench）是一个基于 Electron、React 和 TypeScript 的 Windows 桌面工作台。当前源码版本：`0.2.27`。

## 本地开发

```powershell
npm ci
npm run dev
```

## 检查

```powershell
npm run typecheck
npm test
npm run build
```

完整 Windows 双版本安装包构建见 [`docs/RELEASE_HARDENING.md`](docs/RELEASE_HARDENING.md)。完整版本需要按文档准备锁定的 DSH 能力包。发行包、构建输出、依赖目录和本机用户数据不属于此源码快照。

## 项目文档

- [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md)：开发记录和阶段状态
- [`docs/PRODUCT_LOGIC_DATAFLOW_V1.md`](docs/PRODUCT_LOGIC_DATAFLOW_V1.md)：产品逻辑与数据流
- [`docs/DSH_INTEGRATION_DECISION_V1.md`](docs/DSH_INTEGRATION_DECISION_V1.md)：DSH 集成边界
- [`docs/RELEASE_HARDENING.md`](docs/RELEASE_HARDENING.md)：发行构建与安全边界

本仓库快照从本机 ChatGPT 项目工作区整理而来；导入时未复制原工作区的 Git 元数据、依赖、构建产物或安装程序。请勿提交 API 密钥、签名私钥、激活发行账本或用户数据。

## 许可证

本项目源码采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。该许可覆盖其条款定义的非商业用途，并允许相应的修改和再分发；具体范围以许可证全文为准。该许可不授予商业用途所需的权利，如需商用请先向版权持有人取得单独许可。

由于该许可包含非商业限制，本仓库是源码公开项目，不属于 OSI 定义的开源软件。
