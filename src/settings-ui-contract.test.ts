import { describe, expect, it } from 'vitest'
import workspaceSource from './components/Workspace.tsx?raw'
import conversationSource from './components/ConversationPanel.tsx?raw'

describe('production settings copy contract', () => {
  it('does not expose development diagnostics or fixed demo counters to users', () => {
    expect(workspaceSource).not.toContain('任务运行后端')
    expect(workspaceSource).not.toContain('运行低成本模型自检')
    expect(workspaceSource).not.toContain('运行一次受限搜索自检')
    expect(workspaceSource).not.toContain('固定案例')
    expect(workspaceSource).not.toContain('测试搜索词')
    expect(workspaceSource).not.toContain('当前演示数据')
  })

  it('keeps implementation guardrails out of the radar form', () => {
    expect(conversationSource).not.toContain('模型必须原样采用，不允许改回')
    expect(conversationSource).not.toContain('长期画像与本次金额、时间和数量条件分开保存')
  })

  it('offers compact official application help beside every key input', () => {
    expect(workspaceSource.match(/<KeyApplicationGuide/g)).toHaveLength(4)
    expect(workspaceSource).toContain('https://platform.deepseek.com/api_keys')
    expect(workspaceSource).toContain('https://console.volcengine.com/search-infinity/api-key?tab=post_paid')
    expect(workspaceSource).toContain('https://console.tianditu.gov.cn/api/key')
  })
})
