import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { DragEvent as ReactDragEvent, FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import applicationIconUrl from './assets/ai-team-logo.png'
import relayEarthUrl from './assets/relay-earth.png'
import relaySaturnUrl from './assets/relay-saturn.png'
import relayStarsUrl from './assets/relay-stars.png'
import './styles.css'
import './premium-theme.css'
import './monochrome-theme.css'
import './reference-match.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'
const AUTH_BASE_URL = API_BASE_URL.replace(/\/api\/v1$/, '')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const FILE_CHUNK_SIZE = 0x8000 // 32KB chunks for base64 encoding
const DEFAULT_OWNER_NAME = '我'
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,64}$/
const TERMINAL_TASK_STATUSES = ['COMPLETED', 'FAILED', 'NEED_HUMAN']
const FALLBACK_TASK_ERROR_MARKERS = ['已自动使用受控模板完成', '系统已自动生成备用产出']
const isTaskActive = (task?: Pick<Task, 'status'> | null) => Boolean(task && !TERMINAL_TASK_STATUSES.includes(task.status))
const isFallbackTaskError = (error?: string) => Boolean(error && FALLBACK_TASK_ERROR_MARKERS.some(marker => error.includes(marker)))
const formatVersion = (value?: string | number | null) => `v${String(value ?? 0).replace(/^v/i, '')}`
const richTextToPlainText = (html: string) => {
  const container = document.createElement('div')
  container.innerHTML = html
  return container.textContent?.replace(/\u00a0/g, ' ').trim() || ''
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeMarkdown = (text: string) => text
  .replace(/\\n/g, '\n')
  .replace(/^(#{1,6})([^\s#])/gm, '$1 $2')
const NAV_ITEMS = [
  { key: 'overview', label: '工作台', icon: 'dashboard' },
  { key: 'context', label: '项目概览', icon: 'briefcase' },
  { key: 'reviews', label: 'Context 变更', icon: 'link' },
  { key: 'tasks', label: '任务与流程', icon: 'workflow' },
  { key: 'artifacts', label: '文件与产出', icon: 'folder' },
  { key: 'members', label: '成员与权限', icon: 'users' },
  { key: 'agents', label: 'Agent 与 Skill', icon: 'robot' },
  { key: 'settings', label: '设置', icon: 'settings' },
] as const

type ViewKey = typeof NAV_ITEMS[number]['key']
type StageKey = string
type AgentKey = string
type MemberRole = 'owner' | 'admin' | 'member'
type WorkflowAgentAssignment = { agent_type: AgentKey; instruction: string; order: number }
type WorkflowStageNode = { id: StageKey; name: string; description: string; column: number; order: number; x?: number; y?: number; member_ids: string[]; reviewer_ids: string[]; collaboration_mode: 'parallel' | 'sequential'; agents: WorkflowAgentAssignment[] }
type WorkflowGraph = { version: number; mode: 'stage-dag'; steps: StageKey[][]; nodes: WorkflowStageNode[]; edges: { from: StageKey; to: StageKey }[] }
type MemberProfile = { mis: string; name: string; avatar_url?: string | null }
type Project = { id: string; name: string; problem: string; goal: string; background: string; owner_name: string; owner_mis: string; members: string[]; member_names?: Record<string, string>; member_profiles?: MemberProfile[]; member_roles: Record<string, MemberRole>; is_public_demo?: boolean; workflow_order?: StageKey[]; workflow_graph?: WorkflowGraph; workflow_version?: number; ready_agents?: AgentKey[]; ready_stages?: StageKey[]; current_stage: StageKey | 'COMPLETED'; status: string; artifact_count?: number; completed_stages?: number; completed_stage_keys?: StageKey[]; skipped_stages?: StageKey[]; pending_context_reviews?: number; context_version?: number; updated_at?: string }
type Message = { id: string; sender_type: string; sender_name: string; sender_mis?: string; content: string; mentions?: string[]; message_type?: string; content_format?: string; stream_status?: 'QUEUED' | 'STREAMING' | 'COMPLETE' | 'FAILED'; reply_to_id?: string; agent_type?: string; created_at: string; updated_at?: string }
type Artifact = { id: string; stage: StageKey; agent_type?: AgentKey; title: string; content: string; status: string; version: number }
type ProjectFile = { id: string; project_id: string; name: string; mime_type: string; size: number; uploaded_by: string; created_at: string }
type Skill = { id: string; name: string; description: string; version: string; source_name: string; file_type: string; size: number; status: string; created_by: string; created_at: string; updated_at: string; preview: string; content?: string; bound_agents: AgentKey[]; priority?: number; is_builtin?: boolean; entrypoint: string; package_format: string; files: { path: string; size: number; kind: 'text' | 'binary' }[] }
type AgentConfiguration = { agent_type: AgentKey; display_name: string; description: string; identity_md: string; soul_md: string; instructions_md: string; version: number; generated: boolean; model_name: string; status: 'ACTIVE' | 'DISABLED'; stage: StageKey | 'REVIEW'; stage_label: string; is_builtin: boolean; updated_at: string; skills: Skill[]; runtime?: { name: string; version: string; api: string }; folder?: { files: string[]; mounted_skills: string[] } }
type AgentChanges = { display_name?: string; description?: string; model_name?: string; status?: string; skill_ids?: string[]; identity_md?: string; soul_md?: string; instructions_md?: string }
type ModelProvider = 'openai_responses' | 'openai_chat' | 'openai_compatible' | 'azure_openai' | 'anthropic' | 'gemini' | 'ollama'
type ModelConfiguration = { provider: ModelProvider; base_url: string; model_name: string; api_version: string; has_api_key: boolean; source: 'user' | 'environment' }
type TaskContext = { context_version?: number; project?: { name: string; goal: string }; workflow_stage?: WorkflowStageNode; approved_artifacts?: { stage: StageKey; agent_type?: AgentKey; title: string; version: number }[]; project_files?: { id: string; name: string; extraction_status: string; truncated: boolean }[]; agent_configuration?: { display_name?: string; model_name?: string; skills?: { id: string; name: string; version: string }[] } }
type Task = { id: string; stage: StageKey | 'REVIEW'; agent_type: AgentKey; instruction: string; status: string; output: string; error: string; runtime?: string; run_metadata?: { runtime?: string; sdk?: string; sdk_version?: string; model?: string; turns?: number; tool_calls?: number; structured_output?: boolean; test_mode?: boolean; demo_fallback?: boolean; source_error?: string; usage?: { total_tokens?: number } }; input_snapshot?: TaskContext; created_at?: string; completed_at?: string }
type ContextImpact = { id: string; source_stage: StageKey; target_stage: StageKey; source_stage_label: string; target_stage_label: string; source_artifact_title: string; target_artifact_title: string; title: string; summary: string; before_text: string; after_text: string; proposed_change: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; decided_by: string; decision_reason: string; created_at: string }
type Stage = { key: StageKey; label: string; agent: AgentKey; color: string }
type IconName = 'ai' | 'arrow-left' | 'bell' | 'briefcase' | 'chevron' | 'clip' | 'dashboard' | 'document' | 'edit' | 'folder' | 'grid' | 'help' | 'link' | 'more' | 'plus' | 'robot' | 'search' | 'send' | 'settings' | 'smile' | 'sparkles' | 'upload' | 'users' | 'workflow'

const AVATAR_ASSET_COUNT = 12
const avatarAssetUrls = import.meta.glob('./assets/avatars/avatar-*.png', { eager: true, import: 'default' }) as Record<string, string>
const stableAssetIndex = (identityKey: string, count: number) => Math.abs([...identityKey].reduce((total, character) => ((total * 31) + character.charCodeAt(0)) | 0, 17)) % count
const avatarIndexFor = (identityKey: string) => stableAssetIndex(identityKey, AVATAR_ASSET_COUNT)
const avatarAssetUrlFor = (avatarIndex: number) => avatarAssetUrls[`./assets/avatars/avatar-${String(avatarIndex).padStart(2, '0')}.png`]

declare global { interface Window { __aiTeamRoot?: Root } }

function RenderInBody({ active, children }: { active: boolean; children: ReactNode }) {
  return active ? createPortal(children, document.body) : <>{children}</>
}

const STAGES: Stage[] = [
  { key: 'CLARIFY', label: '需求澄清', agent: 'clarify', color: 'violet' },
  { key: 'INSIGHT', label: '需求洞察', agent: 'insight', color: 'slate' },
  { key: 'MRD', label: '市场需求（MRD）', agent: 'mrd', color: 'amber' },
  { key: 'SOLUTION', label: '方案设计', agent: 'solution', color: 'orange' },
  { key: 'UX', label: '交互设计', agent: 'ux', color: 'red' },
  { key: 'PRD', label: '产品需求（PRD）', agent: 'prd', color: 'green' },
]
const AGENT_NAMES: Record<AgentKey, string> = { clarify: '需求澄清 Agent', insight: '需求洞察 Agent', mrd: '市场需求 Agent', solution: '方案设计 Agent', ux: '交互设计 Agent', prd: '产品需求 Agent', review: '质量评审 Agent' }
const AGENT_ROLES: Record<AgentKey, string> = { clarify: '梳理需求边界与目标', insight: '分析用户痛点与机会', mrd: '生成市场需求文档', solution: '设计产品解决方案', ux: '制定交互设计方案', prd: '输出产品需求文档', review: '评审完整性与一致性' }
const EMOJI_GROUPS = [
  { label: '常用', items: ['😀', '😄', '😊', '🙂', '😉', '😍', '🥳', '🤔', '😅', '😂'] },
  { label: '反馈', items: ['👍', '👏', '🙌', '👌', '💪', '🙏', '🤝', '👀', '💡', '✅'] },
  { label: '项目', items: ['🚀', '🎯', '🔥', '✨', '💯', '📌', '📝', '📊', '⚠️', '🎉'] },
]

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))
async function resilientFetch(url: string, options: RequestInit = {}, attempts = 4): Promise<Response> {
  const method = (options.method || 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD'
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options)
      if (!canRetry || ![502, 503, 504].includes(response.status) || attempt === attempts - 1) return response
    } catch (error) {
      lastError = error
      if (!canRetry || attempt === attempts - 1) throw error
    }
    await wait(300 * 2 ** attempt)
  }
  throw lastError instanceof Error ? lastError : new Error('服务暂时不可用，请稍后重试')
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await resilientFetch(`${API_BASE_URL}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...options })
  const raw = await response.text()
  let payload: { data?: T; detail?: string | { code?: string; message?: string }; message?: string } = {}
  try { payload = raw ? JSON.parse(raw) : {} } catch { throw new Error(response.ok ? '服务返回了无效响应' : `请求失败（HTTP ${response.status}）`) }
  if (!response.ok) throw new Error(typeof payload.detail === 'object' ? (payload.detail.message || payload.detail.code || `请求失败（HTTP ${response.status}）`) : (payload.detail || payload.message || `请求失败（HTTP ${response.status}）`))
  return payload.data as T
}
const stageMatchesKey = (stage: { key: string; agent?: string }, value: string) => stage.key.toLowerCase() === value.toLowerCase() || stage.agent === value
const stageOf = (key: StageKey | 'COMPLETED') => STAGES.find(stage => stageMatchesKey(stage, String(key)))
const workflowNodes = (project: Project): WorkflowStageNode[] => [...(project.workflow_graph?.nodes || [])].sort((a, b) => a.column - b.column || a.order - b.order)
const workflowStages = (project: Project): Stage[] => {
  const nodes = workflowNodes(project)
  if (nodes.length) return nodes.map(node => ({ key: node.id, label: node.name, agent: node.agents[0]?.agent_type || 'review', color: STAGES.find(stage => stage.agent === node.agents[0]?.agent_type)?.color || 'violet' }))
  return STAGES
}
const stageIndex = (key: Project['current_stage'], stages: { key: string; agent?: string }[] = STAGES) => key === 'COMPLETED' ? stages.length : stages.findIndex(stage => stageMatchesKey(stage, String(key)))
const stageState = (project: Project, index: number, stages: { key: string; agent?: string }[]) => {
  const stage = stages[index]
  if (project.completed_stage_keys?.some(key => stageMatchesKey(stage, key))) return 'done'
  if (project.skipped_stages?.some(key => stageMatchesKey(stage, key))) return 'skipped'
  if (project.ready_stages?.includes(stage.key)) return 'current'
  if (project.current_stage === 'COMPLETED') return 'unexecuted'
  const currentIndex = stageIndex(project.current_stage, stages)
  return index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'next'
}
const formatFileSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`
const fileTone = (file: Pick<ProjectFile, 'name' | 'mime_type'>) => {
  const value = `${file.name} ${file.mime_type}`.toLowerCase()
  if (/pdf/.test(value)) return 'pdf'
  if (/xlsx?|spreadsheet|csv/.test(value)) return 'sheet'
  if (/pptx?|presentation/.test(value)) return 'slides'
  if (/zip|archive/.test(value)) return 'archive'
  return 'document'
}

type UserInfo = { user_id?: string; username?: string; mis?: string; email?: string; name?: string; avatar_url?: string | null; auth_provider?: 'local' }

function App() {
  const [user, setUser] = useState<UserInfo | null | undefined>(undefined)
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [contextImpacts, setContextImpacts] = useState<ContextImpact[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [agentConfigurations, setAgentConfigurations] = useState<AgentConfiguration[]>([])
  const [task, setTask] = useState<Task | null>(null)
  const [view, setView] = useState<ViewKey>('overview')
  const [homeSection, setHomeSection] = useState<'projects' | 'agents'>('projects')
  const [homeProjectView, setHomeProjectView] = useState<'home' | 'projects'>('home')
  const [createOpen, setCreateOpen] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [notice, setNotice] = useState('')
  const [rejectingArtifact, setRejectingArtifact] = useState<Artifact | null>(null)
  const [projectAction, setProjectAction] = useState<{ kind: 'skip' | 'finish'; stage?: StageKey } | null>(null)
  const [agentNotificationsEnabled, setAgentNotificationsEnabled] = useState(true)
  const currentStage = useMemo(() => project ? workflowStages(project).find(stage => stage.key === project.current_stage) : undefined, [project])
  const approvedCount = artifacts.filter(item => item.status === 'APPROVED').length
  const memberProfiles = useMemo<MemberProfile[]>(() => {
    if (!project) return []
    const known = new Map((project.member_profiles || []).map(profile => [profile.mis, profile]))
    const ids = [...new Set([project.owner_mis || project.owner_name, ...project.members])].filter(Boolean)
    return ids.map(mis => {
      const profile = known.get(mis)
      const name = profile?.name || project.member_names?.[mis] || (mis === project.owner_mis ? project.owner_name : '') || mis
      return { mis, name, avatar_url: profile?.avatar_url }
    })
  }, [project])
  const showError = (error: unknown) => setNotice(error instanceof Error ? error.message : '操作失败，请稍后重试')

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
  }, [view, project?.id])

  const loadProjects = () => request<Project[]>('/projects').then(setProjects).catch(showError)
  const loadAgentSystem = async () => {
    const [nextAgents, nextSkills] = await Promise.all([
      request<AgentConfiguration[]>('/agent-configurations'),
      request<Skill[]>('/skills'),
    ])
    setAgentConfigurations(nextAgents)
    setSkills(nextSkills)
  }

  useEffect(() => {
    resilientFetch(`${AUTH_BASE_URL}/auth/me`, { credentials: 'include' }, 5)
      .then(response => response.ok ? response.json() : null)
      .then(json => setUser(json?.data ?? null))
      .catch(() => setUser(null))
  }, [])

  const logout = async () => {
    try {
      await fetch(`${AUTH_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      // 即使网络请求失败，也结束当前页面的本地登录态，避免继续展示受保护信息。
    }
    setProject(null)
    setUser(null)
  }

  useEffect(() => { if (user) { loadProjects(); loadAgentSystem().catch(showError) } }, [user])
  useEffect(() => { if (project) setAgentNotificationsEnabled(localStorage.getItem(`notify:${project.id}`) !== '0') }, [project?.id])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 2600); return () => window.clearTimeout(timer) }, [notice])

  const loadWorkspace = async (id: string, resetView = true, targetView?: ViewKey) => {
    try {
      const [nextProject, nextMessages, nextArtifacts, nextFiles, nextImpacts, nextTasks] = await Promise.all([request<Project>(`/projects/${id}`), request<Message[]>(`/projects/${id}/messages`), request<Artifact[]>(`/projects/${id}/artifacts`), request<ProjectFile[]>(`/projects/${id}/files`), request<ContextImpact[]>(`/projects/${id}/context-impacts`), request<Task[]>(`/projects/${id}/agent-tasks`)])
      setProject(nextProject); setMessages(nextMessages); setArtifacts(nextArtifacts); setFiles(nextFiles); setContextImpacts(nextImpacts); setTasks(nextTasks)
      setTask(nextTasks.find(item => !TERMINAL_TASK_STATUSES.includes(item.status)) || nextTasks[0] || null)
      if (targetView) setView(targetView)
      else if (resetView) setView('overview')
    } catch (error) { showError(error) }
  }
  useEffect(() => {
    if (!user) return
    const params = new URLSearchParams(window.location.search); const projectId = params.get('project'); const targetView = params.get('view') as ViewKey | null
    if (projectId) loadWorkspace(projectId).then(() => { if (targetView && NAV_ITEMS.some(item => item.key === targetView)) setView(targetView) })
  }, [user?.mis])
  useEffect(() => {
    if (!project?.id || !user) return
    const cursor = messages.reduce((latest, item) => item.updated_at && item.updated_at > latest ? item.updated_at : latest, '')
    const stream = new EventSource(`${API_BASE_URL}/projects/${project.id}/message-events?${new URLSearchParams({ after: cursor })}`, { withCredentials: true })
    stream.addEventListener('message', event => {
      const incoming = JSON.parse((event as MessageEvent).data) as Message
      setMessages(current => [...current.filter(item => item.id !== incoming.id), incoming].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
    })
    return () => stream.close()
  }, [project?.id, user?.mis])
  const trackTask = (taskId: string, projectId: string) => {
    const poll = async () => {
      try {
        const next = await request<Task>(`/agent-tasks/${taskId}`); setTask(next)
        if (TERMINAL_TASK_STATUSES.includes(next.status)) await loadWorkspace(projectId, false)
        else window.setTimeout(poll, 800)
      } catch (error) { showError(error) }
    }
    window.setTimeout(poll, 500)
  }
  const startTask = async (agentType: AgentKey, customInstruction?: string, stageId?: StageKey) => {
    if (!project) return
    try {
      const taskStage = STAGES.find(stage => stage.agent === agentType)
      const activeStages = workflowStages(project)
      const isRevision = taskStage ? stageIndex(taskStage.key, activeStages) < stageIndex(project.current_stage, activeStages) : false
      const agentName = agentConfigurations.find(agent => agent.agent_type === agentType)?.display_name || AGENT_NAMES[agentType] || agentType
      const instruction = customInstruction || (isRevision ? `基于最新共享 Context 更新${agentName}的阶段产出，并明确本次变更点及跨阶段影响。` : `基于当前项目上下文完成${agentName}，明确事实、假设和待确认内容。`)
      const result = await request<{ task_id: string; status: string; created: boolean }>(`/projects/${project.id}/agent-tasks`, { method: 'POST', body: JSON.stringify({ agent_type: agentType, stage_id: stageId, instruction, request_id: crypto.randomUUID() }) })
      const nextTask: Task = { id: result.task_id, stage: (stageId || taskStage?.key || 'REVIEW') as Task['stage'], agent_type: agentType, instruction, status: result.status, output: '', error: '', created_at: new Date().toISOString(), input_snapshot: { context_version: project.context_version || 0, project: { name: project.name, goal: project.goal }, approved_artifacts: artifacts.filter(item => item.status === 'APPROVED').map(item => ({ stage: item.stage, agent_type: item.agent_type, title: item.title, version: item.version })) } }
      setTask(nextTask); setTasks(items => [nextTask, ...items.filter(item => item.id !== nextTask.id)])
      if (!result.created) setNotice('该任务已经在执行，已为你定位到当前运行记录')
      trackTask(result.task_id, project.id)
    } catch (error) { showError(error) }
  }
  const runReadyTasks = async () => {
    if (!project) return
    try {
      const result = await request<{ task_ids: string[]; agents: string[] }>(`/projects/${project.id}/agent-tasks/run-ready`, { method: 'POST', body: JSON.stringify({}) })
      if (!result.task_ids.length) { setNotice('当前就绪节点已经在执行或暂无可执行节点'); return }
      setNotice(`已并行启动 ${result.task_ids.length} 个 Agent`)
      result.task_ids.forEach(taskId => trackTask(taskId, project.id))
      await loadWorkspace(project.id, false)
    } catch (error) { showError(error) }
  }
  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    try {
      const members = String(form.get('members')).split(/[，,]/).map(item => item.trim().toLowerCase()).filter(Boolean)
      const invalidUsername = members.find(item => !USERNAME_PATTERN.test(item))
      if (invalidUsername) throw new Error(`「${invalidUsername}」不是有效用户名`)
      // owner 信息由后端从 session 自动填入
      const created = await request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name: form.get('name'), problem: form.get('problem'), goal: form.get('goal'), background: form.get('background'), members }) })
      setCreateOpen(false); loadProjects(); await loadWorkspace(created.id)
    } catch (error) { showError(error) }
  }
  const updateProject = async (changes: Partial<Pick<Project, 'name' | 'problem' | 'goal' | 'background' | 'members'>>) => {
    if (!project) return
    const updated = await request<Project>(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(changes) })
    await loadWorkspace(updated.id, false); loadProjects()
  }
  const saveWorkflow = async (graph: WorkflowGraph) => {
    if (!project) return
    const updated = await request<Project>(`/projects/${project.id}/workflow`, { method: 'PATCH', body: JSON.stringify({ graph }) })
    await loadWorkspace(updated.id, false); loadProjects(); setNotice('流程阶段、成员和 Agent 编排已保存')
  }
  const uploadFile = async (file: File) => {
    if (!project) return
  if (file.size > MAX_FILE_SIZE) throw new Error('单个文件不能超过 5MB')
  const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
  for (let index = 0; index < bytes.length; index += FILE_CHUNK_SIZE) binary += String.fromCharCode(...bytes.subarray(index, index + FILE_CHUNK_SIZE))
    await request<ProjectFile>(`/projects/${project.id}/files`, { method: 'POST', body: JSON.stringify({ name: file.name, mime_type: file.type || 'application/octet-stream', size: file.size, data_base64: btoa(binary) }) })
    await loadWorkspace(project.id, false); setNotice(`已上传《${file.name}》`)
  }
  const downloadFile = (file: ProjectFile) => {
    const link = document.createElement('a'); link.href = `${API_BASE_URL}/files/${file.id}/download`; link.download = file.name
    document.body.appendChild(link); link.click(); link.remove()
  }
  const sendMessage = async (event: FormEvent<HTMLFormElement>, selectedMentions: string[] = [], content = messageText) => {
    event.preventDefault()
    const plainText = richTextToPlainText(content)
    if (!project || !plainText) return
    const agentMentions = agentConfigurations.filter(agent => plainText.toLowerCase().includes(`@${agent.display_name}`.toLowerCase())).map(agent => `agent:${agent.agent_type}`)
    const memberMentions = memberProfiles.filter(member => plainText.includes(`@${member.name}`) && memberProfiles.filter(item => item.name === member.name).length === 1).map(member => `member:${member.mis}`)
    const mentions = [...new Set([...selectedMentions, ...agentMentions, ...memberMentions])]
    try {
      const sent = await request<Message & { agent_replies?: Message[]; agent_notice?: string }>(`/projects/${project.id}/messages`, { method: 'POST', body: JSON.stringify({ content, content_format: 'html', mentions }) })
      const incoming = [sent, ...(sent.agent_replies || [])]
      setMessages(current => [...current.filter(item => !incoming.some(next => next.id === item.id)), ...incoming].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
      if (sent.agent_replies?.length) setNotice('消息已发送；Agent 正在流式回复，你可以继续输入')
      if (sent.agent_notice) setNotice(sent.agent_notice)
    } catch (error) { showError(error) }
  }
  const decide = async (artifact: Artifact, action: 'approve' | 'reject') => {
    if (action === 'reject') { setRejectingArtifact(artifact); return }
    try { await request(`/artifacts/${artifact.id}/approve`, { method: 'POST', body: JSON.stringify({ reason: '' }) }); if (project) await loadWorkspace(project.id, false); setNotice('产出已确认，流程进入下一阶段') } catch (error) { showError(error) }
  }
  const rejectArtifact = async (reason: string) => {
    if (!rejectingArtifact) return
    try { await request(`/artifacts/${rejectingArtifact.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }); setRejectingArtifact(null); if (project) await loadWorkspace(project.id, false); setNotice('已驳回并记录修改要求') } catch (error) { showError(error) }
  }
  const decideContextImpact = async (impact: ContextImpact, action: 'accept' | 'reject') => {
    try {
      // actor 由后端从 session 自动取得
      await request(`/context-impacts/${impact.id}/${action}`, { method: 'POST', body: JSON.stringify({ reason: action === 'reject' ? '本阶段无需同步，继续沿用原版本' : '确认同步到共享 Context' }) })
      if (project) await loadWorkspace(project.id)
      setView('reviews'); setNotice(action === 'accept' ? '已接受变更并生成目标阶段新版本' : '已拒绝变更，目标阶段保留原版本')
    } catch (error) { showError(error) }
  }
  const controlProject = async (reason: string) => {
    if (!project || !projectAction) return
    const path = projectAction.kind === 'skip' ? `/projects/${project.id}/stages/${projectAction.stage}/skip` : `/projects/${project.id}/finish`
    try {
      // actor 由后端从 session 自动取得
      await request(path, { method: 'POST', body: JSON.stringify({ reason, confirmed: true }) })
      setProjectAction(null); await loadWorkspace(project.id, false); setNotice(projectAction.kind === 'skip' ? '当前阶段已跳过并完成留痕' : '项目已结束')
    } catch (error) { showError(error) }
  }
  const uploadSkills = async (selectedFiles: File[]) => {
    if (!selectedFiles.length) return
    if (selectedFiles.length > 100) throw new Error('一个 Skill 文件夹最多包含 100 个文件')
    const files = await Promise.all(selectedFiles.map(async file => {
      if (file.size > 2 * 1024 * 1024) throw new Error(`《${file.name}》超过 2MB`)
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
      for (let index = 0; index < bytes.length; index += FILE_CHUNK_SIZE) binary += String.fromCharCode(...bytes.subarray(index, index + FILE_CHUNK_SIZE))
      return { name: file.webkitRelativePath || file.name, mime_type: file.type || 'application/octet-stream', size: file.size, data_base64: btoa(binary) }
    }))
    const created = await request<Skill[]>('/skills/batch', { method: 'POST', body: JSON.stringify({ files, uploaded_by: user?.mis || user?.name || DEFAULT_OWNER_NAME }) })
    await loadAgentSystem(); setNotice(`已上传 ${created.length} 个 Skill`)
  }
  const saveAgentConfiguration = async (agentType: AgentKey, changes: AgentChanges) => {
    await request<AgentConfiguration>(`/agent-configurations/${agentType}`, { method: 'PATCH', body: JSON.stringify(changes) })
    await loadAgentSystem(); setNotice('Agent 配置已保存，下一次任务开始生效')
  }
  const createAgentConfiguration = async (changes: { display_name: string; description: string; model_name?: string }) => {
    await request<AgentConfiguration>('/agent-configurations', { method: 'POST', body: JSON.stringify(changes) })
    await loadAgentSystem(); setNotice('自定义 Agent 已创建，可加入项目工作流')
  }
  const deleteAgentConfiguration = async (agent: AgentConfiguration) => {
    await request(`/agent-configurations/${agent.agent_type}`, { method: 'DELETE' })
    await loadAgentSystem(); setNotice(`已删除「${agent.display_name}」`)
  }
const archiveSkill = async (skill: Skill) => {
await request(`/skills/${skill.id}`, { method: 'DELETE' }); await loadAgentSystem(); setNotice(`已归档《${skill.name}》`)
}
  const switchHomeSurface = (section: 'projects' | 'agents', target: 'home' | 'projects' = homeProjectView) => {
    const update = () => { setHomeSection(section); if (section === 'projects') setHomeProjectView(target) }
    const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => unknown }
    if (transitionDocument.startViewTransition) transitionDocument.startViewTransition(update)
    else update()
  }
  // 登录态检测中，显示 loading
  if (user === undefined) return <div className="auth-loading"><div className="auth-loading-inner"><span className="auth-loading-dot" /><span className="auth-loading-dot" /><span className="auth-loading-dot" /></div></div>
  if (user === null) return <SignedOutScreen onAuthenticated={setUser} />

  if (!project) return <>{homeSection === 'agents'
    ? <AgentAdminHome agents={agentConfigurations} skills={skills} user={user} onHome={() => switchHomeSurface('projects', 'home')} onProjects={() => switchHomeSurface('projects', 'projects')} onCreate={() => setCreateOpen(true)} onUpload={uploadSkills} onSave={saveAgentConfiguration} onCreateAgent={createAgentConfiguration} onDeleteAgent={deleteAgentConfiguration} onArchive={archiveSkill} onNotice={setNotice} />
    : <ProjectHome projects={projects} agents={agentConfigurations} skills={skills} homeView={homeProjectView} onHomeView={target => switchHomeSurface('projects', target)} onCreate={() => setCreateOpen(true)} onAgents={() => switchHomeSurface('agents')} onOpen={(id, targetView) => loadWorkspace(id, true, targetView)} user={user} onLogout={logout} />}
    {createOpen && <CreateModal close={() => setCreateOpen(false)} submit={createProject} />}<Toast text={notice} /></>
  return <div className="app-shell">
    <GlobalHeader project={project} messages={messages} artifacts={artifacts} files={files} user={user} pendingArtifacts={agentNotificationsEnabled ? artifacts.filter(item => item.status === 'PENDING_REVIEW').length : 0} pendingReviews={contextImpacts.filter(item => item.status === 'PENDING').length} onBack={() => { setProject(null); setHomeSection('projects'); loadProjects() }} onCreate={() => setCreateOpen(true)} onView={setView} onNotice={setNotice} onLogout={logout} />
    <Sidebar project={project} projects={projects} active={view} approvedCount={approvedCount} contextReviewCount={contextImpacts.filter(item => item.status === 'PENDING').length} onView={setView} onOpen={loadWorkspace} onAllProjects={() => { setProject(null); setHomeSection('projects'); loadProjects() }} />
    <main className="page">
      {view === 'overview' && <TaskCenter project={project} workflow={<TasksPage display="canvas" project={project} agents={agentConfigurations} task={task} tasks={tasks} onRun={startTask} onRunReady={runReadyTasks} onSaveWorkflow={saveWorkflow} onSkip={stage => setProjectAction({ kind: 'skip', stage })} onFinish={() => setProjectAction({ kind: 'finish' })} onNotice={setNotice} />} agents={agentConfigurations} messages={messages} artifacts={artifacts} files={files} contextImpacts={contextImpacts} task={task} currentStage={currentStage} members={memberProfiles} messageText={messageText} onMessage={setMessageText} onSend={sendMessage} onRun={startTask} onDecision={decide} onView={setView} onUpload={uploadFile} onDownload={downloadFile} onNotice={setNotice} />}
      {view === 'agents' && <section className="workspace-agent-skill surface-transition"><AgentConfigurationPage agents={agentConfigurations} skills={skills} onUpload={uploadSkills} onSave={saveAgentConfiguration} onCreateAgent={createAgentConfiguration} onDeleteAgent={deleteAgentConfiguration} onArchive={archiveSkill} onNotice={setNotice} /></section>}
      {view === 'context' && <ContextPage project={project} onEdit={() => setView('settings')} />}
      {view === 'reviews' && <ContextReviewPage project={project} artifacts={artifacts} impacts={contextImpacts} onDecision={decideContextImpact} onRun={startTask} />}
      {view === 'tasks' && <TasksPage project={project} agents={agentConfigurations} task={task} tasks={tasks} onRun={startTask} onRunReady={runReadyTasks} onSaveWorkflow={saveWorkflow} onSkip={stage => setProjectAction({ kind: 'skip', stage })} onFinish={() => setProjectAction({ kind: 'finish' })} onNotice={setNotice} />}
      {view === 'artifacts' && <ArtifactsPage project={project} artifacts={artifacts} files={files} onDecision={decide} onRevise={stageId => { const artifact = artifacts.find(item => item.stage === stageId); if (artifact?.agent_type) startTask(artifact.agent_type, undefined, stageId) }} onUpload={uploadFile} onDownload={downloadFile} onNotice={setNotice} />}
      {view === 'members' && <MembersPage project={project} user={user} onUpdate={next => updateProject({ members: next })} onRoleChange={async (mis, role) => { await request(`/projects/${project.id}/members/${mis}/role`, { method: 'PUT', body: JSON.stringify({ mis, role }) }); await loadWorkspace(project.id, false) }} onRemove={async mis => { await request(`/projects/${project.id}/members/${mis}`, { method: 'DELETE' }); await loadWorkspace(project.id, false) }} onNotice={setNotice} />}
      {view === 'settings' && <SettingsPage project={project} onSave={updateProject} onNotificationChange={setAgentNotificationsEnabled} onNotice={setNotice} />}
    </main>
    {createOpen && <CreateModal close={() => setCreateOpen(false)} submit={createProject} />}
    {rejectingArtifact && <RejectArtifactModal artifact={rejectingArtifact} close={() => setRejectingArtifact(null)} submit={rejectArtifact} />}
    {projectAction && <ProjectActionModal action={projectAction} project={project} close={() => setProjectAction(null)} submit={controlProject} />}
    <Toast text={notice} />
  </div>
}

