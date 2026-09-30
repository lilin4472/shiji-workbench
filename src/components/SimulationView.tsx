import type { SimulationDraft } from '../simulation'

interface Props {
  draft: SimulationDraft
  onDraft: (draft: SimulationDraft) => void
}

// 桌面版不再承载商机推演实现；未来由独立线上产品接管。
export default function SimulationView(_props: Props) {
  return <section className="simulation-coming-soon"><strong>功能开发中，敬请期待</strong></section>
}
