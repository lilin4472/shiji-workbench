import type { SimulationDraft } from '../simulation'

interface Props {
  draft: SimulationDraft
  onDraft: (draft: SimulationDraft) => void
}

// 商机推演后续改为独立线上产品；桌面端暂时只保留入口，不继续收集或展示草稿。
export default function SimulationPanel(_props: Props) {
  return <aside className="conversation-panel simulation-panel simulation-panel-coming-soon"><strong>功能开发中，敬请期待</strong></aside>
}