function SignedOutScreen({ onAuthenticated }: { onAuthenticated: (user: UserInfo) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setError('')
    const form = new FormData(event.currentTarget)
    const body = mode === 'login'
      ? { identifier: String(form.get('identifier') || '').trim(), password: String(form.get('password') || '') }
      : { username: String(form.get('username') || '').trim(), email: String(form.get('email') || '').trim(), display_name: String(form.get('display_name') || '').trim(), password: String(form.get('password') || '') }
    try {
      const response = await fetch(`${AUTH_BASE_URL}/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.detail === 'INVALID_CREDENTIALS' ? '用户名、邮箱或密码不正确' : payload.detail === 'USERNAME_OR_EMAIL_ALREADY_EXISTS' ? '用户名或邮箱已被注册' : '操作失败，请检查填写内容')
      onAuthenticated(payload.data)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '网络连接失败') } finally { setSubmitting(false) }
  }
  return <main className="signed-out-screen"><section className="signed-out-card auth-card" aria-labelledby="signed-out-title"><span className="signed-out-icon"><AppIcon size={42} /></span><p>AI TEAM</p><h1 id="signed-out-title">{mode === 'login' ? '登录你的工作台' : '创建一个新账号'}</h1><span>{mode === 'login' ? '使用用户名或邮箱继续。' : '注册后即可创建项目并配置自己的模型连接。'}</span><div className="auth-mode-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>登录</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>注册</button></div><form className="local-auth-form" onSubmit={submit}>{mode === 'login' ? <label>用户名或邮箱<input name="identifier" required autoComplete="username" /></label> : <><label>用户名<input name="username" required minLength={2} maxLength={64} pattern="[A-Za-z0-9._-]+" autoComplete="username" placeholder="仅支持字母、数字、点、横线和下划线" /></label><label>显示名称<input name="display_name" required maxLength={80} autoComplete="name" /></label><label>邮箱<input name="email" required type="email" autoComplete="email" /></label></>}<label>密码<input name="password" required type="password" minLength={mode === 'register' ? 8 : 1} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>{error && <small className="auth-error">{error}</small>}<button className="primary-button" disabled={submitting}>{submitting ? '请稍候…' : mode === 'login' ? '登录' : '创建账号'}</button></form></section></main>
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    ai: <><path d="M8 7v10M12 4v16M16 8v8" /><path d="M5 4.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" /></>,
    'arrow-left': <path d="m15 18-6-6 6-6" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    briefcase: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M8 6V4h8v2M3 11h18M10 11v2h4v-2" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    clip: <path d="m21 12-8.8 8.8a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 1 1-2.8-2.8l8.5-8.5" />,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    document: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></>,
    edit: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" /><path d="m14 7 3 3" /></>,
    folder: <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 0 1 4.8 1c0 2-2.5 2-2.5 4M12 18h.01" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    robot: <><rect x="4" y="7" width="16" height="12" rx="4" /><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    send: <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
    sparkles: <><path d="m12 3 1 3.2L16 8l-3 1.8L12 13l-1-3.2L8 8l3-1.8z" /><path d="m18 14 .6 1.8 1.7 1-.7.4L18 20l-.6-1.8-1.7-1 1.7-1zM5 13l.6 1.7 1.6.9-1.6.9L5 18l-.6-1.5-1.6-.9 1.6-.9z" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 14v5h14v-5" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
    workflow: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" /><path d="M9 6h6M18 9v3l-6 3-6-3V9" /></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function AppIcon({ size = 24 }: { size?: number }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className="app-icon app-icon-fallback"><Icon name="ai" size={Math.max(15, Math.round(size * .68))} /></span>
    : <img className="app-icon" src={applicationIconUrl} width={size} height={size} alt="AI Team" onError={() => setFailed(true)} />
}

function userLabel(user?: UserInfo | null, fallback = '当前用户') {
  const name = user?.name?.trim()
  if (name) return name
  const mis = user?.mis?.trim()
  if (mis && !/^(local[-_]?dev|dev|user)$/i.test(mis)) return mis
  return fallback
}

function InitialAvatar({ mis, fallback, small = false, className = '' }: { mis?: string; fallback: string; small?: boolean; className?: string }) {
  const label = fallback.trim() || mis?.trim() || '?'
  return <i className={`avatar${small ? ' small' : ''} ${className}`.trim()} title={label}>
    {label.slice(0, 1).toUpperCase()}
  </i>
}

function UserAvatar({ user, fallback = '当前用户', small = false }: { user?: UserInfo | null; fallback?: string; small?: boolean }) {
  return <InitialAvatar mis={user?.mis} fallback={userLabel(user, fallback)} small={small} className="user-avatar" />
}

function GlobalHeader({ project, messages, artifacts, files, user, pendingArtifacts, pendingReviews, onBack, onCreate, onView, onNotice, onLogout }: { project: Project; messages: Message[]; artifacts: Artifact[]; files: ProjectFile[]; user?: UserInfo | null; pendingArtifacts: number; pendingReviews: number; onBack: () => void; onCreate: () => void; onView: (view: ViewKey) => void; onNotice: (text: string) => void; onLogout: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<'notifications' | 'help' | 'profile' | null>(null)
  const [favorite, setFavorite] = useState(() => localStorage.getItem(`favorite:${project.id}`) === '1')
  useEffect(() => { setFavorite(localStorage.getItem(`favorite:${project.id}`) === '1'); setQuery(''); setMenu(null) }, [project.id])
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="搜索"]')?.focus() } }; window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut) }, [])
  const searchResults = query.trim() ? [
    ...(`${project.name} ${project.problem} ${project.goal}`.toLowerCase().includes(query.toLowerCase()) ? [{ key: project.id, label: project.name, detail: '项目信息', view: 'context' as ViewKey }] : []),
    ...files.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 4).map(item => ({ key: item.id, label: item.name, detail: '项目资料', view: 'artifacts' as ViewKey })),
    ...artifacts.filter(item => `${item.title} ${item.content}`.toLowerCase().includes(query.toLowerCase())).slice(0, 4).map(item => ({ key: item.id, label: item.title, detail: '项目产出', view: 'artifacts' as ViewKey })),
    ...messages.filter(item => `${item.sender_name} ${item.content}`.toLowerCase().includes(query.toLowerCase())).slice(-4).map(item => ({ key: item.id, label: item.content.slice(0, 42), detail: item.sender_name, view: 'overview' as ViewKey })),
  ] : []
  const notificationCount = pendingArtifacts + pendingReviews
  const toggleFavorite = () => { const next = !favorite; setFavorite(next); localStorage.setItem(`favorite:${project.id}`, next ? '1' : '0'); onNotice(next ? '已收藏当前项目' : '已取消收藏') }
  return <header className="global-header">
    <button className="brand" onClick={onBack}><span className="brand-mark"><AppIcon size={24} /></span><strong>AI Team</strong><em>v2.1.0</em></button>
    <div className="project-crumb"><button onClick={onBack} aria-label="返回项目列表"><Icon name="arrow-left" size={17} /></button><ProjectGlyph project={project} /><b>{project.name}</b><Icon name="chevron" size={13} /><button className={`star ${favorite ? 'active' : ''}`} aria-label={favorite ? '取消收藏' : '收藏项目'} onClick={toggleFavorite}>{favorite ? '★' : '☆'}</button></div>
    <div className="header-actions"><div className="header-search"><label className="search-box"><Icon name="search" size={16} /><input aria-label="搜索" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目 / 文件 / 消息" /><kbd>⌘ K</kbd></label>{query && <div className="header-popover search-results"><header><b>搜索结果</b><span>{searchResults.length} 条</span></header>{searchResults.map(item => <button key={item.key} onClick={() => { onView(item.view); setQuery('') }}><b>{item.label}</b><span>{item.detail}</span></button>)}{searchResults.length === 0 && <p>没有找到匹配内容</p>}</div>}</div><button className="primary-button create-button" onClick={onCreate}><Icon name="plus" size={15} />新建</button><div className="header-menu-wrap"><button className={`icon-button ${notificationCount ? 'has-dot' : ''}`} aria-label="通知" onClick={() => setMenu(menu === 'notifications' ? null : 'notifications')}><Icon name="bell" size={19} />{notificationCount > 0 && <i>{notificationCount}</i>}</button>{menu === 'notifications' && <div className="header-popover"><header><b>待处理通知</b><span>{notificationCount}</span></header>{pendingArtifacts > 0 && <button onClick={() => { onView('artifacts'); setMenu(null) }}><b>{pendingArtifacts} 份产出待确认</b><span>进入文件与产出处理</span></button>}{pendingReviews > 0 && <button onClick={() => { onView('reviews'); setMenu(null) }}><b>{pendingReviews} 条 Context 变更</b><span>进入变更审核</span></button>}{notificationCount === 0 && <p>当前没有待处理事项</p>}</div>}</div><div className="header-menu-wrap"><button className="icon-button" aria-label="帮助" onClick={() => setMenu(menu === 'help' ? null : 'help')}><Icon name="help" size={19} /></button>{menu === 'help' && <div className="header-popover help-popover"><header><b>快速使用</b></header><p>1. 在工作台 @Agent 进行即时对话</p><p>2. 正式产出请在任务页点击执行并确认</p><p>3. 在 Context 变更中审核跨阶段同步</p><button onClick={() => { onView('tasks'); setMenu(null) }}><b>查看完整流程</b><span>打开任务与流程</span></button></div>}</div><div className="header-menu-wrap"><button className="profile-button" onClick={() => setMenu(menu === 'profile' ? null : 'profile')}><UserAvatar user={user} fallback={project.owner_name || '当前用户'} /><span>{userLabel(user, project.owner_name || '当前用户')}</span><span className="down">⌄</span></button>{menu === 'profile' && <div className="header-popover profile-popover"><header><b>{userLabel(user, project.owner_name || '当前用户')}</b><span>{user?.email || user?.username || '项目负责人'}</span></header><button onClick={() => { onView('members'); setMenu(null) }}><b>成员与权限</b><span>管理协作成员</span></button><button onClick={() => { onView('settings'); setMenu(null) }}><b>项目设置</b><span>编辑项目信息</span></button><button onClick={onLogout}><b>退出登录</b><span>清除当前会话</span></button></div>}</div></div>
  </header>
}

function Sidebar({ project, projects, active, approvedCount, contextReviewCount, onView, onOpen, onAllProjects }: { project: Project; projects: Project[]; active: ViewKey; approvedCount: number; contextReviewCount: number; onView: (view: ViewKey) => void; onOpen: (id: string) => void; onAllProjects: () => void }) {
  const [switchOpen, setSwitchOpen] = useState(false)
  const recentProjects = projects.filter(item => item.id !== project.id).slice(0, 3)
  const activeStages = workflowStages(project)
  return <aside className="sidebar">
    <div className="side-scroll">
      <div className="side-label"><span>项目空间</span><span>⌃</span></div>
      <button className="workspace-switch" onClick={() => setSwitchOpen(value => !value)}><ProjectGlyph project={project} /><strong>{project.name}</strong><span>{switchOpen ? '⌃' : '⌄'}</span></button>
      {switchOpen && <div className="workspace-switch-menu">{projects.map(item => <button className={item.id === project.id ? 'active' : ''} key={item.id} onClick={() => { onOpen(item.id); setSwitchOpen(false) }}><ProjectGlyph project={item} /><span>{item.name}</span>{item.id === project.id && <i>当前</i>}</button>)}</div>}
      <nav>{NAV_ITEMS.map(item => {
        const isDashboardDraggable = item.key !== 'overview' && item.key !== 'agents'
        return <button key={item.key} draggable={isDashboardDraggable} title={isDashboardDraggable ? `${item.label} · 可拖入工作台` : item.label} className={`${active === item.key ? 'active' : ''} ${isDashboardDraggable ? 'dashboard-draggable-nav' : ''}`} onDragStart={event => { if (!isDashboardDraggable) return; event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('application/x-dashboard-widget', item.key); event.dataTransfer.setData('text/plain', item.label) }} onClick={() => onView(item.key)}><Icon name={item.icon as IconName} size={17} />{item.label}{item.key === 'reviews' && contextReviewCount > 0 ? <em className="review-count">{contextReviewCount}</em> : item.key === 'artifacts' && approvedCount > 0 ? <em>{approvedCount}</em> : null}</button>
      })}</nav>
      <div className="side-divider" />
      <div className="side-label"><span>我的项目</span><span>⌃</span></div>
      <div className="recent-projects">
        <button className="current-project" onClick={() => onOpen(project.id)}><ProjectGlyph project={project} /><span>{project.name}</span><i>当前</i></button>
        {recentProjects.map(item => <button key={item.id} onClick={() => onOpen(item.id)}><ProjectGlyph project={item} /><span>{item.name}</span></button>)}
        {recentProjects.length === 0 && <p>暂无其他项目</p>}
      </div>
      <button className="all-projects" onClick={onAllProjects}>查看全部项目 <Icon name="chevron" size={13} /></button>
    </div>
    <div className="agent-status"><b>AI 协作状态</b><span>{project.current_stage === 'COMPLETED' ? '全部流程已完成' : `${activeStages.length} 个 Agent 已编排`}</span><div className="agent-stack">{activeStages.slice(0, 5).map(stage => <AgentBadge key={stage.key} agent={stage.agent} color={stage.color} size="small" />)}{activeStages.length > 5 && <i>+{activeStages.length - 5}</i>}</div><button onClick={() => onView('tasks')}>查看 Agent 列表 <Icon name="chevron" size={12} /></button></div>
  </aside>
}

const PROJECT_LOGO_PRESETS = [
  { tone: 'violet', label: '星芒', mark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z" /><path d="m18.5 16 .7 2.2 2.3.7-2.3.7-.7 2.2-.7-2.2-2.3-.7 2.3-.7z" /></> },
  { tone: 'ocean', label: '轨道', mark: <><circle cx="12" cy="12" r="3.4" /><path d="M3.4 12c1.7-4.1 5-6.2 8.6-6.2s6.9 2.1 8.6 6.2c-1.7 4.1-5 6.2-8.6 6.2S5.1 16.1 3.4 12Z" /></> },
  { tone: 'coral', label: '上升', mark: <><path d="M5 18V6m0 12h14" /><path d="m8 15 4-4 3 2 5-6" /><path d="M16 7h4v4" /></> },
  { tone: 'amber', label: '罗盘', mark: <><circle cx="12" cy="12" r="8" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></> },
  { tone: 'forest', label: '协作', mark: <><circle cx="6.5" cy="8" r="2" /><circle cx="17.5" cy="8" r="2" /><circle cx="12" cy="17" r="2" /><path d="m8.2 9.2 2.4 5.7m5.2-5.7-2.4 5.7m-4.7-6.9h6.6" /></> },
  { tone: 'plum', label: '模块', mark: <><rect x="4" y="4" width="6" height="6" rx="1.4" /><rect x="14" y="4" width="6" height="6" rx="1.4" /><rect x="9" y="14" width="6" height="6" rx="1.4" /><path d="M10 7h4m4 3v2l-6 2-6-2v-2" /></> },
] as const

function ProjectGlyph({ project }: { project: Pick<Project, 'id' | 'name'> }) {
  const preset = PROJECT_LOGO_PRESETS[stableAssetIndex(`project:${project.id || project.name}`, PROJECT_LOGO_PRESETS.length)]
  return <i className={`project-glyph project-logo-${preset.tone}`} title={`${preset.label}项目 Logo`} aria-hidden="true"><svg className="project-glyph__mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{preset.mark}</svg></i>
}
function Avatar({ name, mis, small = false }: { name: string; mis?: string; small?: boolean }) {
  return <InitialAvatar mis={mis || name} fallback={name} small={small} />
}
function AgentSketch({ agent, identityKey, size = 34 }: { agent: AgentKey; identityKey?: string; size?: number }) {
  const avatarIndex = avatarIndexFor(identityKey || `agent:${agent}`) + 1
  const avatarUrl = avatarAssetUrlFor(avatarIndex)
  return <img className="agent-sketch" width={size} height={size} src={avatarUrl} alt="" aria-hidden="true" data-avatar-index={avatarIndex} />
}

function AgentBadge({ agent, color, size }: { agent: AgentKey; color?: string; size?: 'small' | 'large' }) { return <i className={`agent-badge ${color || 'violet'} ${size || ''}`}><AgentSketch agent={agent} size={size === 'large' ? 36 : size === 'small' ? 28 : 32} /><span /></i> }

type DashboardCoreWidgetKey = 'workflow' | 'conversation' | 'resources'
type DashboardAddonWidgetKey = Exclude<ViewKey, 'overview' | 'agents'>
type DashboardWidgetKey = DashboardCoreWidgetKey | DashboardAddonWidgetKey
type DashboardWidgetLayout = { key: DashboardWidgetKey; x: number; y: number; w: number; h: number; z: number }
const DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetLayout[] = [
  { key: 'workflow', x: 0, y: 0, w: 100, h: 41.7, z: 1 },
  { key: 'conversation', x: 0, y: 41.8, w: 54.8, h: 58.2, z: 2 },
  { key: 'resources', x: 55.3, y: 41.8, w: 44.7, h: 58.2, z: 3 },
]
const LEGACY_DEFAULT_DASHBOARD_LAYOUT: DashboardWidgetLayout[] = [
  { key: 'workflow', x: 0, y: 0, w: 100, h: 41.7, z: 1 },
  { key: 'conversation', x: 0, y: 41.8, w: 54.8, h: 58.2, z: 2 },
  { key: 'resources', x: 55.3, y: 41.8, w: 39.5, h: 58.2, z: 3 },
]
const isLegacyDefaultDashboardLayout = (layout: DashboardWidgetLayout[]) => layout.length === LEGACY_DEFAULT_DASHBOARD_LAYOUT.length && LEGACY_DEFAULT_DASHBOARD_LAYOUT.every(reference => {
  const item = layout.find(value => value.key === reference.key)
  return Boolean(item && item.x === reference.x && item.y === reference.y && item.w === reference.w && item.h === reference.h)
})
const COMPACT_DASHBOARD_LAYOUT: DashboardWidgetLayout[] = [
  { key: 'workflow', x: 0, y: 0, w: 100, h: 25, z: 1 },
  { key: 'conversation', x: 0, y: 26, w: 64, h: 29, z: 2 },
  { key: 'resources', x: 65, y: 26, w: 35, h: 29, z: 3 },
]
const dashboardAddonSlot = (index: number) => ({ x: (index % 3) * 33.5, y: 56 + Math.floor(index / 3) * 22, w: 32.5, h: 21 })

const CORE_DASHBOARD_WIDGETS: DashboardWidgetKey[] = ['workflow', 'conversation', 'resources']
const DASHBOARD_ADDONS = NAV_ITEMS.filter(item => item.key !== 'overview' && item.key !== 'agents') as readonly (typeof NAV_ITEMS[number] & { key: DashboardAddonWidgetKey })[]

function WorkspaceDashboard({ projectId, widgets }: { projectId: string; widgets: { key: DashboardWidgetKey; title: string; content: ReactNode }[] }) {
  const storageKey = `ai-team-dashboard-layout:reference-v5:${projectId}`
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [layout, setLayout] = useState<DashboardWidgetLayout[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as DashboardWidgetLayout[] | null
      const allowed = new Set(widgets.map(item => item.key))
      const valid = saved?.filter(item => allowed.has(item.key) && Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.w) && Number.isFinite(item.h)) || []
      if (isLegacyDefaultDashboardLayout(valid)) return DEFAULT_DASHBOARD_LAYOUT.map(item => ({ ...item }))
      const withCore = DEFAULT_DASHBOARD_LAYOUT.map(fallback => valid.find(item => item.key === fallback.key) || fallback)
      return [...withCore, ...valid.filter(item => !CORE_DASHBOARD_WIDGETS.includes(item.key))]
    } catch { return DEFAULT_DASHBOARD_LAYOUT }
  })
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(layout)) } catch { /* 浏览器禁用本地存储时仍可使用当前布局 */ } }, [layout, storageKey])
  const startPointerAction = (key: DashboardWidgetKey, mode: 'move' | 'resize', event: React.PointerEvent<HTMLButtonElement>) => {
    const surface = surfaceRef.current; const current = layout.find(item => item.key === key)
    if (!surface || !current || window.matchMedia('(max-width: 900px)').matches) return
    event.preventDefault(); event.stopPropagation()
    const bounds = surface.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY; const origin = { ...current }
    setLayout(items => items.map(item => item.key === key ? { ...item, z: Math.max(...items.map(value => value.z), 0) + 1 } : item))
    const move = (pointer: PointerEvent) => {
      const dx = (pointer.clientX - startX) / bounds.width * 100; const dy = (pointer.clientY - startY) / bounds.height * 100
      setLayout(items => items.map(item => {
        if (item.key !== key) return item
        if (mode === 'move') return { ...item, x: Math.max(0, Math.min(100 - origin.w, origin.x + dx)), y: Math.max(0, Math.min(100 - origin.h, origin.y + dy)) }
        return { ...item, w: Math.max(24, Math.min(100 - origin.x, origin.w + dx)), h: Math.max(24, Math.min(100 - origin.y, origin.h + dy)) }
      }))
    }
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); document.body.classList.remove('dashboard-adjusting') }
    document.body.classList.add('dashboard-adjusting'); window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true })
  }
  const addWidget = (key: DashboardAddonWidgetKey, clientX?: number, clientY?: number) => {
    if (layout.some(item => item.key === key)) return
    const surface = surfaceRef.current; const bounds = surface?.getBoundingClientRect()
    const addonCount = layout.filter(item => !CORE_DASHBOARD_WIDGETS.includes(item.key)).length
    const slot = dashboardAddonSlot(addonCount)
    const dropped = bounds && clientX !== undefined && clientY !== undefined
      ? { x: Math.max(0, Math.min(67.5, (clientX - bounds.left) / bounds.width * 100 - 16)), y: Math.max(0, Math.min(79, (clientY - bounds.top) / bounds.height * 100 - 5)), w: 32.5, h: 21 }
      : slot
    setLayout(items => {
      const prepared = addonCount === 0 ? items.map(item => COMPACT_DASHBOARD_LAYOUT.find(core => core.key === item.key) || item) : items
      return [...prepared, { key, ...dropped, z: Math.max(...items.map(item => item.z), 0) + 1 }]
    })
    setLibraryOpen(false)
  }
  const removeWidget = (key: DashboardWidgetKey) => {
    if (CORE_DASHBOARD_WIDGETS.includes(key)) return
    setLayout(items => {
      const remaining = items.filter(item => item.key !== key)
      if (remaining.some(item => !CORE_DASHBOARD_WIDGETS.includes(item.key))) return remaining
      return DEFAULT_DASHBOARD_LAYOUT.map(fallback => ({ ...fallback, z: remaining.find(item => item.key === fallback.key)?.z || fallback.z }))
    })
  }
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDropActive(false)
    const key = event.dataTransfer.getData('application/x-dashboard-widget') as DashboardAddonWidgetKey
    if (DASHBOARD_ADDONS.some(item => item.key === key)) addWidget(key, event.clientX, event.clientY)
  }
  return <section className="workspace-dashboard">
    <header className="dashboard-toolbar"><div className="dashboard-toolbar-actions"><div className="dashboard-library-wrap"><button className={libraryOpen ? 'active' : ''} onClick={() => setLibraryOpen(value => !value)}><Icon name="plus" size={13} />添加组件</button>{libraryOpen && <div className="dashboard-library"><header><b>组件库</b><span>添加后可自由调整</span></header>{DASHBOARD_ADDONS.map(item => { const added = layout.some(value => value.key === item.key); return <button key={item.key} disabled={added} onClick={() => addWidget(item.key)}><Icon name={item.icon as IconName} size={15} /><span><b>{item.label}</b><small>{added ? '已添加到工作台' : '点击添加'}</small></span>{added ? '✓' : '+'}</button> })}</div>}</div><button onClick={() => setLayout(DEFAULT_DASHBOARD_LAYOUT.map(item => ({ ...item })))}>恢复默认布局</button></div></header>
    <div className={`dashboard-surface ${dropActive ? 'drop-active' : ''}`} ref={surfaceRef} onDragOver={event => { if (!event.dataTransfer.types.includes('application/x-dashboard-widget')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true) }} onDragLeave={event => { if (event.currentTarget === event.target) setDropActive(false) }} onDrop={onDrop}>{dropActive && <div className="dashboard-drop-hint"><Icon name="plus" size={20} /><b>放到这里</b><span>松开即可添加为工作台组件</span></div>}{widgets.filter(widget => layout.some(item => item.key === widget.key)).map(widget => { const item = layout.find(value => value.key === widget.key)!; const removable = !CORE_DASHBOARD_WIDGETS.includes(widget.key); return <section className={`dashboard-widget dashboard-widget-${widget.key}`} key={widget.key} style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%`, zIndex: item.z }}><button className="dashboard-widget-handle" aria-label={`拖动${widget.title}`} title={`拖动${widget.title}`} onPointerDown={event => startPointerAction(widget.key, 'move', event)}>⠿ <span>{widget.title}</span></button>{removable && <button className="dashboard-widget-remove" aria-label={`删除${widget.title}组件`} title="从工作台删除" onClick={() => removeWidget(widget.key)}>×</button>}<div className="dashboard-widget-content">{widget.content}</div><button className="dashboard-resize-handle" aria-label={`调整${widget.title}大小`} title={`调整${widget.title}大小`} onPointerDown={event => startPointerAction(widget.key, 'resize', event)} /></section> })}</div>
  </section>
}

