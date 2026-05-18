import React, { useEffect, useRef, useState } from 'react'
import { Activity, BarChart3, RefreshCw } from 'lucide-react'
import { useStore } from '../store/useStore'
import type {
  UsageLiveSession,
  UsageRequestRecord,
  UsageSessionRollup,
  UsageSessionStatus,
  UsageStatsQuery,
  UsageStatsSnapshot,
  UsageStatsWindow,
  UsageSummaryRollup
} from '../../../shared/types'

const WINDOW_OPTIONS: Array<{ label: string; value: UsageStatsWindow }> = [
  { label: 'Today', value: 'today' },
  { label: 'Last 7 days', value: '7d' },
  { label: 'All time', value: 'all' }
]

const DEFAULT_QUERY: UsageStatsQuery = {
  window: '7d',
  templateId: null,
  limit: 100
}

type UsageStatsTab = 'overview' | 'sessions'
type UsageSessionGroupBy = 'none' | 'template' | 'status'
type UsageSessionSortBy = 'activity' | 'tokens' | 'requests' | 'duration'
type UsageSessionStatusFilter = 'all' | UsageSessionStatus

const STATS_TAB_OPTIONS: Array<{ label: string; value: UsageStatsTab }> = [
  { label: 'Overview', value: 'overview' },
  { label: 'Sessions', value: 'sessions' }
]

const SESSION_STATUS_OPTIONS: Array<{ label: string; value: UsageSessionStatusFilter }> = [
  { label: 'All statuses', value: 'all' },
  { label: 'Running', value: 'running' },
  { label: 'Stopped', value: 'stopped' },
  { label: 'Error', value: 'error' }
]

const SESSION_GROUP_OPTIONS: Array<{ label: string; value: UsageSessionGroupBy }> = [
  { label: 'No grouping', value: 'none' },
  { label: 'Group by template', value: 'template' },
  { label: 'Group by status', value: 'status' }
]

const SESSION_SORT_OPTIONS: Array<{ label: string; value: UsageSessionSortBy }> = [
  { label: 'Latest activity', value: 'activity' },
  { label: 'Most tokens', value: 'tokens' },
  { label: 'Most requests', value: 'requests' },
  { label: 'Longest duration', value: 'duration' }
]

interface SessionAnalysisGroup extends UsageSummaryRollup {
  key: string
  label: string
  subtitle: string
  sessionCount: number
  lastActivityAt?: string
  durationMs: number
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }

  return `${(durationMs / 1000).toFixed(2)} s`
}

function formatRate(tokensPerSecond?: number): string | null {
  if (typeof tokensPerSecond !== 'number' || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return null
  }

  return `${tokensPerSecond.toFixed(1)} tok/s`
}

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) return 'Never'

  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toLocaleString([], { hour12: false })
}

function getUncachedInputTokens(record: Pick<UsageRequestRecord, 'promptTokens' | 'cacheTokens'>): number {
  return Math.max(record.promptTokens - record.cacheTokens, 0)
}

function renderTokenSummary(record: Pick<UsageRequestRecord, 'countedExactly' | 'promptTokens' | 'cacheTokens' | 'completionTokens' | 'totalTokens'>): string {
  if (!record.countedExactly) {
    return 'Not exact'
  }

  const uncachedInputTokens = getUncachedInputTokens(record)

  return `${formatNumber(uncachedInputTokens)} / ${formatNumber(record.cacheTokens)} / ${formatNumber(record.completionTokens)} / ${formatNumber(record.totalTokens)}`
}

function renderTimingLine(label: string, durationMs?: number, tokensPerSecond?: number): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null
  }

  const rate = formatRate(tokensPerSecond)
  return `${label} ${formatDuration(durationMs)}${rate ? ` • ${rate}` : ''}`
}

function renderLiveSessionTitle(session: UsageLiveSession): string {
  return `${session.templateName} • ${session.publicPort} -> ${session.upstreamPort}`
}

function zeroSummary(): UsageSummaryRollup {
  return {
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    exactUsageCount: 0,
    promptTokens: 0,
    cacheTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }
}

