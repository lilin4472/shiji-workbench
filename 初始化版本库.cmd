@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  识机（shiji-workbench）版本库初始化
echo  目的：给接手方（GPT / 其他开发）一个可回滚的基线。
echo  说明：本机此前没有 .git；.gitignore 已存在并排除
echo        node_modules / dist / dist-electron。
echo ============================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 git 命令。
  echo 请先安装 Git for Windows：https://git-scm.com/download/win
  pause
  exit /b 1
)

if exist ".git\HEAD" (
  echo 检测到这已经是 git 仓库，跳过初始化，只显示当前状态。
  echo.
  git --no-pager log --oneline -5
  echo.
  git status --short
  pause
  exit /b 0
)

git init
if errorlevel 1 (
  echo git init 失败，请查看上面的输出。
  pause
  exit /b 1
)

echo.
echo 设置本仓库提交身份（仅本仓库，不动全局配置）...
git config user.name >nul 2>nul
if errorlevel 1 git config user.name "shiji-dev"
git config user.email >nul 2>nul
if errorlevel 1 git config user.email "shiji@local"

echo.
echo 暂存文件（node_modules 等已在 .gitignore 中排除）...
git add -A
if errorlevel 1 (
  echo git add 失败，请查看上面的输出。
  pause
  exit /b 1
)

git commit -m "chore: 识机 V1 基线 0.2.5 / 契约 11（含 2026-09-15 天地图框底部文字遮挡修复与需求文档 §5.9 口径更新）"
if errorlevel 1 (
  echo 提交失败，请查看上面的输出。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  完成。基线提交如下：
git --no-pager log --oneline -1
echo.
echo  纳入版本库的文件数量（应只含源码与文档）：
git --no-pager ls-files | find /c /v ""
echo ============================================================
echo  以后给接手方的交付方式：把整个项目目录（含 .git）或
echo  git bundle 交给对方，对方 git log 即可看到全部改动历史。
pause