function ReferenceRose({ onView }: { onView: (view: ViewKey) => void }) {
  return <aside className="reference-quick-area"><button className="reference-rose" onClick={() => onView('overview')}>ROSE<br />HERE!</button></aside>
}

function TaskCenter({ project, workflow, agents, messages, artifacts, files, contextImpacts, task, currentStage, members, messageText, onMessage, onSend, onRun, onDecision, onView, onUpload, onDownload, onNotice }: { project: Project; workflow: ReactNode; agents: AgentConfiguration[]; messages: Message[]; artifacts: Artifact[]; files: ProjectFile[]; contextImpacts: ContextImpact[]; task: Task | null; currentStage?: Stage; members: MemberProfile[]; messageText: string; onMessage: (text: string) => void; onSend: (event: FormEvent<HTMLFormElement>, mentions?: string[], content?: string) => Promise<void>; onRun: (agent: AgentKey, instruction?: string, stageId?: StageKey) => void; onDecision: (artifact: Artifact, action: 'approve' | 'reject') => void; onView: (view: ViewKey) => void; onUpload: (file: File) => Promise<void>; onDownload: (file: ProjectFile) => void; onNotice: (text: string) => void }) {
  const pendingArtifacts = artifacts.filter(item => item.status === 'PENDING_REVIEW')
  return <><WorkspaceDashboard key={project.id} projectId={project.id} widgets={[
    { key: 'workflow', title: '流程画布', content: workflow },
    { key: 'conversation', title: '对话与协作', content: <ConversationPanel project={project} agents={agents} members={members} messages={messages} task={task} pendingArtifacts={pendingArtifacts} currentStage={currentStage} messageText={messageText} onMessage={onMessage} onSend={onSend} onRun={onRun} onDecision={onDecision} onView={onView} onUpload={onUpload} onNotice={onNotice} /> },
    { key: 'resources', title: '产出与资料', content: <ResourcePanel artifacts={artifacts} files={files} messages={messages} members={members} onView={onView} onUpload={onUpload} onDownload={onDownload} onNotice={onNotice} /> },
    ...DASHBOARD_ADDONS.map(item => ({ key: item.key, title: item.label, content: <DashboardAddonWidget kind={item.key} project={project} artifacts={artifacts} files={files} impacts={contextImpacts} members={members} onOpen={onView} /> })),
  ]} /><ReferenceRose onView={onView} /></>
}

function DashboardAddonWidget({ kind, project, artifacts, files, impacts, members, onOpen }: { kind: DashboardAddonWidgetKey; project: Project; artifacts: Artifact[]; files: ProjectFile[]; impacts: ContextImpact[]; members: MemberProfile[]; onOpen: (view: ViewKey) => void }) {
  const config = NAV_ITEMS.find(item => item.key === kind)!
  const stages = workflowStages(project)
  const pendingImpacts = impacts.filter(item => item.status === 'PENDING')
  const rows: { title: string; detail: string; tone?: string }[] = kind === 'context' ? [
    { title: project.goal || '暂未填写项目目标', detail: '项目目标', tone: 'accent' },
    { title: project.problem || '暂未填写核心问题', detail: '核心问题' },
    { title: `Context ${formatVersion(project.context_version || 0)}`, detail: `${artifacts.filter(item => item.status === 'APPROVED').length} 份已确认产出` },
  ] : kind === 'reviews' ? (pendingImpacts.length ? pendingImpacts.slice(0, 4).map(item => ({ title: item.title, detail: `${item.source_stage_label} → ${item.target_stage_label}`, tone: 'attention' })) : [{ title: 'Context 当前保持一致', detail: '暂无跨阶段变更待确认', tone: 'success' }])
    : kind === 'tasks' ? stages.slice(0, 6).map((stage, index) => ({ title: stage.label, detail: stageState(project, index, stages) === 'done' ? '已完成' : stageState(project, index, stages) === 'current' ? '当前可执行' : '等待前置', tone: stageState(project, index, stages) }))
    : kind === 'artifacts' ? [...artifacts.slice(0, 3).map(item => ({ title: item.title, detail: `${formatVersion(item.version)} · ${item.status === 'APPROVED' ? '已确认' : '待确认'}`, tone: item.status === 'APPROVED' ? 'success' : 'attention' })), ...files.slice(0, Math.max(0, 4 - artifacts.length)).map(item => ({ title: item.name, detail: formatFileSize(item.size) }))]
    : kind === 'members' ? members.slice(0, 5).map(member => ({ title: member.name, detail: member.mis === project.owner_mis ? '项目负责人' : '项目成员', tone: member.mis === project.owner_mis ? 'accent' : '' }))
    : [
      { title: agentNotificationsEnabledLabel(project.id), detail: 'Agent 通知' },
      { title: project.status === 'ACTIVE' ? '进行中' : '已结束', detail: '项目状态', tone: project.status === 'ACTIVE' ? 'success' : '' },
      { title: `${stages.length} 个阶段`, detail: `流程 ${formatVersion(project.workflow_version || 1)}` },
    ]
  return <section className="dashboard-addon-panel"><header><i><Icon name={config.icon as IconName} size={17} /></i><div><span>WORKSPACE WIDGET</span><h3>{config.label}</h3></div><button onClick={() => onOpen(kind)}>打开完整页面<Icon name="chevron" size={13} /></button></header><div className="dashboard-addon-list">{rows.length ? rows.map((row, index) => <article key={`${row.title}-${index}`}><i className={row.tone || ''}>{String(index + 1).padStart(2, '0')}</i><div><b>{row.title}</b><span>{row.detail}</span></div></article>) : <div className="dashboard-addon-empty">暂无内容</div>}</div><footer><span><i />已同步项目最新数据</span><button onClick={() => onOpen(kind)}>查看详情</button></footer></section>
}

function agentNotificationsEnabledLabel(projectId: string) {
  return localStorage.getItem(`notify:${projectId}`) === '0' ? '已关闭' : '已开启'
}

function StageRail({ project, onRun }: { project: Project; onRun: (agent: AgentKey, instruction?: string, stageId?: StageKey) => void }) {
  const stages = workflowStages(project)
  if (stages.length === 0) return null
  return <section className="stage-rail">{stages.map((stage, index) => {
    const state = stageState(project, index, stages)
    return <div className="stage-wrap" key={stage.key}><button disabled={state === 'next'} className={`stage-node ${state}`} onClick={() => onRun(stage.agent, undefined, stage.key)}><i>{index + 1}</i><span><b>{stage.label}</b><small>{state === 'skipped' ? '已跳过' : state === 'done' ? '已完成' : state === 'unexecuted' ? '未执行 · 可补做' : state === 'current' ? '进行中' : '待开始'}</small></span>{(state === 'current' || state === 'unexecuted') && <Icon name="robot" size={15} />}</button>{index < stages.length - 1 && <Icon name="chevron" size={16} />}</div>
  })}</section>
}

function PanelHead({ title, tabs, activeTab = 0, onTab, action }: { title?: string; tabs?: string[]; activeTab?: number; onTab?: (index: number) => void; action?: ReactNode }) {
  return <header className="panel-head"><div>{tabs ? tabs.map((tab, index) => <button type="button" className={activeTab === index ? 'active' : ''} key={tab} onClick={() => onTab?.(index)}>{tab}</button>) : <b>{title}</b>}</div>{action}</header>
}