function mergeSummary(target: UsageSummaryRollup, source: UsageSummaryRollup): void {
  target.requestCount += source.requestCount
  target.successCount += source.successCount
  target.errorCount += source.errorCount
  target.exactUsageCount += source.exactUsageCount
  target.promptTokens += source.promptTokens
  target.cacheTokens += source.cacheTokens
  target.completionTokens += source.completionTokens
  target.totalTokens += source.totalTokens
}

function getTimestampValue(timestamp?: string): number {
  if (!timestamp) return 0
  const value = new Date(timestamp).getTime()
  return Number.isFinite(value) ? value : 0
}

function getSessionActivityTimestamp(session: UsageSessionRollup): string {
  return session.windowLastRequestAt ?? session.lastRequestAt ?? session.windowEndedAt ?? session.stoppedAt ?? session.windowStartedAt ?? session.startedAt
}

function getSessionDurationMs(session: UsageSessionRollup): number {
  const startedAt = getTimestampValue(session.windowStartedAt ?? session.startedAt)
  const endedAt = getTimestampValue(session.windowEndedAt ?? session.windowLastRequestAt ?? session.stoppedAt ?? session.lastRequestAt ?? session.windowStartedAt ?? session.startedAt)

  if (!startedAt || !endedAt || endedAt <= startedAt) {
    return 0
  }

  return endedAt - startedAt
}

function formatSessionStatus(status: UsageSessionStatus): string {
  if (status === 'running') return 'Running'
  if (status === 'error') return 'Error'
  return 'Stopped'
}

function getSessionGroupSubtitle(session: UsageSessionRollup): string {
  if (session.modelPath) {
    return session.modelPath.split(/[/\\]/).pop() || session.modelPath
  }

  if (session.backendVersion) {
    return session.backendVersion
  }

  return session.launchId
}

function buildSessionAnalysisGroups(sessions: UsageSessionRollup[], groupBy: UsageSessionGroupBy): SessionAnalysisGroup[] {
  return buildSortedSessionAnalysisGroups(sessions, groupBy, 'tokens')
}

function buildSortedSessionAnalysisGroups(
  sessions: UsageSessionRollup[],
  groupBy: UsageSessionGroupBy,
  sortBy: UsageSessionSortBy
): SessionAnalysisGroup[] {
  const groups = new Map<string, SessionAnalysisGroup>()

  for (const session of sessions) {
    const key = groupBy === 'status' ? session.status : session.templateId
    const label = groupBy === 'status' ? formatSessionStatus(session.status) : session.templateName
    const subtitle = groupBy === 'status'
      ? 'Grouped by final session state'
      : getSessionGroupSubtitle(session)

    const group = groups.get(key) ?? {
      key,
      label,
      subtitle,
      sessionCount: 0,
      lastActivityAt: getSessionActivityTimestamp(session),
      durationMs: 0,
      ...zeroSummary()
    }

    group.sessionCount += 1
    group.durationMs += getSessionDurationMs(session)
    mergeSummary(group, session)
    const sessionActivityAt = getSessionActivityTimestamp(session)
    if (!group.lastActivityAt || getTimestampValue(group.lastActivityAt) < getTimestampValue(sessionActivityAt)) {
      group.lastActivityAt = sessionActivityAt
    }
    groups.set(key, group)
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (sortBy === 'activity') {
      return getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || left.label.localeCompare(right.label)
    }

    if (sortBy === 'requests') {
      return right.requestCount - left.requestCount
        || right.totalTokens - left.totalTokens
        || getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
        || left.label.localeCompare(right.label)
    }

    if (sortBy === 'duration') {
      return right.durationMs - left.durationMs
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || left.label.localeCompare(right.label)
    }

    return right.totalTokens - left.totalTokens
      || right.requestCount - left.requestCount
      || getTimestampValue(right.lastActivityAt) - getTimestampValue(left.lastActivityAt)
      || left.label.localeCompare(right.label)
  })
}

