import React, { useEffect, useState } from 'react'
import { Copy, Check, RefreshCw, SendHorizonal, AlertCircle } from 'lucide-react'
import type { LiteLlmChatMessage, Template } from '../../../shared/types'

interface Props {
  templateId: string
}

export default function LiteLlmChatWindow({ templateId }: Props) {
  const [template, setTemplate] = useState<Template | null>(null)
  const [messages, setMessages] = useState<LiteLlmChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    async function loadTemplate() {
      setLoading(true)
      try {
        const loadedTemplate = await window.api.getTemplate(templateId)
        if (!loadedTemplate) {
          throw new Error('Template not found.')
        }

        if ((loadedTemplate.providerType || 'local') !== 'litellm') {
          throw new Error('Template is not configured for LiteLLM.')
        }

        setTemplate(loadedTemplate)
      } catch (loadError) {
        setError(String(loadError))
      } finally {
        setLoading(false)
      }
    }

    void loadTemplate()
  }, [templateId])

  async function handleSend() {
    const trimmedInput = input.trim()
    if (!trimmedInput || sending) return

    const nextMessages: LiteLlmChatMessage[] = [...messages, { role: 'user', content: trimmedInput }]
    setMessages(nextMessages)
    setInput('')
    setSending(true)
    setError('')

    const result = await window.api.liteLlmChatCompletion({ templateId, messages: nextMessages })
    if (!result.success) {
      setError(result.error || 'LiteLLM chat request failed.')
      setSending(false)
      return
    }

    setMessages([...nextMessages, result.message])
    setSending(false)
  }

  async function handleCopyModel() {
    if (!template?.remoteModel) return
    await navigator.clipboard.writeText(template.remoteModel)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text-muted)' }}>
        <RefreshCw size={24} className="spin" />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ height: 56, WebkitAppRegion: 'drag', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'var(--card-bg)', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>{template?.name || 'LiteLLM Chat'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{template?.remoteModel || 'No remote model selected'}</div>
        </div>
        <div style={{ WebkitAppRegion: 'no-drag', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 13 }} onClick={handleCopyModel} disabled={!template?.remoteModel}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy Model'}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, background: 'rgba(220, 38, 38, 0.08)', color: 'var(--danger)' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 ? (
            <div style={{ margin: 'auto 0', color: 'var(--text-muted)', textAlign: 'center' }}>
              Start chatting with the configured LiteLLM proxy.
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                style={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: message.role === 'user' ? 'var(--accent)' : 'var(--card-bg)',
                  color: message.role === 'user' ? 'white' : 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                  border: message.role === 'user' ? 'none' : '1px solid var(--border)'
                }}
              >
                {message.content}
              </div>
            ))
          )}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <textarea
            className="form-textarea"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Send a message to the LiteLLM proxy..."
            rows={3}
            style={{ margin: 0, resize: 'none' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSend()
              }
            }}
          />
          <button className="btn btn-primary" onClick={() => void handleSend()} disabled={sending || !input.trim()}>
            {sending ? <RefreshCw size={16} className="spin" /> : <SendHorizonal size={16} />}
            Send
          </button>
        </div>
      </div>
    </div>
  )
}