function ConversationPanel({ project, agents, members, messages, task, pendingArtifacts, currentStage, messageText, onMessage, onSend, onRun, onDecision, onView, onUpload, onNotice }: { project: Project; agents: AgentConfiguration[]; members: MemberProfile[]; messages: Message[]; task: Task | null; pendingArtifacts: Artifact[]; currentStage?: Stage; messageText: string; onMessage: (text: string) => void; onSend: (event: FormEvent<HTMLFormElement>, mentions?: string[], content?: string) => Promise<void>; onRun: (agent: AgentKey, instruction?: string, stageId?: StageKey) => void; onDecision: (artifact: Artifact, action: 'approve' | 'reject') => void; onView: (view: ViewKey) => void; onUpload: (file: File) => Promise<void>; onNotice: (text: string) => void }) {
  const [mentionOpen, setMentionOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedMentions, setSelectedMentions] = useState<{ ref: string; label: string }[]>([])
  const inputRef = useRef<HTMLDivElement>(null)
  const attachmentRef = useRef<HTMLInputElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  const agentOptions = agents.filter(agent => agent.status === 'ACTIVE')
  const mentionLabels = [...members.map(member => member.name), ...agentOptions.map(agent => agent.display_name)]
  const getMentionQuery = (text: string) => {
    const at = text.lastIndexOf('@')
    if (at < 0) return null
    const tail = text.slice(at + 1)
    if (mentionLabels.some(label => tail.startsWith(`${label} `))) return null
    if (tail.length > 32 || /[\n，。！？,]/.test(tail)) return null
    return tail.trim().toLowerCase()
  }
  const draftText = richTextToPlainText(messageText)
  const mentionQuery = getMentionQuery(draftText) || ''
  const filteredMembers = members.filter(member => member.name.toLowerCase().includes(mentionQuery))
  const filteredAgents = agentOptions.filter(agent => `${agent.display_name} ${agent.description}`.toLowerCase().includes(mentionQuery))
  const syncEditor = () => onMessage(inputRef.current?.innerHTML || '')
  const focusEditor = () => window.requestAnimationFrame(() => inputRef.current?.focus())
  const insertAtCursor = (value: string) => {
    inputRef.current?.focus()
    document.execCommand('insertText', false, value)
    syncEditor()
  }
  const removeMention = (label: string, ref: string) => {
    const editor = inputRef.current
    if (!editor) return
    const pattern = new RegExp(`@${escapeRegExp(label)}(?:\\u00a0|\\s)*`, 'g')
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    nodes.forEach(node => { node.nodeValue = node.nodeValue?.replace(pattern, '') || '' })
    setSelectedMentions(items => items.filter(item => item.ref !== ref))
    syncEditor()
    focusEditor()
  }
  const addMention = (label: string, ref: string) => {
    selectedMentions.filter(item => item.ref !== ref).forEach(item => removeMention(item.label, item.ref))
    const current = draftText
    const at = current.lastIndexOf('@')
    if (at >= 0) document.execCommand('delete', false)
    insertAtCursor(`@${label} `)
    setSelectedMentions([{ ref, label }])
    setMentionOpen(false)
    focusEditor()
  }
  const changeMessage = () => { const content = inputRef.current?.innerHTML || ''; onMessage(content); const plain = richTextToPlainText(content); setSelectedMentions(items => items.filter(item => plain.includes(`@${item.label}`))); const hasQuery = getMentionQuery(plain) !== null; setMentionOpen(hasQuery); if (hasQuery) setEmojiOpen(false) }
  const addEmoji = (emoji: string) => { insertAtCursor(emoji); setEmojiOpen(false) }
  const applyFormat = (command: 'bold' | 'italic' | 'underline' | 'insertUnorderedList' | 'insertOrderedList' | 'createLink') => {
    const editor = inputRef.current
    if (!editor) return
    editor.focus()
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) {
      const range = document.createRange()
      range.selectNodeContents(editor)
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    document.execCommand(command, false, command === 'createLink' ? 'https://' : undefined)
    syncEditor()
  }
  const handleDrop = async (event: ReactDragEvent) => {
    event.preventDefault(); setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    try { await onUpload(file); insertAtCursor(` [资料：${file.name}] `) } catch (error) { onNotice(error instanceof Error ? error.message : '上传失败') }
  }
  const visibleMessages = showAll ? messages : messages.slice(-6)
  useEffect(() => { conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' }) }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.stream_status])
  return <section className="workspace-panel conversation-panel"><PanelHead title="对话与协作" action={<button className={`panel-more ${showAll ? 'active' : ''}`} aria-label={showAll ? '收起历史消息' : '显示全部消息'} onClick={() => setShowAll(value => !value)}><Icon name="more" size={18} /></button>} />
    <div className="conversation-list" ref={conversationRef}>
      {messages.length === 0 && <div className="conversation-empty"><AgentBadge agent="clarify" color="violet" size="large" /><b>从一次真实的讨论开始</b><p>输入项目背景，或 @需求澄清 Agent 帮你梳理需求。</p></div>}
      {visibleMessages.map((item, index) => <MessageRow key={item.id} item={item} members={members} agents={agents} emphasized={index === visibleMessages.length - 1} onView={onView} />)}
      {task && (!TERMINAL_TASK_STATUSES.includes(task.status) || task.status === 'NEED_HUMAN') && <TaskRunCard task={task} currentStage={currentStage} onView={onView} />}
    </div>
    {pendingArtifacts.length > 0 && <div className="review-bar"><div className="review-bar-info"><Icon name="sparkles" size={15} /><span><b>{pendingArtifacts[0].title}</b><small>Agent 已完成，请确认是否通过</small></span></div><div className="review-bar-actions"><button className="outline-button" onClick={() => onDecision(pendingArtifacts[0], 'reject')}>修改</button><button className="outline-button" onClick={() => onRun(pendingArtifacts[0].agent_type || 'clarify', undefined, pendingArtifacts[0].stage)}>重新生成</button><button className="primary-button" onClick={() => onDecision(pendingArtifacts[0], 'approve')}>通过</button></div></div>}
    <form className={`composer ${dragOver ? 'drag-over' : ''}`} onDragOver={event => { event.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onSubmit={event => { event.preventDefault(); const content = inputRef.current?.innerHTML || ''; if (!richTextToPlainText(content)) return; inputRef.current!.innerHTML = ''; onMessage(''); setMentionOpen(false); setEmojiOpen(false); setSelectedMentions([]); void onSend(event, selectedMentions.map(item => item.ref), content) }}>
      {dragOver && <div className="drop-overlay"><Icon name="upload" size={22} /><b>松开以上传文件</b></div>}
      {mentionOpen && <div className="mention-menu"><header><b>提及成员或 Agent</b><span>每次只能选择一个对象</span></header>{filteredMembers.length > 0 && <div className="mention-group"><small>项目成员</small>{filteredMembers.map(member => { const ref = `member:${member.mis}`; return <button type="button" key={member.mis} onClick={() => addMention(member.name, ref)}><Avatar name={member.name} mis={member.mis} small /><span><b>{member.name}</b><small>{member.mis === project.owner_mis ? '项目负责人' : '协作成员'}</small></span><em>站内提及</em></button>})}</div>}<div className="mention-group"><small>Agent · 随时可对话</small>{filteredAgents.map(agent => { const ref = `agent:${agent.agent_type}`; return <button type="button" className="agent-option ready" key={agent.agent_type} onClick={() => addMention(agent.display_name, ref)}><AgentBadge agent={agent.agent_type} color={STAGES.find(stage => stage.agent === agent.agent_type)?.color || 'violet'} /><span><b>{agent.display_name}</b><small>{agent.description || '自定义 Agent'} · 发送后由该 Agent 回复</small></span><em>对话</em></button>})}{filteredAgents.length === 0 && filteredMembers.length === 0 && <p className="mention-empty">没有匹配的成员或 Agent</p>}</div></div>}
      {emojiOpen && <div className="emoji-menu"><header><b>选择表情</b><span>点击即可插入消息</span></header>{EMOJI_GROUPS.map(group => <section key={group.label}><small>{group.label}</small><div>{group.items.map(emoji => <button type="button" aria-label={`插入表情 ${emoji}`} title={emoji} key={emoji} onClick={() => addEmoji(emoji)}>{emoji}</button>)}</div></section>)}</div>}
      <div ref={inputRef} className="composer-editor" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder="输入消息，@谁就由谁回复；Enter 发送，⌘ + Enter 换行" onInput={changeMessage} onKeyDown={event => { if (event.key === 'Escape') { setMentionOpen(false); setEmojiOpen(false); return } if (event.key !== 'Enter') return; event.preventDefault(); if (event.metaKey) { document.execCommand('insertLineBreak'); syncEditor(); return } event.currentTarget.closest('form')?.requestSubmit() }} />
      <div className="composer-formatbar"><button type="button" title="加粗" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('bold')}><b>B</b></button><button type="button" title="下划线" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('underline')}><u>U</u></button><button type="button" title="无序列表" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('insertUnorderedList')}>•☰</button><button type="button" title="有序列表" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('insertOrderedList')}>1☰</button><button type="button" title="链接" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('createLink')}><Icon name="link" size={16} /></button></div>
      <input ref={attachmentRef} className="hidden-file-input" type="file" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { await onUpload(file); insertAtCursor(` [资料：${file.name}] `) } catch (error) { onNotice(error instanceof Error ? error.message : '上传失败') } finally { event.target.value = '' } }} /><div className="composer-actions"><button type="button" aria-label="添加附件" onClick={() => attachmentRef.current?.click()}><Icon name="clip" size={17} /></button><button type="button" aria-label="提及成员或 Agent" className={mentionOpen ? 'active' : ''} onClick={() => { if (mentionOpen) { setMentionOpen(false); return } insertAtCursor('@'); setMentionOpen(true); setEmojiOpen(false) }}>@</button><button type="button" aria-label="选择表情" className={emojiOpen ? 'active' : ''} onClick={() => { setEmojiOpen(value => !value); setMentionOpen(false) }}><Icon name="smile" size={17} /></button><span className="composer-queue-hint">可连续发送，Agent 按顺序处理</span><button className="send-button" aria-label="发送" disabled={!draftText.trim()}><Icon name="send" size={17} /></button></div>
    </form>
  </section>
}

/** 根据消息发送者名称推断对应的 Agent 类型 */
function inferAgentKey(senderName: string): AgentKey {
  const lower = senderName.toLowerCase()
  const match = STAGES.find(stage => lower.includes(stage.agent))
  return match?.agent ?? 'clarify'
}

