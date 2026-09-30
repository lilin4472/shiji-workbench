import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  relationshipTypeLabel,
  type BusinessGraph,
  type CompanyEntity,
  type ContactPoint,
  type EntityRelationship,
} from '../../shared/business-graph'

type BusinessNode = Node<{ label: string; role: string; level: string; contact: string }, 'business'>

const positions = [
  { x: 360, y: 210 }, { x: 80, y: 48 }, { x: 630, y: 52 }, { x: 64, y: 330 },
  { x: 650, y: 330 }, { x: 350, y: 475 }, { x: 350, y: 25 }, { x: 82, y: 500 },
]

function BusinessNodeCard({ data, selected }: NodeProps<BusinessNode>) {
  return (
    <div className={`graph-node ${data.level} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span>{data.role}</span>
      <strong>{data.label}</strong>
      <small>{data.contact}</small>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { business: BusinessNodeCard }

export default function IndustryGraph({ graph }: { graph: BusinessGraph }) {
  const [nodes, , onNodesChange] = useNodesState<BusinessNode>(graphNodes(graph))
  const [edges, , onEdgesChange] = useEdgesState(graphEdges(graph.relationships))

  return (
    <div className="graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.55}
        maxZoom={1.8}
      >
        <Background color="#8091aa" gap={28} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => node.id === graph.project.id ? '#7c5cff' : '#1dc9a0'} />
      </ReactFlow>
      <div className="graph-hint">拖动节点 · 滚轮缩放 · 拖动画布</div>
    </div>
  )
}

function graphNodes(graph: BusinessGraph): BusinessNode[] {
  const project: BusinessNode = {
    id: graph.project.id,
    type: 'business',
    position: positions[0],
    data: { label: graph.project.name, role: '当前项目', level: 'core', contact: '项目关系中心' },
  }
  const companies = graph.companies.map<BusinessNode>((company, index) => {
    const relationships = graph.relationships.filter((item) => item.sourceEntityId === company.id || item.targetEntityId === company.id)
    const primary = relationships[0]
    const confirmed = relationships.some((item) => item.confidence === 'confirmed')
    return {
      id: company.id,
      type: 'business',
      position: positions[(index + 1) % positions.length],
      data: {
        label: company.name,
        role: primary ? relationshipTypeLabel(primary.type) : '关系待核验',
        level: confirmed ? 'primary' : 'secondary',
        contact: contactSummary(company, graph.contacts),
      },
    }
  })
  return [project, ...companies]
}

function graphEdges(relationships: EntityRelationship[]): Edge[] {
  return relationships.map((relationship) => ({
    id: relationship.id,
    source: relationship.sourceEntityId,
    target: relationship.targetEntityId,
    label: relationshipTypeLabel(relationship.type),
    animated: relationship.confidence === 'confirmed',
  }))
}

function contactSummary(company: CompanyEntity, contacts: ContactPoint[]): string {
  const contact = contacts.find((item) => item.entityId === company.id)
  if (!contact) return '联系方式待从公开来源提取'
  return contact.personName ? `${contact.personName} · ${contact.value}` : `${contact.label} · ${contact.value}`
}