function sortSessionRollups(sessions: UsageSessionRollup[], sortBy: UsageSessionSortBy): UsageSessionRollup[] {
  return [...sessions].sort((left, right) => {
    if (sortBy === 'tokens') {
      return right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
        || getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
    }

    if (sortBy === 'requests') {
      return right.requestCount - left.requestCount
        || right.totalTokens - left.totalTokens
        || getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
    }

    if (sortBy === 'duration') {
      return getSessionDurationMs(right) - getSessionDurationMs(left)
        || right.totalTokens - left.totalTokens
        || right.requestCount - left.requestCount
    }

    return getTimestampValue(getSessionActivityTimestamp(right)) - getTimestampValue(getSessionActivityTimestamp(left))
      || right.totalTokens - left.totalTokens
      || right.requestCount - left.requestCount
  })
}

export default function UsageStatsView() {
  const cards = useStore((state) => state.cards)
  const [query, setQuery] = useState<UsageStatsQuery>(DEFAULT_QUERY)
  const [activeTab, setActiveTab] = useState<UsageStatsTab>('overview')
  const [sessionStatusFilter, setSessionStatusFilter] = useState<UsageSessionStatusFilter>('all')
  const [sessionGroupBy, setSessionGroupBy] = useState<UsageSessionGroupBy>('none')
  const [sessionSortBy, setSessionSortBy] = useState<UsageSessionSortBy>('activity')
  const [snapshot, setSnapshot] = useState<UsageStatsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryRef = useRef(query)

  queryRef.current = query

  const templateOptions = [...cards]
    .reduce((accumulator, card) => {
      accumulator.set(card.template.id, card.template.name)
      return accumulator
    }, new Map<string, string>())

  snapshot?.templateRollups.forEach((rollup) => {
    templateOptions.set(rollup.templateId, rollup.templateName)
  })

  snapshot?.recentRequests.forEach((record) => {
    templateOptions.set(record.templateId, record.templateNameSnapshot)
  })

  const orderedTemplateOptions = Array.from(templateOptions.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name))

  const filteredSessionRollups = sortSessionRollups(
    (snapshot?.sessionRollups ?? []).filter((session) => {
      return sessionStatusFilter === 'all' || session.status === sessionStatusFilter
    }),
    sessionSortBy
  )
  const sessionAnalysisGroups = buildSortedSessionAnalysisGroups(filteredSessionRollups, sessionGroupBy, sessionSortBy)

  async function loadSnapshot(nextQuery: UsageStatsQuery, mode: 'initial' | 'refresh' = 'refresh') {
    if (mode === 'initial') {
      setLoading(true)
    } else {
      setRefreshing(true)
    }

    try {
      const nextSnapshot = await window.api.getUsageStats(nextQuery)
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadSnapshot(query, 'initial')
  }, [query.window, query.templateId])

  useEffect(() => {
    const unsubscribe = window.api.onUsageUpdated(() => {
      void loadSnapshot(queryRef.current)
    })

    return unsubscribe
  }, [])

  return (
    <div className="usage-stats-page">
      <div className="page-header usage-stats-header">
        <div>
          <h1 className="page-title">Usage Stats</h1>
          <p className="page-subtitle">Live and historical API usage for proxied llama.cpp sessions. History is stored as compact per-session summaries, while Recent Requests keeps only the last 20 tracked requests in memory for the current app run. Exact token totals only appear when llama.cpp returns usage or timings.</p>
        </div>
        <div className="page-actions usage-stats-actions">
          <div className="usage-stats-filter-group">
            {WINDOW_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`usage-window-chip ${query.window === option.value ? 'active' : ''}`}
                onClick={() => setQuery((current) => ({ ...current, window: option.value }))}
              >
                {option.label}
              </button>
            ))}
          </div>
          <select
            className="form-select usage-template-select"
            value={query.templateId ?? ''}
            onChange={(event) => {
              const value = event.target.value.trim()
              setQuery((current) => ({ ...current, templateId: value || null }))
            }}
          >
            <option value="">All templates</option>
            {orderedTemplateOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => void loadSnapshot(queryRef.current)} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="usage-stats-tab-row">
        {STATS_TAB_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`usage-tab-chip ${activeTab === option.value ? 'active' : ''}`}
            onClick={() => setActiveTab(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading && !snapshot ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <BarChart3 size={28} />
          </div>
          <h3>Loading usage history</h3>
          <p>Reading local usage sessions and active proxy sessions.</p>
        </div>
      ) : error && !snapshot ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Activity size={28} />
          </div>
          <h3>Could not load usage stats</h3>
          <p>{error}</p>
        </div>
      ) : snapshot ? (
        <>
          {error && <div className="usage-stats-warning">Refresh failed: {error}</div>}

          <div className="usage-summary-grid">
            <div className="usage-summary-card">
              <span className="usage-summary-label">Requests</span>
              <strong>{formatNumber(snapshot.summary.requestCount)}</strong>
              <span className="usage-summary-meta">{formatNumber(snapshot.summary.successCount)} ok • {formatNumber(snapshot.summary.errorCount)} failed</span>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">Exact Usage Rows</span>
              <strong>{formatNumber(snapshot.summary.exactUsageCount)}</strong>
              <span className="usage-summary-meta">Only rows with upstream usage or timings</span>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">Exact Tokens</span>
              <strong>{formatNumber(snapshot.summary.totalTokens)}</strong>
              <span className="usage-summary-meta">{formatNumber(getUncachedInputTokens(snapshot.summary))} input • {formatNumber(snapshot.summary.cacheTokens)} cache • {formatNumber(snapshot.summary.completionTokens)} output</span>
            </div>
            <div className="usage-summary-card">
              <span className="usage-summary-label">Live Sessions</span>
              <strong>{formatNumber(snapshot.liveSessions.length)}</strong>
              <span className="usage-summary-meta">{formatNumber(snapshot.liveSessions.reduce((total, session) => total + session.activeRequests, 0))} active API calls</span>
            </div>
          </div>

          {activeTab === 'overview' ? (
            <>
              <section className="usage-section">
                <div className="usage-section-header">
                  <h2>Live Sessions</h2>
                  <span>{snapshot.liveSessions.length === 0 ? 'No running proxies' : `${snapshot.liveSessions.length} active`}</span>
                </div>
                {snapshot.liveSessions.length === 0 ? (
                  <div className="usage-section-empty">Start an API-capable template and this section will update in real time.</div>
                ) : (
                  <div className="usage-live-grid">
                    {snapshot.liveSessions.map((session) => (
                      <div className="usage-live-card" key={session.launchId}>
                        <div className="usage-live-title">{renderLiveSessionTitle(session)}</div>
                        <div className="usage-live-subtitle">{session.modelPath?.split(/[/\\]/).pop() || 'Model path unavailable'}</div>
                        <div className="usage-live-metrics">
                          <span><strong>{formatNumber(session.requestCount)}</strong> requests</span>
                          <span><strong>{formatNumber(session.activeRequests)}</strong> active</span>
                          <span><strong>{formatNumber(getUncachedInputTokens(session))}</strong> input</span>
                          <span><strong>{formatNumber(session.cacheTokens)}</strong> cache</span>
                          <span><strong>{formatNumber(session.completionTokens)}</strong> output</span>
                          <span><strong>{formatNumber(session.totalTokens)}</strong> total</span>
                        </div>
                        <div className="usage-live-footer">
                          <span>Started {formatTimestamp(session.startedAt)}</span>
                          <span>{session.lastRequestAt ? `Last request ${formatTimestamp(session.lastRequestAt)}` : 'No tracked API request yet'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="usage-rollups-grid">
                <section className="usage-section">
                  <div className="usage-section-header">
                    <h2>Templates</h2>
                    <span>{snapshot.templateRollups.length} template rows</span>
                  </div>
                  {snapshot.templateRollups.length === 0 ? (
                    <div className="usage-section-empty">No matching historical usage for the selected filter.</div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.templateRollups.map((rollup) => (
                        <div className="usage-list-row" key={rollup.templateId}>
                          <div>
                            <div className="usage-list-title">{rollup.templateName}</div>
                            <div className="usage-list-subtitle">{rollup.modelPath?.split(/[/\\]/).pop() || 'No model path snapshot'}</div>
                          </div>
                          <div className="usage-list-metrics">
                            <span>{formatNumber(rollup.requestCount)} requests</span>
                            <span>{formatNumber(getUncachedInputTokens(rollup))} input • {formatNumber(rollup.cacheTokens)} cache • {formatNumber(rollup.completionTokens)} output</span>
                            <span>{formatNumber(rollup.totalTokens)} total</span>
                            <span>{rollup.lastRequestAt ? formatTimestamp(rollup.lastRequestAt) : 'No recent activity'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="usage-section">
                  <div className="usage-section-header">
                    <h2>By Day</h2>
                    <span>{snapshot.dailyRollups.length} day rows</span>
                  </div>
                  {snapshot.dailyRollups.length === 0 ? (
                    <div className="usage-section-empty">No persisted requests in this time window yet.</div>
                  ) : (
                    <div className="usage-list-table">
                      {snapshot.dailyRollups.map((rollup) => (
                        <div className="usage-list-row" key={rollup.day}>
                          <div>
                            <div className="usage-list-title">{rollup.day}</div>
                            <div className="usage-list-subtitle">{formatNumber(rollup.exactUsageCount)} exact rows</div>
                          </div>
                          <div className="usage-list-metrics">
                            <span>{formatNumber(rollup.requestCount)} requests</span>
                            <span>{formatNumber(getUncachedInputTokens(rollup))} input • {formatNumber(rollup.cacheTokens)} cache • {formatNumber(rollup.completionTokens)} output</span>
                            <span>{formatNumber(rollup.totalTokens)} total</span>
                            <span>{formatNumber(rollup.errorCount)} failed</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <section className="usage-section">
                <div className="usage-section-header">
                  <h2>Recent Requests</h2>
                  <span>{snapshot.recentRequests.length} rows shown</span>
                </div>
                {snapshot.recentRequests.length === 0 ? (
                  <div className="usage-section-empty">No tracked requests are buffered in this app run yet. This section is in-memory only and is capped to the last 20 requests.</div>
                ) : (
                  <div className="usage-request-table-wrapper">
                    <table className="usage-request-table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Template</th>
                          <th>Endpoint</th>
                          <th>Status</th>
                          <th>Duration</th>
                          <th>Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recentRequests.map((record) => (
                          <tr key={record.id}>
                            <td>
                              <div className="usage-request-primary">{formatTimestamp(record.finishedAt)}</div>
                              <div className="usage-request-secondary">{record.stream ? 'stream' : 'json'}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{record.templateNameSnapshot}</div>
                              <div className="usage-request-secondary">{record.modelPathSnapshot?.split(/[/\\]/).pop() || 'No model snapshot'}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{record.path}</div>
                              <div className="usage-request-secondary">{record.method}</div>
                            </td>
                            <td>
                              <div className={`usage-status-pill ${(record.statusCode ?? 500) < 400 ? 'ok' : 'error'}`}>{record.statusCode ?? 'ERR'}</div>
                              <div className="usage-request-secondary">{record.error || (record.countedExactly ? 'exact usage' : 'non-exact row')}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatDuration(record.durationMs)}</div>
                              {renderTimingLine('pp', record.timings?.promptMs, record.timings?.promptPerSecond) && (
                                <div className="usage-request-secondary usage-request-metric-line">{renderTimingLine('pp', record.timings?.promptMs, record.timings?.promptPerSecond)}</div>
                              )}
                              {renderTimingLine('tg', record.timings?.predictedMs, record.timings?.predictedPerSecond) && (
                                <div className="usage-request-secondary usage-request-metric-line">{renderTimingLine('tg', record.timings?.predictedMs, record.timings?.predictedPerSecond)}</div>
                              )}
                            </td>
                            <td>
                              <div className="usage-request-primary">{renderTokenSummary(record)}</div>
                              <div className="usage-request-secondary">input / cache / output / total</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <section className="usage-section">
                <div className="usage-section-header usage-section-header-stack">
                  <div>
                    <h2>Session Analysis</h2>
                    <span className="usage-section-header-note">Analyze persisted sessions for the selected window and template.</span>
                  </div>
                  <span>{filteredSessionRollups.length} sessions match</span>
                </div>
                <div className="usage-session-controls">
                  <label className="usage-control-field">
                    <span>Status</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={sessionStatusFilter}
                      onChange={(event) => setSessionStatusFilter(event.target.value as UsageSessionStatusFilter)}
                    >
                      {SESSION_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="usage-control-field">
                    <span>Group</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={sessionGroupBy}
                      onChange={(event) => setSessionGroupBy(event.target.value as UsageSessionGroupBy)}
                    >
                      {SESSION_GROUP_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="usage-control-field">
                    <span>Sort</span>
                    <select
                      className="form-select usage-analysis-select"
                      value={sessionSortBy}
                      onChange={(event) => setSessionSortBy(event.target.value as UsageSessionSortBy)}
                    >
                      {SESSION_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {filteredSessionRollups.length === 0 ? (
                  <div className="usage-section-empty">No persisted sessions match the current filters yet.</div>
                ) : sessionGroupBy === 'none' ? (
                  <div className="usage-request-table-wrapper">
                    <table className="usage-request-table usage-session-table">
                      <thead>
                        <tr>
                          <th>Session</th>
                          <th>Status</th>
                          <th>Requests</th>
                          <th>Tokens</th>
                          <th>Duration</th>
                          <th>Activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSessionRollups.map((session) => (
                          <tr key={session.launchId}>
                            <td>
                              <div className="usage-request-primary">{session.templateName}</div>
                              <div className="usage-request-secondary">{getSessionGroupSubtitle(session)}</div>
                            </td>
                            <td>
                              <div className={`usage-status-pill usage-session-status ${session.status === 'running' ? 'ok' : session.status === 'error' ? 'error' : ''}`}>{formatSessionStatus(session.status)}</div>
                              <div className="usage-request-secondary">{session.lastEndpoint || 'No endpoint snapshot'}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatNumber(session.requestCount)}</div>
                              <div className="usage-request-secondary">{formatNumber(session.successCount)} ok • {formatNumber(session.errorCount)} failed</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatNumber(session.totalTokens)}</div>
                              <div className="usage-request-secondary">{formatNumber(getUncachedInputTokens(session))} input • {formatNumber(session.cacheTokens)} cache • {formatNumber(session.completionTokens)} output</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatDuration(getSessionDurationMs(session))}</div>
                              <div className="usage-request-secondary">Window start {formatTimestamp(session.windowStartedAt ?? session.startedAt)}</div>
                            </td>
                            <td>
                              <div className="usage-request-primary">{formatTimestamp(getSessionActivityTimestamp(session))}</div>
                              <div className="usage-request-secondary">{session.windowEndedAt ? `Window end ${formatTimestamp(session.windowEndedAt)}` : 'Still running or open'}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="usage-list-table">
                    {sessionAnalysisGroups.map((group) => (
                      <div className="usage-list-row" key={group.key}>
                        <div>
                          <div className="usage-list-title">{group.label}</div>
                          <div className="usage-list-subtitle">{group.subtitle}</div>
                        </div>
                        <div className="usage-list-metrics">
                          <span>{formatNumber(group.sessionCount)} sessions</span>
                          <span>{formatNumber(group.requestCount)} requests</span>
                          <span>{formatNumber(getUncachedInputTokens(group))} input • {formatNumber(group.cacheTokens)} cache • {formatNumber(group.completionTokens)} output</span>
                          <span>{formatNumber(group.totalTokens)} total</span>
                          <span>{group.lastActivityAt ? `Last activity ${formatTimestamp(group.lastActivityAt)}` : 'No recent activity'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}