function mentionDisplayText(text: string, mentions: string[] = [], members: MemberProfile[] = [], agents: AgentConfiguration[] = []) {
  return mentions.reduce((display, mention) => {
    const [kind, id] = mention.split(':', 2)
    const label = kind === 'member' ? members.find(member => member.mis === id)?.name : kind === 'agent' ? agents.find(agent => agent.agent_type === id)?.display_name : ''
    if (!id || !label || id === label) return display
    return display.split(`@${id}`).join(`@${label}`)
  }, text)
}
function MentionText({ text }: { text: string }) {
  const pieces = text.split(/(@[^\s，。！？、]+(?:\s+Agent)?)/g)
  return <>{pieces.map((piece, index) => piece.startsWith('@') ? <mark className="mention" key={`${piece}-${index}`}>{piece}</mark> : piece)}</>
}
function MarkdownMessage({ text, format = 'markdown' }: { text: string; format?: string }) {
  const html = useMemo(() => {
    const content = format === 'html' ? text : marked.parse(normalizeMarkdown(text), { gfm: true, breaks: true }) as string
    return DOMPurify.sanitize(content)
  }, [format, text])
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}
function MessageRow({ item, members, agents, emphasized, onView }: { item: Message; members: MemberProfile[]; agents: AgentConfiguration[]; emphasized?: boolean; onView: (view: ViewKey) => void }) {
  const isHuman = item.sender_type === 'HUMAN'
  const isSystem = item.sender_type === 'SYSTEM'
  const agent = inferAgentKey(item.sender_name)
  const displayContent = mentionDisplayText(item.content, item.mentions, members, agents)
  if (isSystem) return <article className="message system-message"><div className="system-center"><i className="system-avatar"><Icon name="sparkles" size={15} /></i><div className="agent-bubble"><MarkdownMessage text={displayContent} format={item.content_format} /></div></div></article>
  return <article className={`message ${isHuman ? 'human-message' : 'agent-message'}`}>
    {!isHuman && <AgentBadge agent={agent} color={STAGES.find(stage => stage.agent === agent)?.color} size="large" />}
    <div className={isHuman ? 'message-content human-side' : 'message-content'}><header><b>{item.sender_name}</b><span>{new Date(item.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>{!isHuman && <em>{item.stream_status === 'QUEUED' ? '排队中' : item.stream_status === 'STREAMING' ? '回复中' : item.stream_status === 'FAILED' ? '回复失败' : item.message_type === 'NEED_HUMAN' ? '需要你' : item.message_type === 'AGENT_CHAT' ? '对话' : emphasized ? '已完成' : 'Agent'}</em>}</header><div className={`${isHuman ? 'human-bubble' : 'agent-bubble'} ${item.stream_status?.toLowerCase() || ''}`}>{displayContent ? <MarkdownMessage text={displayContent} format={item.content_format} /> : <div className="stream-placeholder"><i /><i /><i /><span>{item.stream_status === 'QUEUED' ? '等待上一条回复完成' : '正在思考'}</span></div>}{!isHuman && emphasized && item.message_type === 'AGENT_RESULT' && <button className="result-link" onClick={() => onView('artifacts')}>查看完整结果 <Icon name="chevron" size={12} /></button>}</div></div>
    {isHuman && <Avatar name={item.sender_name} mis={item.sender_mis} />}
  </article>
}

function TaskRunCard({ task, currentStage, onView }: { task: Task; currentStage?: Stage; onView: (view: ViewKey) => void }) {
  const sources = task.input_snapshot?.approved_artifacts || []
  const needHuman = task.status === 'NEED_HUMAN'
  return <article className={`message agent-message task-run-message ${needHuman ? 'need-human' : ''}`}><AgentBadge agent={task.agent_type} color={currentStage?.color} size="large" /><div><header><b>{AGENT_NAMES[task.agent_type]}</b><span>刚刚</span><em>{needHuman ? '需要你补充' : task.status === 'WAITING' ? '排队中' : '执行中'}</em></header><div className="agent-bubble task-run-card"><p>{needHuman ? task.output : '我已创建正式任务，正在基于共享 Context 生成阶段产出。'}</p><div className="task-context-source"><span><Icon name="link" size={13} />本次读取 · Context {formatVersion(task.input_snapshot?.context_version)}</span><div><i>项目信息</i>{sources.map(item => <i key={`${item.stage}-${item.version}`}>{item.title} · {formatVersion(item.version)}</i>)}</div></div><button className="result-link" onClick={() => onView('tasks')}>查看任务与输入明细 <Icon name="chevron" size={12} /></button></div></div></article>
}

function WorkflowPanel({ project, task, onRun, onView }: { project: Project; task: Task | null; onRun: (agent: AgentKey) => void; onView: (view: ViewKey) => void }) {
  const stages = workflowStages(project)
  const allAgents = [...stages, { key: 'REVIEW', label: '评审复盘', agent: 'review' as AgentKey, color: 'red' }]
  return <section className="workspace-panel workflow-panel"><PanelHead tabs={['任务与流程', '任务列表']} onTab={index => { if (index === 1) onView('tasks') }} />
    <div className="workflow-list">{allAgents.map((stage, index) => {
      const state = index < stages.length ? stageState(project, index, stages) : project.current_stage === 'COMPLETED' ? 'current' : 'next'
      const running = task?.agent_type === stage.agent && isTaskActive(task)
      return <button key={stage.key} disabled={state === 'next'} onClick={() => onRun(stage.agent)} className={state}><span className="flow-line" /><AgentBadge agent={stage.agent} color={stage.color} /><span className="flow-copy"><b>{AGENT_NAMES[stage.agent]} · {stage.label}</b><small>负责人：{AGENT_NAMES[stage.agent]}</small></span><em>{running ? '执行中' : state === 'skipped' ? '已跳过' : state === 'done' ? '已完成' : state === 'unexecuted' ? '未执行' : state === 'current' ? '进行中' : '待开始'}</em></button>
    })}</div>
    <button className="panel-link" onClick={() => onView('tasks')}>查看更全流程信息 <Icon name="chevron" size={13} /></button>
  </section>
}

function ResourcePanel({ artifacts, files, messages, members, onView, onUpload, onDownload, onNotice }: { artifacts: Artifact[]; files: ProjectFile[]; messages: Message[]; members: MemberProfile[]; onView: (view: ViewKey) => void; onUpload: (file: File) => Promise<void>; onDownload: (file: ProjectFile) => void; onNotice: (text: string) => void }) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const [activeTab, setActiveTab] = useState(0)
  const sortedArtifacts = [...artifacts].sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage))
  const visibleArtifacts = activeTab === 0 ? sortedArtifacts.filter(item => item.status !== 'SUPERSEDED') : sortedArtifacts
  return <section className="workspace-panel resource-panel"><PanelHead tabs={['产出与资料', '项目成员', '动态更新']} activeTab={activeTab} onTab={setActiveTab} />
    {activeTab === 0 && <div className="resource-body">
      <div className="resource-section-head"><h3>阶段产出 <span>({visibleArtifacts.length})</span></h3><button onClick={() => onView('artifacts')}>查看全部 <Icon name="chevron" size={11} /></button></div><div className="related-files artifact-file-list">{visibleArtifacts.map((item, index) => <button key={item.id} onClick={() => onView('artifacts')}><i className={`file-type type-${index % 3}`}><Icon name="document" size={14} /></i><span>{item.title}</span><em className={item.status === 'PENDING_REVIEW' ? 'pending' : ''}>{item.status === 'PENDING_REVIEW' ? '待确认' : item.status === 'APPROVED' ? '已确认' : item.status === 'REJECTED' ? '已驳回' : '历史版'}</em></button>)}{visibleArtifacts.length === 0 && <p>完成阶段后将在这里生成文件</p>}</div>
      <div className="resource-section-head"><h3>相关资料 <span>({files.length})</span></h3>{files.length > 0 && <button onClick={() => onView('artifacts')}>管理资料 <Icon name="chevron" size={11} /></button>}</div><div className="related-files">{files.map(item => <button key={item.id} onClick={() => onDownload(item)}><i className={`file-type ${fileTone(item)}`}><Icon name="document" size={14} /></i><span>{item.name}</span><time>{formatFileSize(item.size)}</time></button>)}{files.length === 0 && <p>上传访谈、数据或参考文档，供所有 Agent 读取</p>}</div>
      <input ref={uploadRef} className="hidden-file-input" type="file" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { await onUpload(file) } catch (error) { onNotice(error instanceof Error ? error.message : '上传失败') } finally { event.target.value = '' } }} /><button className="upload-box" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={17} /><b>上传资料</b><span>支持点击上传或拖拽到左侧对话区</span></button>
    </div>}
    {activeTab === 1 && <div className="resource-body"><h3>项目成员 <span>({members.length})</span></h3><div className="resource-member-list">{members.map((member, index) => <div key={member.mis} className="resource-member"><Avatar name={member.name} mis={member.mis} small /><div><b>{member.name}</b><small>{index === 0 ? '项目负责人' : '协作成员'}</small></div></div>)}<button className="invite-member-btn" onClick={() => onView('members')}><i><Icon name="plus" size={15} /></i><span>邀请成员</span></button></div></div>}
    {activeTab === 2 && <div className="resource-body"><h3>动态更新</h3><div className="resource-update-list">{messages.slice(-10).reverse().map(item => <div key={item.id} className="resource-update"><time>{new Date(item.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><span>{item.content}</span></div>)}{messages.length === 0 && <p>暂无项目动态</p>}</div></div>}
  </section>
}

function PageTitle({ title, description }: { title: string; description: string }) { return <section className="inner-title"><h1>{title}</h1><p>{description}</p></section> }
function ContextPage({ project, onEdit }: { project: Project; onEdit: () => void }) { const current = workflowStages(project).find(stage => stage.key === project.current_stage); return <><PageTitle title="项目概览" description="维护项目共同上下文，供成员和 Agent 统一引用" /><section className="page-card"><PanelHead title="项目信息" action={<button className="outline-button" onClick={onEdit}><Icon name="edit" size={14} />编辑项目信息</button>} /><div className="context-grid"><InfoBlock label="项目目标" value={project.goal} /><InfoBlock label="核心问题" value={project.problem} /><InfoBlock label="补充背景" value={project.background || '暂无补充背景'} /><InfoBlock label="当前阶段" value={current?.label || '已完成'} /></div></section></> }
function ContextReviewPage({ project, artifacts, impacts, onDecision, onRun }: { project: Project; artifacts: Artifact[]; impacts: ContextImpact[]; onDecision: (impact: ContextImpact, action: 'accept' | 'reject') => void; onRun: (agent: AgentKey, instruction?: string, stageId?: StageKey) => void }) {
  const pending = impacts.filter(item => item.status === 'PENDING')
  const latest = artifacts.filter(item => item.status === 'APPROVED')
  return <><PageTitle title="Context 变更审核" description="一个项目只有一份共享 Context；跨阶段影响必须由成员明确接受或拒绝" />
    <section className="context-health"><div className="context-health-icon"><Icon name="link" size={23} /></div><div><span>项目共享 CONTEXT</span><h2>共享 Context {formatVersion(project.context_version)}</h2><p>{project.members.length + 1} 位成员与 6 个 Agent 始终读取相同的已确认版本</p></div><div className="context-rules"><span><i />阶段更新自动生成影响单</span><span><i />接受后才写入目标阶段</span><span><i />拒绝保留原版本和决策记录</span></div><strong className={pending.length ? 'has-pending' : ''}>{pending.length}<small>待审核</small></strong></section>
    <div className="context-review-layout"><section className="page-card impact-list"><PanelHead title={`跨阶段影响（${impacts.length}）`} />{impacts.length === 0 ? <div className="page-empty compact"><Icon name="link" size={30} /><b>Context 当前一致</b><p>阶段修订通过后，相关影响明细会出现在这里。</p></div> : impacts.map(item => <article className={`impact-card ${item.status.toLowerCase()}`} key={item.id}><header><div className="impact-route"><span>{item.source_stage_label}</span><i><Icon name="chevron" size={14} /></i><span>{item.target_stage_label}</span></div><em>{item.status === 'PENDING' ? '待审核' : item.status === 'ACCEPTED' ? '已接受' : '已拒绝'}</em></header><h3>{item.title}</h3><p className="impact-meta">{item.source_artifact_title} 影响 {item.target_artifact_title}</p><div className="source-diff"><b>来源阶段修改明细</b><p>{item.summary}</p></div><div className="diff-grid"><div><b>目标阶段当前内容</b><p>{item.before_text}</p></div><div><b>接受后的建议变更</b><p>{item.after_text}</p></div></div><div className="impact-proposal"><Icon name="sparkles" size={16} /><p><b>Context 管理建议</b>{item.proposed_change}</p></div>{item.status === 'PENDING' ? <footer><button className="reject-button" onClick={() => onDecision(item, 'reject')}>拒绝并保留原版本</button><button className="accept-button" onClick={() => onDecision(item, 'accept')}>接受并生成新版本</button></footer> : <footer className="decision-record"><span>决策人：{item.decided_by || project.owner_name}</span><b>{item.decision_reason || (item.status === 'ACCEPTED' ? '已同步到共享 Context' : '保留原版本')}</b></footer>}</article>)}</section>
      <aside className="context-side"><section className="page-card"><PanelHead title="当前 Context 索引" /><div className="context-version-list">{latest.map(item => { const stage = workflowStages(project).find(value => value.key === item.stage); const agentType = item.agent_type || stage?.agent || ''; return <article key={item.id}><AgentBadge agent={agentType} color={stage?.color || 'violet'} /><div><b>{stage?.label || '自定义阶段'}</b><span>{item.title}</span></div><em>{formatVersion(item.version)}</em><button onClick={() => onRun(agentType, undefined, item.stage)}>更新</button></article> })}{latest.length === 0 && <p>暂无已确认阶段产出</p>}</div></section><section className="context-explainer"><Icon name="sparkles" size={20} /><b>变更如何流动？</b><p>阶段更新通过后，系统根据依赖关系定位已有产出；成员逐条审核，只有接受项会生成目标阶段新版本。</p></section></aside>
    </div>
  </>
}
function taskStatusText(status: string) { return status === 'WAITING' ? '等待执行' : status === 'RUNNING' ? '正在执行' : status === 'COMPLETED' ? '已完成' : status === 'NEED_HUMAN' ? '需要成员' : '执行失败' }
type TasksPageProps = { project: Project; agents: AgentConfiguration[]; task: Task | null; tasks: Task[]; display?: 'canvas' | 'tasks'; onRun: (agent: AgentKey, instruction?: string, stageId?: StageKey) => void; onRunReady: () => void; onSaveWorkflow: (graph: WorkflowGraph) => Promise<void>; onSkip: (stage: StageKey) => void; onFinish: () => void; onNotice: (text: string) => void }

function TasksPage(props: TasksPageProps) {
  const { project, agents, task, tasks, display = 'tasks', onRun, onRunReady, onSaveWorkflow, onSkip, onFinish, onNotice } = props
  const activeAgents = agents.filter(agent => agent.status === 'ACTIVE' && agent.agent_type !== 'review')
  const people = [...new Set([project.owner_mis || project.owner_name, ...project.members])]
  const savedNodes = workflowNodes(project)
  const savedEdges = project.workflow_graph?.edges || []
  const [editing, setEditing] = useState(false)
  const [showExitConfirmation, setShowExitConfirmation] = useState(false)
  const [nodes, setNodes] = useState<WorkflowStageNode[]>([])
  const [edges, setEdges] = useState<WorkflowGraph['edges']>([])
  const [selectedId, setSelectedId] = useState<StageKey | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<StageKey | null>(null)
  const [connectionPointer, setConnectionPointer] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [canvasZoom, setCanvasZoom] = useState(.7)
  const dragOffset = useRef({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const saved = Number(localStorage.getItem(`ai-team-canvas-zoom:reference-v2:${project.id}`))
    setCanvasZoom(Number.isFinite(saved) && saved >= .5 && saved <= 1.4 ? saved : .7)
  }, [project.id])
  useEffect(() => { try { localStorage.setItem(`ai-team-canvas-zoom:reference-v2:${project.id}`, String(canvasZoom)) } catch { /* 忽略禁用本地存储的场景 */ } }, [canvasZoom, project.id])
  const focusCanvas = (items: WorkflowStageNode[] = nodes) => requestAnimationFrame(() => {
    const canvas = canvasRef.current; if (!canvas || !items.length) return
    const minX = Math.min(...items.map(node => node.x || 0)); const minY = Math.min(...items.map(node => node.y || 0))
    canvas.scrollTo({ left: Math.max(0, (minX - 45) * canvasZoom), top: Math.max(0, (minY - 45) * canvasZoom), behavior: 'smooth' })
  })
  const hydrateCanvas = () => {
    const next = savedNodes.map(node => ({ ...node, x: node.x ?? 70 + node.column * 280, y: 22 + node.order * 190, member_ids: [...node.member_ids], reviewer_ids: [...node.reviewer_ids], agents: node.agents.map(agent => ({ ...agent })) }))
    setNodes(next); setEdges(savedEdges.map(edge => ({ ...edge }))); setSelectedId(next[0]?.id || null); setConnectingFrom(null); setConnectionPointer(null); focusCanvas(next)
  }
  useEffect(() => { if (!editing) hydrateCanvas() }, [project.workflow_graph, editing])
  useEffect(() => { if (editing) requestAnimationFrame(() => focusCanvas()) }, [editing])
  const selected = nodes.find(node => node.id === selectedId) || null
  const updateNode = (id: StageKey, changes: Partial<WorkflowStageNode>) => setNodes(items => items.map(item => item.id === id ? { ...item, ...changes } : item))
  const togglePerson = (field: 'member_ids' | 'reviewer_ids', person: string) => { if (!selected) return; updateNode(selected.id, { [field]: selected[field].includes(person) ? selected[field].filter(value => value !== person) : [...selected[field], person] }) }
  const toggleAgent = (agentType: AgentKey) => {
    if (!selected) return
    const exists = selected.agents.some(agent => agent.agent_type === agentType)
    if (exists && selected.agents.length === 1) { onNotice('每个阶段至少保留一个 Agent'); return }
    const next = exists ? selected.agents.filter(agent => agent.agent_type !== agentType) : [...selected.agents, { agent_type: agentType, instruction: '', order: selected.agents.length }]
    updateNode(selected.id, { agents: next.map((agent, order) => ({ ...agent, order })) })
  }
  const connectTo = (targetId: StageKey, sourceId: StageKey | null = connectingFrom) => {
    if (!sourceId || sourceId === targetId) { setConnectingFrom(null); setConnectionPointer(null); return }
    if (edges.some(edge => edge.from === sourceId && edge.to === targetId)) { setConnectingFrom(null); setConnectionPointer(null); return }
    const reachable = new Set<string>(); const queue = [targetId]
    while (queue.length) { const current = queue.shift()!; if (reachable.has(current)) continue; reachable.add(current); edges.filter(edge => edge.from === current).forEach(edge => queue.push(edge.to)) }
    if (reachable.has(sourceId)) { onNotice('这条连线会形成循环，请调整节点依赖'); setConnectingFrom(null); setConnectionPointer(null); return }
    setEdges(items => [...items, { from: sourceId, to: targetId }]); setConnectingFrom(null); setConnectionPointer(null)
  }
  const removeNode = (id: StageKey) => {
    if (nodes.length === 1) { onNotice('流程至少保留一个阶段'); return }
    setNodes(items => items.filter(item => item.id !== id)); setEdges(items => items.filter(edge => edge.from !== id && edge.to !== id)); setSelectedId(nodes.find(item => item.id !== id)?.id || null)
  }
  const addNode = () => {
    const firstAgent = activeAgents[0]; if (!firstAgent) return
    const id = `stage:${Date.now().toString(36)}`; const maxX = Math.max(40, ...nodes.map(node => node.x || 0))
    const node: WorkflowStageNode = { id, name: '新阶段', description: '', column: nodes.length, order: 0, x: maxX + 280, y: 22, member_ids: [], reviewer_ids: [], collaboration_mode: 'parallel', agents: [{ agent_type: firstAgent.agent_type, instruction: '', order: 0 }] }
    setNodes(items => [...items, node]); setSelectedId(id)
  }
  const resetDefault = () => {
    const next = STAGES.map((stage, index) => ({ id: `stage:${stage.agent}`, name: stage.label, description: AGENT_ROLES[stage.agent] || '', column: index, order: 0, x: 70 + index * 280, y: 22, member_ids: [], reviewer_ids: [], collaboration_mode: 'parallel' as const, agents: [{ agent_type: stage.agent, instruction: '', order: 0 }] }))
    setNodes(next); setEdges(next.slice(0, -1).map((node, index) => ({ from: node.id, to: next[index + 1].id }))); setSelectedId(next[0].id); setConnectingFrom(null)
  }
  const autoLayout = () => {
    const incoming = new Map(nodes.map(node => [node.id, 0])); const outgoing = new Map(nodes.map(node => [node.id, [] as string[]]))
    edges.forEach(edge => { incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1); outgoing.get(edge.from)?.push(edge.to) })
    const level = new Map<string, number>(); const queue = nodes.filter(node => !incoming.get(node.id)).map(node => node.id); queue.forEach(id => level.set(id, 0))
    while (queue.length) { const id = queue.shift()!; (outgoing.get(id) || []).forEach(target => { level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1)); incoming.set(target, (incoming.get(target) || 1) - 1); if (!incoming.get(target)) queue.push(target) }) }
    const rows = new Map<number, number>(); setNodes(items => { const next = items.map((node, index) => { const column = level.get(node.id) ?? index; const row = rows.get(column) || 0; rows.set(column, row + 1); return { ...node, column, order: row, x: 70 + column * 300, y: 22 + row * 190 } }); focusCanvas(next); return next })
  }
  const discardChanges = () => { hydrateCanvas(); setShowExitConfirmation(false); setEditing(false) }
  const save = async () => {
    if (nodes.some(node => !node.name.trim() || !node.agents.length)) { onNotice('每个阶段都需要名称和至少一个 Agent'); return }
    setShowExitConfirmation(false)
    const normalized = nodes.map(node => ({ ...node, name: node.name.trim(), column: Math.max(0, Math.round(((node.x || 70) - 70) / 300)), order: Math.max(0, Math.round(((node.y || 90) - 90) / 190)), agents: node.agents.map((agent, order) => ({ ...agent, order })) }))
    const columns = new Map<number, WorkflowStageNode[]>(); normalized.forEach(node => columns.set(node.column, [...(columns.get(node.column) || []), node]))
    const steps = [...columns.entries()].sort(([a], [b]) => a - b).map(([, items]) => items.sort((a, b) => a.order - b.order).map(item => item.id))
    setSaving(true); try { await onSaveWorkflow({ version: 3, mode: 'stage-dag', steps, nodes: normalized, edges }); setEditing(false) } catch (error) { onNotice(error instanceof Error ? error.message : '工作流保存失败') } finally { setSaving(false) }
  }
  const canvasWidth = Math.max(1180, ...nodes.map(node => (node.x || 0) + 330)); const canvasHeight = Math.max(600, ...nodes.map(node => (node.y || 0) + 240))
  const changeZoom = (next: number) => setCanvasZoom(Math.max(.5, Math.min(1.4, Math.round(next * 20) / 20)))
  const fitCanvas = () => {
    const viewport = canvasRef.current; if (!viewport) return
    changeZoom(Math.min((viewport.clientWidth - 32) / canvasWidth, (viewport.clientHeight - 32) / canvasHeight, 1.15))
    viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
  }
  const stageViews = workflowStages(project)
  const statusOf = (nodeId: string) => project.completed_stage_keys?.includes(nodeId) ? 'done' : project.skipped_stages?.includes(nodeId) ? 'skipped' : project.ready_stages?.includes(nodeId) ? 'ready' : 'waiting'
  return <>{display === 'canvas' && <RenderInBody active={editing}><section className={`page-card workflow-canvas-card workspace-canvas-card ${editing ? 'editing workspace-canvas-editor-overlay' : ''}`}>
      <header className="workflow-canvas-toolbar"><div><span>{editing ? 'IMMERSIVE CANVAS EDITOR' : 'WORKFLOW CANVAS'}</span><h2>{editing ? '沉浸式流程编辑' : `项目流程 · ${formatVersion(project.workflow_version || 1)}`}</h2><p>{editing ? '拖拽节点调整位置，拖拽右侧连接点到目标左侧建立依赖；点击完成编辑后保存。' : '拖拽节点可调整顺序，点击节点查看详情与依赖。'}</p></div><div><div className="canvas-zoom-controls"><button aria-label="缩小画布" onClick={() => changeZoom(canvasZoom - .1)}>−</button><span>{Math.round(canvasZoom * 100)}%</span><button aria-label="放大画布" onClick={() => changeZoom(canvasZoom + .1)}>＋</button><button onClick={fitCanvas}>适应</button></div><button onClick={() => focusCanvas()}><Icon name="grid" size={13} />聚焦画布</button>{editing ? <><button onClick={autoLayout}>自动排版</button><button onClick={resetDefault}>恢复默认</button><button onClick={addNode}><Icon name="plus" size={13} />添加阶段</button><button className="canvas-return-button" disabled={saving} onClick={() => setShowExitConfirmation(true)}><Icon name="arrow-left" size={13} />返回</button><button className="primary" disabled={saving} onClick={save}>{saving ? '保存中…' : '完成编辑'}</button></> : <button className="primary" onClick={() => { hydrateCanvas(); setCanvasZoom(value => Math.max(value, .85)); setEditing(true) }}><Icon name="edit" size={13} />编辑画布</button>}</div></header>
      <div className={`workflow-canvas-shell ${editing ? 'with-inspector' : ''}`}>
        <div className="workflow-canvas-viewport" ref={canvasRef} onDragOver={event => event.preventDefault()} onDrop={(event: ReactDragEvent<HTMLDivElement>) => { event.preventDefault(); const id = event.dataTransfer.getData('stage-id'); const canvas = canvasRef.current; if (!id || !canvas) return; const rect = canvas.getBoundingClientRect(); updateNode(id, { x: Math.max(20, (event.clientX - rect.left + canvas.scrollLeft) / canvasZoom - dragOffset.current.x), y: Math.max(20, (event.clientY - rect.top + canvas.scrollTop) / canvasZoom - dragOffset.current.y) }) }}>
          <div className="workflow-canvas-stage" style={{ width: canvasWidth * canvasZoom, height: canvasHeight * canvasZoom }}><div className="workflow-canvas-grid" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${canvasZoom})` }} onClick={() => editing && setSelectedId(null)}>
            <svg className="workflow-edge-layer" width={canvasWidth} height={canvasHeight}><defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{edges.map(edge => { const source = nodes.find(node => node.id === edge.from); const target = nodes.find(node => node.id === edge.to); if (!source || !target) return null; const x1 = (source.x || 0) + 232; const y1 = (source.y || 0) + 70; const x2 = target.x || 0; const y2 = (target.y || 0) + 70; const bend = Math.max(70, Math.abs(x2 - x1) * .45); return <path markerEnd="url(#workflow-arrow)" key={`${edge.from}-${edge.to}`} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} /> })}{connectingFrom && connectionPointer && (() => { const source = nodes.find(node => node.id === connectingFrom); if (!source) return null; const x1 = (source.x || 0) + 232; const y1 = (source.y || 0) + 70; const bend = Math.max(55, Math.abs(connectionPointer.x - x1) * .4); return <path className="draft-edge" d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${connectionPointer.x - bend} ${connectionPointer.y}, ${connectionPointer.x} ${connectionPointer.y}`} /> })()}</svg>
            {nodes.map((node, index) => {
              const status = statusOf(node.id)
              const names = node.agents.map(item => agents.find(agent => agent.agent_type === item.agent_type)?.display_name || item.agent_type)
              const primaryAgent = node.agents[0]?.agent_type || 'review'
              return <article draggable={editing} className={`workflow-canvas-node ${status} ${selectedId === node.id ? 'selected' : ''} ${connectingFrom === node.id ? 'connecting' : ''}`} key={node.id} style={{ left: node.x || 0, top: node.y || 0 }} onClick={event => { event.stopPropagation(); if (editing) setSelectedId(node.id) }} onDragStart={event => { if (!editing || event.dataTransfer.types.includes('workflow-connection')) return; const rect = event.currentTarget.getBoundingClientRect(); dragOffset.current = { x: (event.clientX - rect.left) / canvasZoom, y: (event.clientY - rect.top) / canvasZoom }; event.dataTransfer.setData('stage-id', node.id); event.dataTransfer.effectAllowed = 'move' }}>
                <button className="node-input-port" data-node-id={node.id} title="连接到这里" aria-label={`连接到${node.name}`} disabled={!editing} onDragOver={event => { if (!event.dataTransfer.types.includes('workflow-connection')) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'link' }} onDrop={event => { event.preventDefault(); event.stopPropagation(); connectTo(node.id, event.dataTransfer.getData('workflow-connection') || null) }} onClick={event => { event.stopPropagation(); connectTo(node.id) }} />
                <header><span>{String(index + 1).padStart(2, '0')}</span><em>{status === 'done' ? '已完成' : status === 'ready' ? '可执行' : status === 'skipped' ? '已跳过' : '等待中'}</em></header>
                <h3>{node.name}</h3><p>{node.description || '点击节点配置阶段目标'}</p>
                <div className="node-agents"><AgentSketch agent={primaryAgent} identityKey={`project:${project.id}:stage:${node.id}`} size={38} /><i>{names[0] || '未配置 Agent'}</i>{names.length > 1 && <i>+{names.length - 1}</i>}</div>
                <footer><span>R:{node.member_ids.length || 1}</span><span>Q:{node.agents.length}</span>{node.reviewer_ids.length > 0 ? <em>需审核</em> : <em className="auto">自动流转</em>}</footer>
                <button draggable={editing} className="node-output-port" title="拖到另一个节点左侧；也可以点击后再点目标左侧" aria-label={`从${node.name}开始连线`} disabled={!editing} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('workflow-connection', node.id); event.dataTransfer.effectAllowed = 'link'; setConnectingFrom(node.id) }} onDrag={event => { const canvas = canvasRef.current; if (!canvas || !event.clientX || !event.clientY) return; const rect = canvas.getBoundingClientRect(); setConnectionPointer({ x: (event.clientX - rect.left + canvas.scrollLeft) / canvasZoom, y: (event.clientY - rect.top + canvas.scrollTop) / canvasZoom }) }} onDragEnd={() => { setConnectionPointer(null); setConnectingFrom(null) }} onClick={event => { event.stopPropagation(); setConnectingFrom(value => value === node.id ? null : node.id); setConnectionPointer(null) }} />
              </article>
            })}
            {nodes.length === 0 && <div className="canvas-empty"><Icon name="workflow" size={28} /><b>画布还是空的</b><span>添加一个阶段开始编排</span></div>}
          </div></div>
        </div>
        {editing && <aside className="workflow-node-inspector">{selected ? <><header><div><span>STAGE SETTINGS</span><h3>阶段设置</h3></div><button onClick={() => removeNode(selected.id)}>删除</button></header><label>阶段名称<input value={selected.name} maxLength={80} onChange={event => updateNode(selected.id, { name: event.target.value })} /></label><label>阶段目标<textarea value={selected.description} maxLength={500} placeholder="说明这个阶段要解决什么、交付什么" onChange={event => updateNode(selected.id, { description: event.target.value })} /></label><fieldset><legend>@参与成员 <small>可多选</small></legend><div>{people.map(person => <button className={selected.member_ids.includes(person) ? 'selected' : ''} key={person} onClick={() => togglePerson('member_ids', person)}>@{person}</button>)}</div></fieldset><fieldset><legend>@审核人 <small>不选则自动流转</small></legend><div>{people.map(person => <button className={selected.reviewer_ids.includes(person) ? 'selected' : ''} key={person} onClick={() => togglePerson('reviewer_ids', person)}>@{person}</button>)}</div></fieldset><fieldset className="inspector-agent-list"><legend>@Agent <small>至少一个</small></legend><div>{activeAgents.map(agent => <button className={selected.agents.some(item => item.agent_type === agent.agent_type) ? 'selected' : ''} key={agent.agent_type} onClick={() => toggleAgent(agent.agent_type)}><AgentBadge agent={agent.agent_type} color={STAGES.find(item => item.agent === agent.agent_type)?.color || 'violet'} /><span>{agent.display_name}<small>{agent.skills.length} 个 Skill</small></span></button>)}</div></fieldset>{selected.agents.length > 1 && <label>阶段内执行<select value={selected.collaboration_mode} onChange={event => updateNode(selected.id, { collaboration_mode: event.target.value as WorkflowStageNode['collaboration_mode'] })}><option value="parallel">多个 Agent 并行</option><option value="sequential">按选择顺序串行</option></select></label>}<section className="inspector-links"><b>连接关系</b>{edges.filter(edge => edge.from === selected.id || edge.to === selected.id).map(edge => { const incoming = edge.to === selected.id; const otherId = incoming ? edge.from : edge.to; return <div key={`${edge.from}-${edge.to}`}><span>{incoming ? '来自' : '前往'} · {nodes.find(node => node.id === otherId)?.name}</span><button onClick={() => setEdges(items => items.filter(item => item !== edge))}>移除</button></div> })}{!edges.some(edge => edge.from === selected.id || edge.to === selected.id) && <p>暂时没有连线</p>}</section></> : <div className="inspector-empty"><Icon name="workflow" size={25} /><b>选择一个阶段</b><span>点击画布节点后在这里配置</span></div>}</aside>}
      </div>
      <footer className="workflow-canvas-legend"><span><i className="ready" />当前可执行</span><span><i className="done" />已经完成</span><span><i />等待前置</span>{editing && <em>{connectingFrom ? `正在从「${nodes.find(node => node.id === connectingFrom)?.name}」连线：拖到目标左侧，或直接点击目标左侧` : selected?.agents.length && selected.agents.length > 1 && selected.collaboration_mode === 'sequential' ? '阶段内串行：上一个 Agent 完成后，才执行选择顺序中的下一个 Agent' : '拖动卡片只调整位置；真正的执行先后以箭头为准'}</em>}</footer>
      {showExitConfirmation && <div className="canvas-exit-confirmation" role="dialog" aria-modal="true" aria-labelledby="canvas-exit-title"><section><span>未保存的画布修改</span><h3 id="canvas-exit-title">确定不保存并返回吗？</h3><p>当前调整不会生效，画布将恢复为上一次完成编辑时保存的版本。</p><footer><button onClick={() => setShowExitConfirmation(false)}>继续编辑</button><button className="discard" onClick={discardChanges}>不保存并返回</button></footer></section></div>}
    </section></RenderInBody>}{display === 'tasks' && <><section className="tasks-page-heading"><div><h1>任务与流程</h1><p>点击执行才会生成正式阶段产出；工作台里的 @Agent 始终用于即时对话。</p></div>{project.status === 'ACTIVE' ? <div className="workflow-actions">{project.current_stage !== 'COMPLETED' && <button className="outline-button danger-soft" onClick={() => onSkip(project.current_stage as StageKey)}>跳过当前阶段</button>}<button className="outline-button" onClick={onFinish}>结束项目</button></div> : <span className="finished-label">项目已结束</span>}</section>
    {project.status === 'ACTIVE' && (project.ready_agents?.length || 0) > 1 && <section className="parallel-ready-banner"><div><Icon name="workflow" size={18} /><span><b>{project.ready_agents!.length} 个 Agent 当前可执行</b><small>系统会依据节点配置决定串行或并行启动。</small></span></div><button className="primary-button" onClick={onRunReady}>启动全部就绪任务</button></section>}
    <section className="page-card task-page"><PanelHead title="阶段任务" /><div className="task-split-layout"><div className="task-table">{savedNodes.map((stageNode, index) => { const view = stageViews.find(item => item.key === stageNode.id)!; const state = stageState(project, index, stageViews); return <section className="stage-task-group" key={stageNode.id}><header><b>{index + 1}. {stageNode.name}</b><span>{stageNode.member_ids.length ? stageNode.member_ids.map(person => `@${project.member_names?.[person] || (person === project.owner_mis ? project.owner_name : person)}`).join(' ') : '未指定成员'}</span>{stageNode.reviewer_ids.length > 0 ? <em>等待指定成员审核</em> : <em>自动流转</em>}</header>{stageNode.agents.map(assignment => { const latestTask = tasks.find(item => item.stage === stageNode.id && item.agent_type === assignment.agent_type); const agent = agents.find(item => item.agent_type === assignment.agent_type); const running = isTaskActive(latestTask); return <div className="table-row" key={assignment.agent_type}><AgentBadge agent={assignment.agent_type} color={STAGES.find(item => item.agent === assignment.agent_type)?.color || 'violet'} size="large" /><div><b>{agent?.display_name || assignment.agent_type}</b><small>{agent?.skills.length || 0} 个 Skill · {stageNode.collaboration_mode === 'parallel' ? '阶段内并行' : '阶段内串行'}</small></div><span className={`status-pill ${latestTask?.status?.toLowerCase() || state}`}>{task && task.id === latestTask?.id && isTaskActive(task) ? taskStatusText(task.status) : latestTask ? taskStatusText(latestTask.status) : state === 'done' ? '已确认' : state === 'current' ? '待执行' : '未开始'}</span><button disabled={state === 'next' || running} onClick={() => onRun(assignment.agent_type, undefined, stageNode.id)}>{running ? '执行中…' : state === 'done' ? '重新执行' : state === 'current' ? '执行任务' : '等待前置'}</button></div>})}</section> })}{(() => { const reviewTask = tasks.find(item => item.agent_type === 'review'); const reviewRunning = isTaskActive(reviewTask); return <div className="table-row review-row"><AgentBadge agent="review" color="red" size="large" /><div><b>评审复盘</b><small>质量评审 Agent · 全部流程节点完成后开放</small></div><span className={`status-pill ${project.current_stage === 'COMPLETED' ? 'current' : 'next'}`}>{reviewTask ? taskStatusText(reviewTask.status) : '未开始'}</span><button disabled={project.current_stage !== 'COMPLETED' || reviewRunning} onClick={() => onRun('review')}>{reviewRunning ? '执行中…' : '执行评审'}</button></div> })()}</div><TaskRunHistory tasks={tasks} /></div></section></>}
  </>
}

function StageCardTasksPage({ project, agents, task, tasks, onRun, onRunReady, onSaveWorkflow, onSkip, onFinish, onNotice }: TasksPageProps) {
  const activeAgents = agents.filter(agent => agent.status === 'ACTIVE' && agent.agent_type !== 'review')
  const people = [...new Set([project.owner_mis || project.owner_name, ...project.members])]
  const savedNodes = workflowNodes(project)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<WorkflowStageNode[]>(savedNodes)
  const [parallelStages, setParallelStages] = useState<Set<StageKey>>(() => new Set(savedNodes.filter((node, index) => index > 0 && node.column === savedNodes[index - 1]?.column).map(node => node.id)))
  const [dragging, setDragging] = useState<StageKey | null>(null)
  const [saving, setSaving] = useState(false)
  const resetDraft = (nodes = savedNodes) => { setDraft(nodes.map(node => ({ ...node, member_ids: [...node.member_ids], reviewer_ids: [...node.reviewer_ids], agents: node.agents.map(item => ({ ...item })) }))); setParallelStages(new Set(nodes.filter((node, index) => index > 0 && node.column === nodes[index - 1]?.column).map(node => node.id))) }
  useEffect(() => { if (!editing) resetDraft() }, [project.workflow_graph?.nodes, editing])
  const defaultNodes = () => STAGES.map((stage, index) => ({ id: `stage:${stage.agent}`, name: stage.label, description: AGENT_ROLES[stage.agent] || '', column: index, order: 0, member_ids: [], reviewer_ids: [], collaboration_mode: 'parallel' as const, agents: [{ agent_type: stage.agent, instruction: '', order: 0 }] }))
  const updateStage = (id: StageKey, changes: Partial<WorkflowStageNode>) => setDraft(items => items.map(item => item.id === id ? { ...item, ...changes } : item))
  const togglePerson = (id: StageKey, field: 'member_ids' | 'reviewer_ids', person: string) => setDraft(items => items.map(item => item.id === id ? { ...item, [field]: item[field].includes(person) ? item[field].filter(value => value !== person) : [...item[field], person] } : item))
  const toggleAgent = (id: StageKey, agentType: AgentKey) => setDraft(items => items.map(item => { if (item.id !== id) return item; const exists = item.agents.some(agent => agent.agent_type === agentType); if (exists && item.agents.length === 1) return item; const nextAgents = exists ? item.agents.filter(agent => agent.agent_type !== agentType) : [...item.agents, { agent_type: agentType, instruction: '', order: item.agents.length }]; return { ...item, agents: nextAgents.map((agent, order) => ({ ...agent, order })) } }))
  const moveStage = (target: StageKey) => { if (!dragging || dragging === target) return; setDraft(items => { const moving = items.find(item => item.id === dragging); if (!moving) return items; const next = items.filter(item => item.id !== dragging); next.splice(next.findIndex(item => item.id === target), 0, moving); return next }) }
  const addStage = () => { const firstAgent = activeAgents[0]; if (!firstAgent) return; const id = `stage:${Date.now().toString(36)}`; setDraft(items => [...items, { id, name: '新阶段', description: '', column: items.length, order: 0, member_ids: [], reviewer_ids: [], collaboration_mode: 'parallel', agents: [{ agent_type: firstAgent.agent_type, instruction: '', order: 0 }] }]) }
  const save = async () => {
    if (draft.some(stage => !stage.name.trim() || !stage.agents.length)) { onNotice('每个阶段都需要名称和至少一个 Agent'); return }
    const columns: WorkflowStageNode[][] = []
    draft.forEach((stage, index) => { if (index > 0 && parallelStages.has(stage.id)) columns[columns.length - 1].push(stage); else columns.push([stage]) })
    const nodes = columns.flatMap((column, columnIndex) => column.map((stage, order) => ({ ...stage, name: stage.name.trim(), column: columnIndex, order, agents: stage.agents.map((agent, agentOrder) => ({ ...agent, order: agentOrder })) })))
    const steps = columns.map(column => column.map(stage => stage.id))
    const edges = columns.slice(0, -1).flatMap((column, index) => column.flatMap(source => columns[index + 1].map(target => ({ from: source.id, to: target.id }))))
    setSaving(true); try { await onSaveWorkflow({ version: 3, mode: 'stage-dag', steps, nodes, edges }); setEditing(false) } catch (error) { onNotice(error instanceof Error ? error.message : '工作流保存失败') } finally { setSaving(false) }
  }
  const stageViews = workflowStages(project)
  return <><PageTitle title="任务与流程" description="每个阶段都可以配置参与成员、可选审核人，以及一个或多个挂载 Skill 的 Agent" />
    <section className="page-card workflow-builder-card">
      <header className={`workflow-editor-head ${editing ? 'editing' : ''}`}><div><span>{editing ? 'EDITING WORKFLOW' : 'PROJECT WORKFLOW'}</span><h2>{editing ? '自定义流程与阶段' : '流程编排'}</h2><p>{editing ? '拖拽阶段调整顺序；阶段之间和阶段内 Agent 都可以设置串行或并行。' : `当前流程包含 ${savedNodes.length} 个阶段，阶段、人员和 Agent 均可调整。`}</p></div>{!editing ? <button className="workflow-edit-button" onClick={() => { resetDraft(); setEditing(true) }}><Icon name="edit" size={14} /><span>自定义流程</span><Icon name="chevron" size={13} /></button> : <div className="workflow-toolbar"><button className="workflow-reset-button" onClick={() => { const nodes = defaultNodes(); resetDraft(nodes); setDragging(null) }}><Icon name="workflow" size={14} />恢复默认</button><button className="workflow-reset-button" onClick={addStage}><Icon name="plus" size={14} />新增阶段</button><span className="workflow-toolbar-divider" /><button className="workflow-cancel-button" onClick={() => setEditing(false)}>退出编辑</button><button className="workflow-save-button" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存并应用'}<Icon name="chevron" size={13} /></button></div>}</header>
      {editing ? <div className="stage-editor-list">{draft.map((stage, index) => <article draggable className={`stage-editor-card ${dragging === stage.id ? 'dragging' : ''}`} key={stage.id} onDragStart={event => { setDragging(stage.id); event.dataTransfer.effectAllowed = 'move' }} onDragOver={event => { event.preventDefault(); moveStage(stage.id) }} onDragEnd={() => setDragging(null)}><header><i className="workflow-grip">⋮⋮</i><span>{parallelStages.has(stage.id) ? '∥' : String(index + 1).padStart(2, '0')}</span><input value={stage.name} maxLength={80} onChange={event => updateStage(stage.id, { name: event.target.value })} /><button disabled={draft.length === 1} onClick={() => setDraft(items => items.filter(item => item.id !== stage.id))}>删除</button></header>{index > 0 && <button className={`stage-parallel-toggle ${parallelStages.has(stage.id) ? 'active' : ''}`} onClick={() => setParallelStages(current => { const next = new Set(current); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next })}>{parallelStages.has(stage.id) ? '与上一阶段并行' : '等待上一阶段完成'}</button>}<textarea value={stage.description} maxLength={500} placeholder="阶段目标和交付说明（选填）" onChange={event => updateStage(stage.id, { description: event.target.value })} /><div className="stage-config-grid"><fieldset><legend>@项目成员 <small>可多选</small></legend><div>{people.map(person => <button className={stage.member_ids.includes(person) ? 'selected' : ''} key={person} onClick={() => togglePerson(stage.id, 'member_ids', person)}>@{person}</button>)}</div></fieldset><fieldset><legend>@审核人 <small>可不选</small></legend><div>{people.map(person => <button className={stage.reviewer_ids.includes(person) ? 'selected' : ''} key={person} onClick={() => togglePerson(stage.id, 'reviewer_ids', person)}>@{person}</button>)}</div></fieldset></div><fieldset className="stage-agent-picker"><legend>@Agent <small>可多选</small></legend><div>{activeAgents.map(agent => <button className={stage.agents.some(item => item.agent_type === agent.agent_type) ? 'selected' : ''} key={agent.agent_type} onClick={() => toggleAgent(stage.id, agent.agent_type)}><AgentBadge agent={agent.agent_type} color={STAGES.find(item => item.agent === agent.agent_type)?.color || 'violet'} /><span>{agent.display_name}<small>{agent.skills.length} 个 Skill</small></span></button>)}</div></fieldset>{stage.agents.length > 1 && <label className="stage-agent-mode">Agent 执行方式<select value={stage.collaboration_mode} onChange={event => updateStage(stage.id, { collaboration_mode: event.target.value as WorkflowStageNode['collaboration_mode'] })}><option value="parallel">并行执行</option><option value="sequential">按选择顺序串行</option></select></label>}</article>)}</div> : <div className="workflow-stage-preview">{savedNodes.map((stage, index) => <article className={index > 0 && stage.column === savedNodes[index - 1]?.column ? 'parallel' : ''} key={stage.id}><header><span>{index > 0 && stage.column === savedNodes[index - 1]?.column ? '∥' : index + 1}</span><b>{stage.name}</b></header><p>{stage.description || '暂无阶段说明'}</p><div>{stage.member_ids.map(person => <i key={person}>@{person}</i>)}{stage.member_ids.length === 0 && <i>未指定成员</i>}</div><footer>{stage.agents.map(agent => <span key={agent.agent_type}>{agents.find(item => item.agent_type === agent.agent_type)?.display_name || agent.agent_type}</span>)}<em>{stage.agents.length > 1 ? (stage.collaboration_mode === 'parallel' ? '并行' : '串行') : '单 Agent'}</em></footer></article>)}</div>}
    </section>
    {project.status === 'ACTIVE' && (project.ready_agents?.length || 0) > 1 && <section className="parallel-ready-banner"><div><Icon name="workflow" size={18} /><span><b>{project.ready_agents!.length} 个 Agent 当前可执行</b><small>系统会依据阶段配置决定串行或并行启动。</small></span></div><button className="primary-button" onClick={onRunReady}>启动全部就绪任务</button></section>}
    <section className="page-card task-page"><PanelHead title="流程任务" action={project.status === 'ACTIVE' ? <div className="workflow-actions">{project.current_stage !== 'COMPLETED' && <button className="outline-button danger-soft" onClick={() => onSkip(project.current_stage as StageKey)}>跳过当前阶段</button>}<button className="outline-button" onClick={onFinish}>结束项目</button></div> : <span className="finished-label">项目已结束</span>} />
      <div className="task-split-layout"><div className="task-table">{savedNodes.map((stageNode, index) => { const stage = stageViews.find(item => item.key === stageNode.id)!; const state = stageState(project, index, stageViews); return <section className="stage-task-group" key={stageNode.id}><header><b>{index + 1}. {stageNode.name}</b><span>{stageNode.member_ids.length ? stageNode.member_ids.map(person => `@${person}`).join(' ') : '未指定成员'}</span>{stageNode.reviewer_ids.length > 0 && <em>审核：{stageNode.reviewer_ids.join('、')}</em>}</header>{stageNode.agents.map(assignment => { const latestTask = tasks.find(item => item.stage === stageNode.id && item.agent_type === assignment.agent_type); const agent = agents.find(item => item.agent_type === assignment.agent_type); const running = isTaskActive(latestTask); const canRun = state !== 'next' && !running; return <div className="table-row" key={assignment.agent_type}><AgentBadge agent={assignment.agent_type} color={STAGES.find(item => item.agent === assignment.agent_type)?.color || 'violet'} size="large" /><div><b>{agent?.display_name || assignment.agent_type}</b><small>{agent?.skills.length || 0} 个 Skill · {stageNode.collaboration_mode === 'parallel' ? '阶段内并行' : '阶段内串行'}</small></div><span className={`status-pill ${latestTask?.status?.toLowerCase() || state}`}>{task && task.id === latestTask?.id && isTaskActive(task) ? taskStatusText(task.status) : latestTask ? taskStatusText(latestTask.status) : state === 'done' ? '已确认' : state === 'current' ? '待执行' : '未开始'}</span><button disabled={!canRun} onClick={() => onRun(assignment.agent_type, undefined, stageNode.id)}>{running ? '执行中…' : state === 'done' ? '重新执行' : state === 'current' ? '执行任务' : '等待前置'}</button></div>})}</section> })}
        {(() => { const reviewTask = tasks.find(item => item.agent_type === 'review'); const reviewRunning = isTaskActive(reviewTask); return <div className="table-row review-row"><AgentBadge agent="review" color="red" size="large" /><div><b>评审复盘</b><small>质量评审 Agent · 全部自定义阶段完成后开放</small></div><span className={`status-pill ${project.current_stage === 'COMPLETED' ? 'current' : 'next'}`}>{reviewTask ? taskStatusText(reviewTask.status) : '未开始'}</span><button disabled={project.current_stage !== 'COMPLETED' || reviewRunning} onClick={() => onRun('review')}>{reviewRunning ? '执行中…' : '执行评审'}</button></div> })()}</div>
        <TaskRunHistory tasks={tasks} />
      </div>
    </section>
  </>
}

function TaskRunHistory({ tasks }: { tasks: Task[] }) {
  return <div className="task-run-side"><PanelHead title={`运行记录（${tasks.length}）`} />{tasks.length === 0 ? <div className="page-empty compact"><Icon name="workflow" size={30} /><b>暂无运行记录</b><p>点击阶段中的“执行任务”后，正式运行记录会显示在这里。</p></div> : <div className="run-history-list">{tasks.map(item => {
    const sources = item.input_snapshot?.approved_artifacts || []
    const sourceFiles = item.input_snapshot?.project_files || []
    const config = item.input_snapshot?.agent_configuration
    const displayError = isFallbackTaskError(item.error) ? '' : item.error
    const runtimeLabel = item.run_metadata?.sdk ? `${item.run_metadata.sdk}${item.run_metadata.sdk_version ? ` · ${formatVersion(item.run_metadata.sdk_version)}` : ''}` : ''
    return <article key={item.id}><header><AgentBadge agent={item.agent_type} color={STAGES.find(stage => stage.agent === item.agent_type)?.color || 'red'} /><div><b>{config?.display_name || AGENT_NAMES[item.agent_type]}</b><span>{item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '刚刚'}</span></div><em className={item.status.toLowerCase()}>{taskStatusText(item.status)}</em></header><p>{item.instruction}</p><div className="run-context"><span><Icon name="link" size={13} />输入来源 · Context {formatVersion(item.input_snapshot?.context_version)}</span><div><i>项目目标</i>{sources.map(source => <i key={`${source.stage}-${source.version}`}>{source.title} · {formatVersion(source.version)}</i>)}{sourceFiles.map(file => <i key={file.id}>资料 · {file.name}{file.truncated ? '（已截取）' : ''}</i>)}{!sources.length && !sourceFiles.length && <i>暂无已确认阶段产出或资料</i>}</div></div><div className="run-skill-snapshot"><span><Icon name="robot" size={13} />执行配置 · {config?.model_name || '默认模型'}</span><div>{config?.skills?.length ? config.skills.map(skill => <i key={skill.id}>{skill.name} · {formatVersion(skill.version)}</i>) : <i>平台默认阶段规范</i>}</div></div>{runtimeLabel && <div className="run-runtime"><span>{runtimeLabel}</span><i>{item.run_metadata?.turns || 0} 轮</i><i>{item.run_metadata?.tool_calls || 0} 次工具调用</i>{Boolean(item.run_metadata?.usage?.total_tokens) && <i>{item.run_metadata?.usage?.total_tokens} Tokens</i>}</div>}{displayError && <small className="task-error">{displayError}</small>}{item.status === 'NEED_HUMAN' && <small className="task-warning">{item.output}</small>}</article>
  })}</div>}</div>
}

function ArtifactsPage({ project, artifacts, files, onDecision, onRevise, onUpload, onDownload, onNotice }: { project: Project; artifacts: Artifact[]; files: ProjectFile[]; onDecision: (artifact: Artifact, action: 'approve' | 'reject') => void; onRevise: (agent: AgentKey, instruction?: string, stageId?: StageKey) => void; onUpload: (file: File) => Promise<void>; onDownload: (file: ProjectFile) => void; onNotice: (text: string) => void }) {
  const [selected, setSelected] = useState<Artifact | null>(null)
  const [activeTab, setActiveTab] = useState(0)
  const uploadRef = useRef<HTMLInputElement>(null)
  const visibleArtifacts = activeTab === 0 ? artifacts.filter(item => item.status !== 'SUPERSEDED') : artifacts
  return <><PageTitle title="文件与产出" description="正式产出必须由项目负责人明确确认；最新已确认版本才会进入共享 Context" /><section className="page-card"><PanelHead tabs={['项目产出', '版本历史']} activeTab={activeTab} onTab={setActiveTab} />{visibleArtifacts.length === 0 ? <div className="page-empty"><Icon name="folder" size={32} /><b>{activeTab === 0 ? '暂无产出' : '暂无历史版本'}</b><p>{activeTab === 0 ? '请先执行当前阶段任务。' : '阶段产出更新后会保留在这里。'}</p></div> : <div className="artifact-cards">{visibleArtifacts.map(item => { const stage = stageOf(item.stage); return <article className={item.status === 'SUPERSEDED' ? 'superseded' : ''} key={item.id} onClick={() => setSelected(item)}><header><i className={`artifact-stage ${stage?.color || 'violet'}`}><Icon name="document" size={18} /></i><div><small>{stage?.label || '自定义 Agent'} · {formatVersion(item.version)}</small><h3>{item.title}</h3></div><em>{item.status === 'APPROVED' ? 'Context 当前版' : item.status === 'SUPERSEDED' ? '历史版本' : item.status === 'REJECTED' ? '已驳回' : '待确认'}</em></header><p>{item.content.replace(/[#*]/g, '').slice(0, 180)}…</p>{item.status === 'PENDING_REVIEW' ? <footer><button className="outline-button" onClick={event => { event.stopPropagation(); onDecision(item, 'reject') }}>要求修改</button><button className="primary-button" onClick={event => { event.stopPropagation(); onDecision(item, 'approve') }}>确认通过并进入下一阶段</button></footer> : item.status === 'APPROVED' ? <footer><span>成员与 Agent 正在共享此版本</span><button className="outline-button" onClick={event => { event.stopPropagation(); onRevise(item.stage) }}>更新此阶段</button></footer> : null}</article> })}</div>}</section>{activeTab === 0 && <section className="page-card project-files-card"><PanelHead title={`项目资料（${files.length}）`} action={<><input ref={uploadRef} className="hidden-file-input" type="file" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { await onUpload(file) } catch (error) { onNotice(error instanceof Error ? error.message : '上传失败') } finally { event.target.value = '' } }} /><button className="primary-button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={14} />上传资料</button></>} />{files.length === 0 ? <div className="page-empty compact"><Icon name="upload" size={28} /><b>暂无项目资料</b><p>上传访谈、数据或参考文档，供成员共同使用。</p></div> : <div className="project-file-list">{files.map(file => <button key={file.id} onClick={() => onDownload(file)}><i className={`file-type ${fileTone(file)}`}><Icon name="document" size={16} /></i><span><b>{file.name}</b><small>{formatFileSize(file.size)} · {file.uploaded_by}</small></span><em>下载</em></button>)}</div>}</section>}{selected && <ArtifactDrawer artifact={selected} close={() => setSelected(null)} onDecision={onDecision} onCopy={async () => { try { await navigator.clipboard.writeText(selected.content); onNotice('已复制完整内容') } catch { onNotice('复制失败，请检查浏览器权限') } }} />}</>
}
function ArtifactDrawer({ artifact, close, onDecision, onCopy }: { artifact: Artifact; close: () => void; onDecision: (artifact: Artifact, action: 'approve' | 'reject') => void; onCopy: () => void }) {
  const stage = stageOf(artifact.stage) || { label: '自定义 Agent', agent: artifact.stage, color: 'violet' }
  return <div className="drawer-backdrop" role="dialog" aria-modal="true" onMouseDown={close}><aside className="artifact-drawer" onMouseDown={event => event.stopPropagation()}><header><div><small>{stage.label} · {formatVersion(artifact.version)}</small><h2>{artifact.title}</h2></div><button onClick={close}>×</button></header><div className="artifact-meta"><span><AgentBadge agent={stage.agent} color={stage.color} />{AGENT_NAMES[stage.agent]}</span><em>{artifact.status === 'PENDING_REVIEW' ? '等待项目负责人确认' : artifact.status === 'APPROVED' ? '共享 Context 当前版' : artifact.status === 'SUPERSEDED' ? '历史版本' : '已驳回'}</em></div><article className="artifact-content">{artifact.content}</article><footer><button className="outline-button" onClick={onCopy}>复制全文</button>{artifact.status === 'PENDING_REVIEW' && <><button className="outline-button danger-soft" onClick={() => { onDecision(artifact, 'reject'); close() }}>要求修改</button><button className="primary-button" onClick={() => { onDecision(artifact, 'approve'); close() }}>确认通过并进入下一阶段</button></>}</footer></aside></div>
}
const ROLE_LABELS: Record<MemberRole, string> = { owner: '项目负责人', admin: '管理员', member: '协作成员' }

function MembersPage({ project, user, onUpdate, onRoleChange, onRemove, onNotice }: {
  project: Project; user: UserInfo | null | undefined
  onUpdate: (members: string[]) => Promise<void>
  onRoleChange: (mis: string, role: 'admin' | 'member') => Promise<void>
  onRemove: (mis: string) => Promise<void>
  onNotice: (text: string) => void
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const myMis = user?.mis || ''
  const ownerKey = project.owner_mis || project.owner_name
  const myRole: MemberRole = project.is_public_demo ? 'owner' : (project.member_roles?.[myMis] as MemberRole) || (myMis === ownerKey ? 'owner' : 'member')
  const canManage = myRole === 'owner' || myRole === 'admin'

  const uniqueMis = [...new Set([ownerKey, ...project.members])]
  const memberName = (mis: string, index = 0) => project.member_profiles?.find(profile => profile.mis === mis)?.name || project.member_names?.[mis] || (mis === project.owner_mis ? project.owner_name : '') || `项目成员 ${index + 1}`
  const getRole = (mis: string): MemberRole => (project.member_roles?.[mis] as MemberRole) || (mis === ownerKey ? 'owner' : 'member')

  const invite = async (mis: string) => {
    if (uniqueMis.includes(mis)) { onNotice('该成员已在项目中'); return }
    try { await onUpdate([...project.members, mis]); setInviteOpen(false); onNotice(`已邀请 ${mis}`) } catch (error) { onNotice(error instanceof Error ? error.message : '邀请失败') }
  }
  const handleRoleChange = async (mis: string, role: 'admin' | 'member') => {
    try { await onRoleChange(mis, role); setMenuFor(null); onNotice(`已将 ${mis} 设为「${ROLE_LABELS[role]}」`) } catch (error) { onNotice(error instanceof Error ? error.message : '权限设置失败') }
  }
  const handleRemove = async (mis: string) => {
    try { await onRemove(mis); setMenuFor(null); onNotice(`已移除 ${mis}`) } catch (error) { onNotice(error instanceof Error ? error.message : '移除失败') }
  }

  return <>
    <PageTitle title="成员与权限" description="项目创建者自动成为项目负责人，可授权成员为管理员或协作成员" />
    <section className="page-card">
      <PanelHead title={`项目成员（${uniqueMis.length}）`} action={canManage ? <button className="primary-button" onClick={() => setInviteOpen(true)}><Icon name="plus" size={14} />邀请成员</button> : undefined} />
      {uniqueMis.map((mis, index) => {
        const role = getRole(mis)
        const isSelf = mis === myMis
        const name = memberName(mis, index)
        return <div className="member-row" key={mis}>
          <Avatar name={name} mis={mis} />
          <b>{name}</b>
          <span className={`role-badge role-${role}`}>{ROLE_LABELS[role]}</span>
          {isSelf && <em>我自己</em>}
          <div className="member-menu-wrap">
            {canManage && !isSelf && role !== 'owner' && <>
              <button className="panel-more" aria-label={`管理 ${mis}`} onClick={() => setMenuFor(menuFor === mis ? null : mis)}><Icon name="more" size={18} /></button>
              {menuFor === mis && <div className="member-menu">
                {myRole === 'owner' && role !== 'admin' && <button onClick={() => handleRoleChange(mis, 'admin')}>设为管理员</button>}
                {role === 'admin' && <button onClick={() => handleRoleChange(mis, 'member')}>设为协作成员</button>}
                <button className="danger-text" onClick={() => handleRemove(mis)}>移出项目</button>
              </div>}
            </>}
          </div>
        </div>
      })}
    </section>
    {inviteOpen && <InviteMemberModal close={() => setInviteOpen(false)} submit={invite} />}
  </>
}
function AgentAdminHome({ agents, skills, user, onHome, onProjects, onCreate, onUpload, onSave, onCreateAgent, onDeleteAgent, onArchive, onNotice }: { agents: AgentConfiguration[]; skills: Skill[]; user?: UserInfo | null; onHome: () => void; onProjects: () => void; onCreate: () => void; onUpload: (files: File[]) => Promise<void>; onSave: (agent: AgentKey, changes: AgentChanges) => Promise<void>; onCreateAgent: (changes: { display_name: string; description: string; model_name?: string }) => Promise<void>; onDeleteAgent: (agent: AgentConfiguration) => Promise<void>; onArchive: (skill: Skill) => Promise<void>; onNotice: (text: string) => void }) {
return <main className="home agent-admin-home reference-home"><header className="home-header"><button className="brand" onClick={onHome}><span className="brand-mark"><AppIcon size={24} /></span><strong>AI Team</strong><em>v2.1.0</em></button><nav className="home-primary-nav" aria-label="首页导航"><button onClick={onHome}><Icon name="dashboard" size={15} />首页</button><button onClick={onProjects}>全部项目</button><button className="active">Agent 与 Skill<span>{skills.length}</span></button></nav><div className="home-header-actions"><button className="primary-button" onClick={onCreate}><Icon name="plus" size={15} />新建项目</button><div className="home-profile compact"><UserAvatar user={user} fallback="本地用户" /><span>{userLabel(user, '本地用户')}</span></div></div></header><div className="agent-admin-shell surface-transition"><AgentConfigurationPage agents={agents} skills={skills} onUpload={onUpload} onSave={onSave} onCreateAgent={onCreateAgent} onDeleteAgent={onDeleteAgent} onArchive={onArchive} onNotice={onNotice} /></div></main>
}
function AgentConfigurationPage({ agents, skills, onUpload, onSave, onCreateAgent, onDeleteAgent, onArchive, onNotice }: { agents: AgentConfiguration[]; skills: Skill[]; onUpload: (files: File[]) => Promise<void>; onSave: (agent: AgentKey, changes: AgentChanges) => Promise<void>; onCreateAgent: (changes: { display_name: string; description: string; model_name?: string }) => Promise<void>; onDeleteAgent: (agent: AgentConfiguration) => Promise<void>; onArchive: (skill: Skill) => Promise<void>; onNotice: (text: string) => void }) {
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>('clarify'); const [tab, setTab] = useState<'agents' | 'skills' | 'model'>('agents'); const [createAgentOpen, setCreateAgentOpen] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null); const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [dragging, setDragging] = useState(false)
  const [checkingModel, setCheckingModel] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null); const folderRef = useRef<HTMLInputElement>(null); const agent = agents.find(item => item.agent_type === selectedAgent) || agents[0]
  const boundIds = agent?.skills.map(item => item.id) || []
  const persistSkills = async (skillIds: string[]) => { if (!agent) return; setSaving(true); try { await onSave(agent.agent_type, { skill_ids: skillIds }) } catch (error) { onNotice(error instanceof Error ? error.message : '保存失败') } finally { setSaving(false) } }
  const toggleSkill = (skill: Skill) => persistSkills(boundIds.includes(skill.id) ? boundIds.filter(id => id !== skill.id) : [...boundIds, skill.id])
  const moveSkill = (skillId: string, direction: -1 | 1) => { const current = boundIds.indexOf(skillId); const target = current + direction; if (current < 0 || target < 0 || target >= boundIds.length) return; const next = [...boundIds]; [next[current], next[target]] = [next[target], next[current]]; persistSkills(next) }
  const handleUpload = async (files: File[]) => { if (!files.length) return; setUploading(true); try { await onUpload(files); setTab('skills') } catch (error) { onNotice(error instanceof Error ? error.message : '上传失败') } finally { setUploading(false); setDragging(false) } }
  const confirmArchive = (skill: Skill) => { if (!window.confirm(`确认归档《${skill.name}》？归档后不会再出现在 Skill 资产库中。`)) return; onArchive(skill).catch(error => onNotice(error instanceof Error ? error.message : '归档失败')) }
  const checkModel = async () => { setCheckingModel(true); try { const result = await request<{ status: string; model: string; latency_ms: number }>('/system/model-health'); onNotice(`模型 ${result.model} 响应正常（${result.latency_ms}ms）`) } catch (error) { onNotice(error instanceof Error ? error.message : '模型检查失败') } finally { setCheckingModel(false) } }
  const activeAgents = agents.filter(item => item.status === 'ACTIVE').length
  return <><section className={`agent-config-title ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }} onDrop={event => { event.preventDefault(); handleUpload([...event.dataTransfer.files]) }}><div><span>AGENT ORCHESTRATION</span><h1>Agent 配置中心</h1><p>每个 Agent 都是独立配置文件夹，并按顺序挂载可复用的 Skill 文件夹。</p></div><div className="agent-config-metrics"><article><b>{agents.length}</b><span>全部 Agent</span></article><article><b>{skills.length}</b><span>Skill 资产</span></article><article><b>{activeAgents}</b><span>运行中</span></article><button className="outline-button" disabled={checkingModel} onClick={checkModel}><Icon name="sparkles" size={15} />{checkingModel ? '检测中…' : '测试模型'}</button><button className="outline-button" onClick={() => setCreateAgentOpen(true)}><Icon name="plus" size={15} />新建 Agent</button><button className="outline-button" onClick={() => folderRef.current?.click()}><Icon name="folder" size={15} />选择文件夹</button><button className="primary-button" onClick={() => uploadRef.current?.click()}><Icon name="upload" size={15} />上传 Skill 包</button><input ref={uploadRef} className="hidden-file-input" type="file" multiple accept=".md,.txt,.json,.yaml,.yml,.zip,.skill" onChange={event => { const files = [...(event.target.files || [])]; handleUpload(files); event.target.value = '' }} /><input ref={folderRef} className="hidden-file-input" type="file" multiple {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={event => { const files = [...(event.target.files || [])]; handleUpload(files); event.target.value = '' }} /></div>{dragging && <div className="skill-drop-overlay"><Icon name="upload" size={25} /><b>松开即可上传 Skill 包</b><span>文件夹需包含 SKILL.md，并会保留完整目录结构</span></div>}</section>
    <section className="agent-config-tabs"><button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}><Icon name="robot" size={16} />Agent 编排</button><button className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}><Icon name="document" size={16} />Skill 资产库 <em>{skills.length}</em></button><button className={tab === 'model' ? 'active' : ''} onClick={() => setTab('model')}><Icon name="settings" size={16} />模型连接</button><span>{uploading ? '正在解析 Skill…' : tab === 'model' ? '配置仅对当前用户生效' : '上传后可绑定给多个 Agent'}</span></section>
    {tab === 'agents' && <div className="agent-config-layout"><aside className="agent-roster">{agents.map(item => { const stage = STAGES.find(stageItem => stageItem.agent === item.agent_type); return <button key={item.agent_type} className={item.agent_type === agent?.agent_type ? 'active' : ''} onClick={() => setSelectedAgent(item.agent_type)}><AgentBadge agent={item.agent_type} color={stage?.color || 'red'} size="large" /><span><b>{item.display_name}</b><small>{item.stage_label} · {item.skills.length} 个 Skill</small></span><i className={item.status.toLowerCase()} /></button> })}</aside>{agent && <section className="agent-editor"><header><div className="agent-identity"><AgentBadge agent={agent.agent_type} color={STAGES.find(item => item.agent === agent.agent_type)?.color || 'red'} size="large" /><div><span>{agent.stage_label.toUpperCase()}</span><h2>{agent.display_name}</h2><p>{agent.description}</p></div></div>{!agent.is_builtin && <button className="outline-button danger-soft" onClick={() => { if (window.confirm(`确认删除「${agent.display_name}」？请先将它从所有项目工作流移除。`)) onDeleteAgent(agent).catch(error => onNotice(error instanceof Error ? error.message : '删除失败')) }}>删除</button>}<label className="agent-switch"><input type="checkbox" checked={agent.status === 'ACTIVE'} onChange={event => onSave(agent.agent_type, { status: event.target.checked ? 'ACTIVE' : 'DISABLED' }).catch(error => onNotice(error instanceof Error ? error.message : '保存失败'))} /><i /><span>{agent.status === 'ACTIVE' ? '运行中' : '已停用'}</span></label></header><div className="agent-model-row"><div><small>推理模型</small><b>{agent.model_name}</b></div><div><small>Context 范围</small><b>项目全部已确认内容</b></div><div><small>生效方式</small><b>新任务自动快照</b></div></div><div className="binding-head"><div><h3>已绑定 Skill</h3><p>Agent 会按顺序读取并执行，越靠前优先级越高。</p></div><span>{boundIds.length} 个已启用</span></div><div className="bound-skill-list">{agent.skills.map((skill, index) => <article key={skill.id}><i className="skill-grip">⋮⋮</i><span className="skill-sequence">{String(index + 1).padStart(2, '0')}</span><div><b>{skill.name}</b><p>{skill.description}</p><small>{skill.source_name} · {formatVersion(skill.version)}</small></div><button disabled={saving || index === 0} aria-label="上移" onClick={() => moveSkill(skill.id, -1)}>↑</button><button disabled={saving || index === agent.skills.length - 1} aria-label="下移" onClick={() => moveSkill(skill.id, 1)}>↓</button><button className="remove-binding" disabled={saving} onClick={() => toggleSkill(skill)}>移除</button></article>)}{agent.skills.length === 0 && <div className="binding-empty"><Icon name="link" size={24} /><b>还没有绑定 Skill</b><p>从下方资产库选择一个或多个 Skill。</p></div>}</div><div className="skill-picker"><header><b>添加 Skill</b><span>同一个 Skill 可以复用给多个 Agent</span></header><div>{skills.map(skill => <button key={skill.id} className={boundIds.includes(skill.id) ? 'selected' : ''} disabled={saving} onClick={() => toggleSkill(skill)}><i><Icon name={boundIds.includes(skill.id) ? 'link' : 'plus'} size={14} /></i><span><b>{skill.name}</b><small>{formatVersion(skill.version)} · {skill.bound_agents.length} 个 Agent 在使用</small></span><em>{boundIds.includes(skill.id) ? '已绑定' : '绑定'}</em></button>)}</div></div></section>}</div>}
    {tab === 'skills' && <section className="skill-library"><header><div><h2>Skill 文件夹资产库</h2><p>标准包以 SKILL.md 为入口，并保留 scripts、references、assets 等目录。</p></div><button className="outline-button" onClick={() => folderRef.current?.click()}><Icon name="folder" size={15} />选择文件夹</button></header><div className="skill-grid">{skills.map(skill => <article key={skill.id}><header><i><Icon name="folder" size={18} /></i><span>{skill.is_builtin ? '平台内置' : `V${skill.version}`}</span></header><h3>{skill.name}</h3><p>{skill.description}</p><div className="skill-agent-tags"><span>{skill.files?.length || 1} 个文件</span>{skill.bound_agents.slice(0, 3).map(agentKey => <span key={agentKey}>{agents.find(item => item.agent_type === agentKey)?.display_name || AGENT_NAMES[agentKey] || agentKey}</span>)}{skill.bound_agents.length === 0 && <span className="unused">暂未挂载</span>}</div><footer><small>{skill.created_by} · {formatFileSize(skill.size)}</small><div><button onClick={() => setSelectedSkill(skill)}>查看文件夹</button>{!skill.is_builtin && <button disabled={skill.bound_agents.length > 0} title={skill.bound_agents.length > 0 ? '请先从所有 Agent 解绑' : '归档 Skill'} onClick={() => confirmArchive(skill)}>归档</button>}</div></footer></article>)}<button className="skill-upload-card" onClick={() => folderRef.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true) }} onDrop={event => { event.preventDefault(); handleUpload([...event.dataTransfer.files]) }}><i><Icon name="folder" size={23} /></i><b>上传 Skill 文件夹</b><span>根目录必须包含 SKILL.md</span></button></div></section>}
    {tab === 'agents' && agent && <AgentDocumentsEditor agent={agent} onSave={onSave} onNotice={onNotice} />}
    {tab === 'model' && <ModelConnectionPanel onNotice={onNotice} />}
    {selectedSkill && <SkillPreviewDrawer skill={selectedSkill} close={() => setSelectedSkill(null)} onNotice={onNotice} />}
    {createAgentOpen && <CreateAgentModal close={() => setCreateAgentOpen(false)} submit={async changes => { await onCreateAgent(changes); setCreateAgentOpen(false) }} />}
  </>
}
function ModelConnectionPanel({ onNotice }: { onNotice: (text: string) => void }) {
  const providers: { value: ModelProvider; label: string; hint: string; baseUrl: string; model: string; apiVersion?: string }[] = [
    { value: 'openai_responses', label: 'OpenAI · Responses API', hint: '推荐用于最新 OpenAI 模型', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    { value: 'openai_chat', label: 'OpenAI · Chat Completions', hint: '兼容经典 OpenAI 模型', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { value: 'openai_compatible', label: 'OpenAI-compatible', hint: 'DeepSeek、通义、Kimi、智谱、OpenRouter、Groq、Mistral、xAI、SiliconFlow、vLLM 等', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { value: 'azure_openai', label: 'Azure OpenAI', hint: '模型名填写 Deployment Name', baseUrl: 'https://YOUR-RESOURCE.openai.azure.com', model: 'YOUR-DEPLOYMENT', apiVersion: '2024-10-21' },
    { value: 'anthropic', label: 'Anthropic · Messages API', hint: 'Claude 原生接口', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', apiVersion: '2023-06-01' },
    { value: 'gemini', label: 'Google Gemini · GenerateContent', hint: 'Gemini 原生接口', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
    { value: 'ollama', label: 'Ollama · Local Chat', hint: '本机或私有网络模型，无鉴权时 API Key 可留空', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' },
  ]
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(null)
  const [provider, setProvider] = useState<ModelProvider>('openai_responses')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelName, setModelName] = useState('')
  const [apiVersion, setApiVersion] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const load = async () => {
    const value = await request<ModelConfiguration>('/system/model-configuration')
    setConfiguration(value); setProvider(value.provider); setBaseUrl(value.base_url); setModelName(value.model_name); setApiVersion(value.api_version || ''); setApiKey('')
  }
  useEffect(() => { load().catch(error => onNotice(error instanceof Error ? error.message : '模型配置加载失败')) }, [])
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const value = await request<ModelConfiguration>('/system/model-configuration', { method: 'PUT', body: JSON.stringify({ provider, base_url: baseUrl.trim(), model_name: modelName.trim(), api_version: apiVersion.trim(), api_key: apiKey.trim() || undefined }) })
      setConfiguration(value); setApiKey(''); onNotice('模型连接已保存，仅对当前用户生效')
    } catch (error) { onNotice(error instanceof Error ? error.message : '模型连接保存失败') } finally { setSaving(false) }
  }
  const reset = async () => {
    if (!window.confirm('确认删除个人模型连接并恢复部署环境的默认配置？')) return
    try { await request<ModelConfiguration>('/system/model-configuration', { method: 'DELETE' }); await load(); onNotice('已恢复环境默认模型配置') } catch (error) { onNotice(error instanceof Error ? error.message : '恢复失败') }
  }
  if (!configuration) return <section className="model-connection-card"><p>正在加载模型配置…</p></section>
  const selectedProvider = providers.find(item => item.value === provider) || providers[0]
  return <form className="model-connection-card" onSubmit={save}><header><div><span>MODEL CONNECTION</span><h2>个人模型连接</h2><p>覆盖 OpenAI 原生接口、主流厂商原生协议和 OpenAI-compatible 服务。配置与账号绑定，密钥只会加密保存在后端。</p></div><em>{configuration.source === 'user' ? '个人配置' : '环境默认'}</em></header><div className="model-connection-fields"><label>接口协议<select value={provider} onChange={event => { const next = providers.find(item => item.value === event.target.value)!; setProvider(next.value); setBaseUrl(next.baseUrl); setModelName(next.model); setApiVersion(next.apiVersion || '') }}>{providers.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{selectedProvider.hint}</small></label><label>模型名称<input required value={modelName} onChange={event => setModelName(event.target.value)} placeholder={selectedProvider.model} /></label><label>API Base URL<input type="url" required value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={selectedProvider.baseUrl} /></label>{(provider === 'azure_openai' || provider === 'anthropic') && <label>API Version<input value={apiVersion} onChange={event => setApiVersion(event.target.value)} placeholder={selectedProvider.apiVersion} /></label>}<label>API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configuration.has_api_key ? '已保存；留空保持不变' : provider === 'ollama' ? '本地 Ollama 通常可留空' : '请输入供应商 API Key'} /></label></div><footer><span>{configuration.has_api_key ? '已配置 API Key，页面不会读取或显示明文。' : provider === 'ollama' ? '本地服务允许无密钥连接。' : '保存密钥后即可调用模型。'}</span><div>{configuration.source === 'user' && <button type="button" className="outline-button" onClick={reset}>恢复默认</button>}<button type="button" className="outline-button" onClick={async () => { try { const result = await request<{ provider_label: string; model: string; latency_ms: number }>('/system/model-health'); onNotice(`${result.provider_label} · ${result.model} 响应正常（${result.latency_ms}ms）`) } catch (error) { onNotice(error instanceof Error ? error.message : '模型检查失败') } }}>测试连接</button><button className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存连接'}</button></div></footer></form>
}
function AgentDocumentsEditor({ agent, onSave, onNotice }: { agent: AgentConfiguration; onSave: (agent: AgentKey, changes: AgentChanges) => Promise<void>; onNotice: (text: string) => void }) {
  const [identity, setIdentity] = useState(agent.identity_md || '')
  const [soul, setSoul] = useState(agent.soul_md || '')
  const [instructions, setInstructions] = useState(agent.instructions_md || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setIdentity(agent.identity_md || ''); setSoul(agent.soul_md || ''); setInstructions(agent.instructions_md || '') }, [agent.agent_type, agent.version])
  const save = async () => { setSaving(true); try { await onSave(agent.agent_type, { identity_md: identity, soul_md: soul, instructions_md: instructions }); onNotice(`Agent 配置 V${agent.version + 1} 已保存`) } catch (error) { onNotice(error instanceof Error ? error.message : '配置保存失败') } finally { setSaving(false) } }
  return <section className="agent-documents-card"><header><div><span>AGENT FOLDER</span><h2>Agent 配置文件夹</h2><p>运行时读取 Agent 文件，并按 skills.json 的顺序挂载 Skill 文件夹。</p></div><em>{formatVersion(agent.version)}{agent.generated ? ' · 自动生成' : ''}</em></header><div className="agent-folder-tree"><b><Icon name="folder" size={14} />{agent.agent_type}/</b><span>├─ IDENTITY.md</span><span>├─ SOUL.md</span><span>├─ AGENT.md</span><span>└─ skills.json</span>{agent.skills.map((skill, index) => <small key={skill.id}>　 {String(index + 1).padStart(2, '0')} → skills/{skill.id}/ · {skill.name}</small>)}</div><div className="agent-document-grid"><label><b>IDENTITY.md</b><small>角色定位与对外身份</small><textarea value={identity} onChange={event => setIdentity(event.target.value)} /></label><label><b>SOUL.md</b><small>原则、语气与决策风格</small><textarea value={soul} onChange={event => setSoul(event.target.value)} /></label><label><b>AGENT.md</b><small>职责、输入输出与完成标准</small><textarea value={instructions} onChange={event => setInstructions(event.target.value)} /></label></div><footer><span>修改只影响之后创建的任务，历史任务继续使用原快照。</span><button className="primary-button" disabled={saving || !identity.trim() || !instructions.trim()} onClick={save}>{saving ? '保存中…' : '保存新版本'}</button></footer></section>
}
function CreateAgentModal({ close, submit }: { close: () => void; submit: (changes: { display_name: string; description: string; model_name?: string }) => Promise<void> }) {
  const [saving, setSaving] = useState(false)
  return <div className="modal" role="dialog" aria-modal="true"><form onSubmit={async event => { event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); try { await submit({ display_name: String(form.get('name') || '').trim(), description: String(form.get('description') || '').trim(), model_name: String(form.get('model') || '').trim() || undefined }) } finally { setSaving(false) } }}><header><div><span>NEW AGENT</span><h2>创建自定义 Agent</h2></div><button type="button" onClick={close}>×</button></header><p className="modal-description">创建后可绑定 Skill，并在项目「任务与流程」中拖入任意位置。它会读取所有前序 Agent 已确认的产出。</p><label>Agent 名称<input name="name" required minLength={2} maxLength={80} placeholder="例如：竞品研究 Agent" /></label><label>职责说明<textarea name="description" maxLength={500} placeholder="说明该 Agent 的输入、分析职责和预期产出" /></label><label>推理模型<input name="model" maxLength={100} placeholder="留空使用系统默认模型" /></label><footer><button type="button" className="outline-button" onClick={close}>取消</button><button className="primary-button" disabled={saving}>{saving ? '创建中…' : '创建 Agent'}</button></footer></form></div>
}
function SkillPreviewDrawer({ skill, close, onNotice }: { skill: Skill; close: () => void; onNotice: (text: string) => void }) {
  const [detail, setDetail] = useState<Skill | null>(skill.content ? skill : null)
  useEffect(() => { if (!skill.content) request<Skill>(`/skills/${skill.id}`).then(setDetail).catch(error => onNotice(error instanceof Error ? error.message : 'Skill 加载失败')) }, [skill.id])
  return <div className="drawer-backdrop" role="dialog" aria-modal="true" onMouseDown={close}><aside className="artifact-drawer skill-preview-drawer" onMouseDown={event => event.stopPropagation()}><header><div><small>SKILL FOLDER · {formatVersion(skill.version)}</small><h2>{skill.name}</h2></div><button onClick={close}>×</button></header><div className="skill-preview-meta"><span>{skill.source_name}</span><span>{skill.created_by}</span><span>{formatFileSize(skill.size)}</span></div><div className="skill-file-tree"><b><Icon name="folder" size={14} />{skill.name}/</b>{(detail?.files || skill.files || []).map(file => <span key={file.path}>├─ {file.path}<small>{file.kind} · {formatFileSize(file.size)}</small></span>)}</div><article className="artifact-content">{detail?.content || '正在读取 SKILL.md…'}</article><footer><button className="outline-button" onClick={close}>关闭</button></footer></aside></div>
}
function SettingsPage({ project, onSave, onNotificationChange, onNotice }: { project: Project; onSave: (changes: Partial<Pick<Project, 'name' | 'problem' | 'goal' | 'background'>>) => Promise<void>; onNotificationChange: (enabled: boolean) => void; onNotice: (text: string) => void }) {
  const [name, setName] = useState(project.name); const [problem, setProblem] = useState(project.problem); const [goal, setGoal] = useState(project.goal); const [background, setBackground] = useState(project.background)
  const [notifyAgent, setNotifyAgent] = useState(() => localStorage.getItem(`notify:${project.id}`) !== '0'); const [saving, setSaving] = useState(false)
  useEffect(() => { setName(project.name); setProblem(project.problem); setGoal(project.goal); setBackground(project.background) }, [project.id, project.name, project.problem, project.goal, project.background])
  return <><PageTitle title="项目设置" description="调整项目基础信息与协作偏好" /><form className="page-card settings-card" onSubmit={async event => { event.preventDefault(); setSaving(true); try { await onSave({ name, problem, goal, background }); localStorage.setItem(`notify:${project.id}`, notifyAgent ? '1' : '0'); onNotificationChange(notifyAgent); onNotice('项目设置已保存并同步到共享 Context') } catch (error) { onNotice(error instanceof Error ? error.message : '保存失败') } finally { setSaving(false) } }}><PanelHead title="基础设置" /><label>项目名称<input required minLength={2} maxLength={30} value={name} onChange={event => setName(event.target.value)} /></label><label>核心问题<textarea required minLength={8} maxLength={500} value={problem} onChange={event => setProblem(event.target.value)} /></label><label>项目目标<textarea required minLength={4} maxLength={300} value={goal} onChange={event => setGoal(event.target.value)} /></label><label>补充背景<textarea maxLength={2000} value={background} onChange={event => setBackground(event.target.value)} /></label><label>项目状态<span className="setting-static">{project.status === 'ACTIVE' ? '进行中 · 请在任务与流程中结束项目' : '已完成'}</span></label><label>协作通知<span><input type="checkbox" checked={notifyAgent} onChange={event => setNotifyAgent(event.target.checked)} /> Agent 产出完成后通知我</span></label><footer><button className="primary-button" disabled={saving}>{saving ? '保存中…' : '保存设置'}</button></footer></form></>
}
function InfoBlock({ label, value }: { label: string; value: string }) { return <article><small>{label}</small><p>{value}</p></article> }

const HOME_RELAY_AGENTS = [
  { key: 'clarify', label: '需求澄清 Agent', className: 'relay-agent-clarify', skills: ['需求澄清', '材料总结'] },
  { key: 'insight', label: '需求洞察 Agent', className: 'relay-agent-insight', skills: ['用户洞察', '机会分析'] },
  { key: 'mrd', label: 'MRD Agent', className: 'relay-agent-mrd', skills: ['市场研究', 'MRD 撰写'] },
  { key: 'solution', label: '方案设计 Agent', className: 'relay-agent-solution', skills: ['方案设计', '风险分析'] },
  { key: 'ux', label: '交互设计 Agent', className: 'relay-agent-ux', skills: ['体验设计', '原型规划'] },
  { key: 'prd', label: 'PRD Agent', className: 'relay-agent-prd', skills: ['PRD 撰写', '验收标准'] },
] as const

function ContextRelayDiagram({ agents, onAgents }: { agents: AgentConfiguration[]; onAgents: () => void }) {
  const [phase, setPhase] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const [visible, setVisible] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setPhase(value => (value + 1) % 11), 1000)
    return () => window.clearInterval(timer)
  }, [visible])
  const activeKey = phase === 1 || phase === 2 ? 'clarify' : phase === 3 || phase === 4 ? 'solution' : phase === 5 ? 'prd' : phase === 6 || phase === 7 ? 'human' : phase === 8 ? 'question' : null
  const completedKey = phase === 3 ? 'clarify' : phase === 5 ? 'solution' : phase === 6 ? 'prd' : phase === 8 ? 'human' : null
  return <div ref={rootRef} className={`relay-diagram phase-${phase} ${hovered ? 'is-hovering' : ''}`}>
    <div className="relay-rings" aria-hidden="true"><i /><i /><i /></div>
    {HOME_RELAY_AGENTS.map((item, index) => <span key={`line-${item.key}`} className={`relay-link relay-link-${item.key}`} aria-hidden="true"><i /></span>)}
    <span className="relay-link relay-link-human" aria-hidden="true"><i /></span>
    <span className="relay-link relay-link-question" aria-hidden="true"><i /></span>
    <div className="relay-context">
      <img className="relay-planet-image" src={relaySaturnUrl} alt="" aria-hidden="true" />
      <span className="relay-planet-shine" aria-hidden="true" />
      <i><Icon name="link" size={34} /></i><b>共享 Context</b><small>项目唯一信息源</small>
    </div>
    {HOME_RELAY_AGENTS.map((item, index) => {
      const config = agents.find(agent => agent.agent_type === item.key)
      const isActive = activeKey === item.key
      const isComplete = completedKey === item.key
      return <button key={item.key} className={`relay-agent ${item.className} ${isActive ? 'active' : ''} ${isComplete ? 'complete' : ''} ${hovered === item.key ? 'hovered' : ''}`} onMouseEnter={() => setHovered(item.key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(item.key)} onBlur={() => setHovered(null)} onClick={onAgents}>
        <span className="relay-avatar"><img src={avatarAssetUrlFor(index + 1)} alt="" /></span>
        <span className="relay-agent-copy"><b>{config?.display_name || item.label}</b><small>{isActive ? '执行中' : isComplete ? '已完成' : `已挂载 ${config?.skills.length || 3} 个 Skill`}</small></span>
        <em className="relay-status">{isComplete ? '✓' : isActive ? '···' : ''}</em>
        <span className="relay-skill-tip">{item.skills.map(skill => <i key={skill}>{skill}</i>)}</span>
      </button>
    })}
    <button className={`relay-human ${activeKey === 'human' ? 'active' : ''} ${completedKey === 'human' ? 'complete' : ''}`} onMouseEnter={() => setHovered('human')} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered('human')} onBlur={() => setHovered(null)}>
      <span><Icon name="users" size={22} /></span><b>人工决策点</b><small>{phase === 6 ? '等待确认' : phase === 7 || phase === 8 ? '已确认 ✓' : '确认结果与关键变更'}</small>
    </button>
    <button className={`relay-question ${activeKey === 'question' ? 'active' : ''}`} onClick={onAgents} onMouseEnter={() => setHovered('question')} onMouseLeave={() => setHovered(null)} aria-label="创建你的 Agent"><b><span>?</span><em>＋</em></b><small>创建你的 Agent</small><i>＋</i></button>
    <div className="relay-caption"><b>任务沿共享 Context 接力推进</b><span>自动协作 · 人工把关 · 随时扩展</span></div>
  </div>
}

function ProjectHome({ projects, agents, skills, homeView, onHomeView, onCreate, onAgents, onOpen, user, onLogout }: { projects: Project[]; agents: AgentConfiguration[]; skills: Skill[]; homeView: 'home' | 'projects'; onHomeView: (view: 'home' | 'projects') => void; onCreate: () => void; onAgents: () => void; onOpen: (id: string, targetView?: ViewKey) => void; user?: UserInfo | null; onLogout: () => Promise<void> }) {
  const [query, setQuery] = useState(''); const [helpOpen, setHelpOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false)
  const pendingTotal = projects.reduce((total, item) => total + (item.pending_context_reviews || 0), 0)
  const normalizedQuery = query.trim().toLowerCase()
  const visibleProjects = projects.filter(item => `${item.name} ${item.problem} ${item.goal} ${item.owner_name} ${item.members.join(' ')}`.toLowerCase().includes(normalizedQuery))
  const activeProjects = visibleProjects.filter(item => item.status === 'ACTIVE' && item.current_stage !== 'COMPLETED')
  const historyProjects = visibleProjects.filter(item => item.status !== 'ACTIVE' || item.current_stage === 'COMPLETED')
  const activeCount = projects.filter(item => item.status === 'ACTIVE' && item.current_stage !== 'COMPLETED').length
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('[aria-label="搜索项目"]')?.focus() } }; window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut) }, [])
  const displayName = userLabel(user, '本地用户')
  return <main className="home home-management reference-home"><header className="home-header"><button className="brand" onClick={() => { onHomeView('home'); setQuery('') }}><span className="brand-mark"><AppIcon size={24} /></span><strong>AI Team</strong><em>v2.1.0</em></button><nav className="home-primary-nav" aria-label="首页导航"><button className={homeView === 'home' ? 'active' : ''} onClick={() => { onHomeView('home'); setQuery('') }}><Icon name="dashboard" size={15} />首页</button><button className={homeView === 'projects' ? 'active' : ''} onClick={() => onHomeView('projects')}>全部项目<span>{projects.length}</span></button><button onClick={onAgents}>Agent 与 Skill<span>{skills.length}</span></button></nav><div className="home-header-actions"><label className="search-box"><Icon name="search" size={16} /><input aria-label="搜索项目" value={query} onFocus={() => onHomeView('projects')} onChange={event => { setQuery(event.target.value); onHomeView('projects') }} placeholder="搜索项目、成员或目标" /><kbd>⌘ K</kbd></label><button className="icon-button" aria-label="帮助" onClick={() => setHelpOpen(true)}><Icon name="help" size={18} /></button><button className="primary-button" onClick={onCreate}><Icon name="plus" size={15} />新建项目</button><div className="header-menu-wrap"><button className="home-profile" onClick={() => setProfileOpen(open => !open)}><UserAvatar user={user} fallback="本地用户" /><span>{displayName}</span><span className="down">⌄</span></button>{profileOpen && <div className="header-popover profile-popover home-profile-popover"><header><UserAvatar user={user} fallback="本地用户" /><div><b>{displayName}</b>{user?.mis && <span>{user.mis}</span>}</div></header>{user?.email && <p className="profile-empid">{user.email}</p>}<button onClick={onLogout}><b>退出登录</b><span>清除当前会话</span></button></div>}</div></div></header>
    <div key={homeView} className={`management-shell surface-transition ${homeView === 'home' ? 'landing-shell' : 'projects-shell'}`}>
      {homeView === 'home' ? <>
      <section className="management-intro relay-hero">
        <img className="relay-starfield" src={relayStarsUrl} alt="" aria-hidden="true" />
        <div className="management-intro-copy">
          <div className="relay-earth" aria-hidden="true"><img src={relayEarthUrl} alt="" /></div>
          <span>CONTEXT-DRIVEN AGENT WORKSPACE</span>
          <h1>不止让 Agent 回答，<br />而是让它们<strong>推进项目。</strong></h1>
          <div className="relay-benefits"><p><i><Icon name="link" size={24} /></i><span><b>同一份 Context</b><small>目标、资料、决策与产出集中沉淀</small></span></p><p><i><Icon name="robot" size={24} /></i><span><b>多 Agent 协作</b><small>挂载专业 Skill，阶段接力推进</small></span></p><p><i><Icon name="users" size={24} /></i><span><b>关键节点由人确认</b><small>结果与变更确认后再继续</small></span></p></div>
          <div className="management-hero-actions"><button className="primary-button management-create" onClick={onCreate}><Icon name="plus" size={18} />创建协作项目</button><button className="outline-button relay-demo-button" onClick={onAgents}><Icon name="workflow" size={16} />配置 Agent</button></div>
        </div>
        <div className="management-visual" aria-label="Agent 协作网络">
          <ContextRelayDiagram agents={agents} onAgents={onAgents} />
        </div>
      </section>
      <section className="relay-feature-strip" aria-label="协作能力"><article><i><Icon name="robot" size={24} /></i><div><b>专业角色按需扩展</b><span>自由创建 Agent，快速完成能力拼接</span></div></article><article><i><Icon name="send" size={24} /></i><div><b>减少重复沟通成本</b><span>自动继承已确认信息，结果实时推送</span></div></article><article><i><Icon name="workflow" size={24} /></i><div><b>工作流按项目演进</b><span>以项目阶段为节点，摆脱传统工种划分</span></div></article><article><i><Icon name="document" size={24} /></i><div><b>历史版本随时回溯</b><span>重要产出与决策保留完整版本</span></div></article></section>
      </> : <section className="projects-page">
        <header className="projects-page-head"><div><span>PROJECT LIBRARY</span><h1>全部项目</h1><p>集中管理正在推进的工作与已经沉淀的历史项目。</p></div><button className="primary-button" onClick={onCreate}><Icon name="plus" size={15} />创建新项目</button></header>
        <div className="projects-page-stats"><span><b>{activeCount}</b> 个进行中</span><i /><span><b>{historyProjects.length}</b> 个已完成</span><i /><span><b>{pendingTotal}</b> 条变更待审</span></div>
        {normalizedQuery && visibleProjects.length === 0 ? <section className="management-search-empty"><i><Icon name="search" size={20} /></i><div><b>没有找到“{query.trim()}”</b><span>试试项目名、成员或目标中的其他关键词</span></div><button onClick={() => setQuery('')}>清除搜索</button></section> : <>
        <HomeProjectSection title="待办项目" description="需要继续推进或等待确认的项目" projects={activeProjects} emptyTitle="暂无待办项目" emptyDescription="创建项目后，Agent 会自动规划六个阶段的协作流程。" onCreate={onCreate} onOpen={onOpen} />
        <HomeProjectSection title="历史项目" description="已结束的项目会保留完整 Context、产出和决策记录" projects={historyProjects} emptyTitle="暂无历史项目" emptyDescription="完成的项目会沉淀在这里，随时可回看。" onOpen={onOpen} />
      </>}
      </section>}
    </div>
    {helpOpen && <QuickHelpModal close={() => setHelpOpen(false)} />}
  </main>
}

function HomeProjectSection({ title, description, projects, emptyTitle, emptyDescription, onCreate, onOpen }: { title: string; description: string; projects: Project[]; emptyTitle: string; emptyDescription: string; onCreate?: () => void; onOpen: (id: string, targetView?: ViewKey) => void }) {
  return <section className={`management-section ${onCreate ? 'active-project-section' : 'history-project-section'}`}><header><div><h2>{title}</h2><p>{description}</p></div><span>{projects.length} 个项目</span></header>{projects.length > 0 && !onCreate && <div className="management-table-head"><span>项目</span><span>当前阶段</span><span>进度</span><span>协作成员</span><span>最近更新</span><span /></div>}<div className="management-project-list">{projects.map(project => <HomeProjectRow key={project.id} project={project} onOpen={onOpen} />)}{onCreate && projects.length > 0 && <button className="management-new-card" onClick={onCreate}><i><Icon name="plus" size={19} /></i><span><b>开启一个新项目</b><small>建立共享 Context，让 Agent 从目标开始协作</small></span><Icon name="chevron" size={15} /></button>}{projects.length === 0 && <div className="management-empty"><i><Icon name={onCreate ? 'sparkles' : 'document'} size={19} /></i><div><b>{emptyTitle}</b><span>{emptyDescription}</span></div>{onCreate && <button className="outline-button" onClick={onCreate}><Icon name="plus" size={14} />创建项目</button>}</div>}</div></section>
}

function HomeProjectRow({ project, onOpen }: { project: Project; onOpen: (id: string, targetView?: ViewKey) => void }) {
  const stages = workflowStages(project)
  const stage = stages.find(item => item.key === project.current_stage)
  const completedSteps = project.current_stage === 'COMPLETED' ? stages.length : Math.max(project.completed_stages || 0, Math.max(stageIndex(project.current_stage, stages), 0))
  const progress = stages.length > 0 ? Math.min(100, Math.round(completedSteps / stages.length * 100)) : (project.current_stage === 'COMPLETED' ? 100 : 0)
  const memberCount = new Set([project.owner_mis || project.owner_name, ...project.members]).size
  const updated = project.updated_at ? new Date(project.updated_at) : null
  const updatedLabel = updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '刚刚'
  return <button className="management-project-row" onClick={() => onOpen(project.id)}><span className="management-project-main"><ProjectGlyph project={project} /><span><b>{project.name}</b><small>{project.goal || project.problem}</small></span>{(project.pending_context_reviews || 0) > 0 && <em>{project.pending_context_reviews} 条待审</em>}</span><span className={`management-stage ${stage ? 'active' : 'completed'}`}><i />{stage?.label || '已完成'}</span><span className="management-progress"><span><i style={{ width: `${progress}%` }} /></span><b>{progress}%</b></span><span className="management-people"><span><Avatar name={project.owner_mis || project.owner_name || '项目'} small />{project.members.slice(0, 2).map(member => <Avatar key={member} name={member} small />)}</span><small>{memberCount} 人</small></span><time>{updatedLabel}</time><Icon name="chevron" size={15} /></button>
}
function CreateModal({ close, submit }: { close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title"><form onSubmit={submit} className="create-project-modal"><header><div><span>NEW PROJECT</span><h2 id="create-project-title">创建项目工作台</h2></div><button type="button" onClick={close} aria-label="关闭创建项目窗口">×</button></header><p className="modal-description">创建后会自动应用以下标准流程；你可在“任务与流程”中按项目实际情况调整阶段、成员与 Agent 编排。</p><section className="default-workflow-guide" aria-label="默认协作流程"><div className="default-workflow-guide__head"><div><b>默认协作流程</b><span>6 个阶段 · 6 个专业 Agent</span></div><em>可创建后调整</em></div><ol>{STAGES.map((stage, index) => <li key={stage.key}><i>{index + 1}</i><AgentBadge agent={stage.agent} color={stage.color} /><div><b>{stage.label}</b><span>{AGENT_NAMES[stage.agent]} · {AGENT_ROLES[stage.agent]}</span></div></li>)}</ol><p><Icon name="link" size={13} />每个阶段的正式产出会写入共享 Context，供后续 Agent 继续使用；跨阶段更新需要人工确认。</p></section><label>项目名称<input name="name" required minLength={2} maxLength={30} placeholder="例如：新用户 7 日留存优化" /></label><label>核心问题<textarea name="problem" required minLength={8} maxLength={500} placeholder="描述当前业务问题、影响和方向（至少 8 个字）" /></label><label>项目目标<input name="goal" required minLength={4} maxLength={300} placeholder="例如：形成可进入需求评审的优化方案" /></label><label>补充背景 <span>选填</span><textarea name="background" maxLength={2000} placeholder="用户反馈、业务背景、已有数据…" /></label><label>项目成员用户名 <span>选填，多个用户名使用逗号分隔</span><input name="members" placeholder="例如：zhangsan, lisi" title="请输入已注册用户名，多个用户名使用逗号分隔" /></label><footer><button type="button" className="outline-button" onClick={close}>取消</button><button className="primary-button">按默认流程创建并进入</button></footer></form></div>
}
function InviteMemberModal({ close, submit }: { close: () => void; submit: (mis: string) => Promise<void> }) {
  const [mis, setMis] = useState(''); const [saving, setSaving] = useState(false)
  return <div className="modal" role="dialog" aria-modal="true"><form className="compact-modal" onSubmit={async event => { event.preventDefault(); setSaving(true); try { await submit(mis.trim().toLowerCase()) } finally { setSaving(false) } }}><header><div><span>PROJECT MEMBER</span><h2>邀请项目成员</h2></div><button type="button" onClick={close}>×</button></header><label>成员用户名<input autoFocus required minLength={2} maxLength={64} pattern="[A-Za-z0-9._-]+" title="请输入已注册用户的用户名" value={mis} onChange={event => setMis(event.target.value)} placeholder="例如：zhangsan" /></label><p className="modal-description">用户名是成员的唯一身份标识。</p><footer><button type="button" className="outline-button" onClick={close}>取消</button><button className="primary-button" disabled={!USERNAME_PATTERN.test(mis.trim()) || saving}>{saving ? '邀请中…' : '确认邀请'}</button></footer></form></div>
}
function QuickHelpModal({ close }: { close: () => void }) {
  return <div className="modal" role="dialog" aria-modal="true"><section className="help-modal"><header><div><span>QUICK START</span><h2>产品使用指南</h2></div><button type="button" onClick={close}>×</button></header><div className="help-steps"><article><i>1</i><div><b>建立共享 Context</b><p>补充问题、目标和背景，邀请成员加入项目。</p></div></article><article><i>2</i><div><b>配置并使用 Agent</b><p>在“Agent 与 Skill”中导入本地 Skill 并挂载；工作台 @Agent 用于对话，正式产出请点击任务页的执行按钮。</p></div></article><article><i>3</i><div><b>审核跨阶段影响</b><p>阶段内容更新后，逐条接受或拒绝对其他阶段的同步建议。</p></div></article></div><footer><button className="primary-button" onClick={close}>知道了</button></footer></section></div>
}
function RejectArtifactModal({ artifact, close, submit }: { artifact: Artifact; close: () => void; submit: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  return <div className="modal" role="dialog" aria-modal="true"><form onSubmit={event => { event.preventDefault(); submit(reason) }}><header><div><span>REQUEST CHANGES</span><h2>要求修改《{artifact.title}》</h2></div><button type="button" onClick={close}>×</button></header><p className="modal-description">修改要求会写入项目动态，方便成员和 Agent 在下一次执行时共同理解本次决策。</p><label>修改要求<textarea autoFocus required value={reason} onChange={event => setReason(event.target.value)} placeholder="请说明需要修改的内容、原因或补充材料…" /></label><footer><button type="button" className="outline-button" onClick={close}>取消</button><button className="primary-button" disabled={!reason.trim()}>记录并驳回</button></footer></form></div>
}
function ProjectActionModal({ action, project, close, submit }: { action: { kind: 'skip' | 'finish'; stage?: StageKey }; project: Project; close: () => void; submit: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const isSkip = action.kind === 'skip'; const stage = action.stage ? stageOf(action.stage) : undefined
  return <div className="modal" role="dialog" aria-modal="true"><form className="confirm-modal" onSubmit={event => { event.preventDefault(); submit(reason) }}><header><div><span>SECOND CONFIRMATION</span><h2>{isSkip ? `确认跳过「${stage?.label}」？` : `确认结束「${project.name}」？`}</h2></div><button type="button" onClick={close}>×</button></header><div className="confirm-warning"><Icon name="help" size={20} /><p><b>{isSkip ? '该阶段不会生成正式产出' : '未完成阶段将保留为未执行'}</b><span>这次操作会被记录在项目动态和事件日志中，不会静默推进流程。</span></p></div><label>决策原因 <span>必填</span><textarea autoFocus required value={reason} onChange={event => setReason(event.target.value)} placeholder={isSkip ? '为什么当前项目不需要这个阶段？' : '为什么现在可以结束项目？'} /></label><footer><button type="button" className="outline-button" onClick={close}>返回</button><button className="danger-button" disabled={!reason.trim()}>{isSkip ? '确认跳过并进入下一阶段' : '确认结束项目'}</button></footer></form></div>
}
function Toast({ text }: { text: string }) { return text ? <div className="toast">{text}</div> : null }

const appRoot = window.__aiTeamRoot || createRoot(document.getElementById('root')!)
window.__aiTeamRoot = appRoot
appRoot.render(<App />)
