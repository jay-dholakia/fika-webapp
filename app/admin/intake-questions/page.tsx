'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

type IntakeQuestion = {
  id: string
  question_id: string
  label: string
  body: string | null
  type: string
  options: string[] | null
  required: boolean
  enabled: boolean
  display_order: number
  max_selections: number | null
  placeholder: string | null
}

const QUESTION_TYPES = ['text', 'select', 'chips_single', 'multi_select', 'slider_snap']

async function getAuthHeaders(): Promise<HeadersInit> {
  const supabase = getSupabase()
  const { data: { session } } = await supabase?.auth.getSession() ?? { data: { session: null } }
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return headers
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  select: 'Select',
  chips_single: 'Single chip',
  multi_select: 'Multi-select',
  slider_snap: 'Slider',
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 7px',
      borderRadius: 4,
      background: '#e8f0fb',
      color: '#3a6db5',
      letterSpacing: 0.2,
      textTransform: 'uppercase',
    }}>
      {TYPE_LABELS[type] ?? type}
    </span>
  )
}

function EditForm({
  q,
  onSave,
  onCancel,
}: {
  q: IntakeQuestion
  onSave: (updated: IntakeQuestion) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(q.label)
  const [body, setBody] = useState(q.body ?? '')
  const [type, setType] = useState(q.type)
  const [optionsText, setOptionsText] = useState((q.options ?? []).join('\n'))
  const [required, setRequired] = useState(q.required)
  const [enabled, setEnabled] = useState(q.enabled)
  const [maxSelections, setMaxSelections] = useState(q.max_selections?.toString() ?? '')
  const [placeholder, setPlaceholder] = useState(q.placeholder ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const options = optionsText.trim() ? optionsText.split('\n').map(s => s.trim()).filter(Boolean) : null
    const body_val = { label, body: body || null, type, options, required, enabled, max_selections: maxSelections ? parseInt(maxSelections) : null, placeholder: placeholder || null }
    try {
      const res = await fetch(`/api/admin/intake-questions/${q.id}`, {
        method: 'PATCH',
        headers: await getAuthHeaders(),
        body: JSON.stringify(body_val),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Save failed'); setSaving(false); return }
      onSave(json.question)
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div style={{ background: '#f8faff', border: '1px solid #d0dff5', borderRadius: 8, padding: '16px 18px', marginTop: 6 }}>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Question text</span>
          <input value={label} onChange={e => setLabel(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Subtitle / instruction</span>
          <input value={body} onChange={e => setBody(e.target.value)} placeholder="Optional" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Type</span>
          <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
            {QUESTION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
          </select>
        </label>
        {type !== 'text' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Options <span style={{ fontWeight: 400, color: '#888' }}>(one per line)</span></span>
            <textarea value={optionsText} onChange={e => setOptionsText(e.target.value)} rows={6} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
          </label>
        )}
        {type === 'text' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Placeholder</span>
            <input value={placeholder} onChange={e => setPlaceholder(e.target.value)} style={inputStyle} />
          </label>
        )}
        {type === 'multi_select' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Max selections</span>
            <input type="number" value={maxSelections} onChange={e => setMaxSelections(e.target.value)} placeholder="No limit" style={{ ...inputStyle, width: 120 }} />
          </label>
        )}
        <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
            Required
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>
        {error && <p style={{ color: '#c0392b', fontSize: 13, margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={saving} className="admin-btn admin-btn-primary" style={{ fontSize: 13 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel} className="admin-btn" style={{ fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function AddForm({ maxOrder, onAdd, onCancel }: { maxOrder: number; onAdd: (q: IntakeQuestion) => void; onCancel: () => void }) {
  const [questionId, setQuestionId] = useState('')
  const [label, setLabel] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState('text')
  const [optionsText, setOptionsText] = useState('')
  const [required, setRequired] = useState(false)
  const [maxSelections, setMaxSelections] = useState('')
  const [placeholder, setPlaceholder] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    setSaving(true)
    setError(null)
    const options = optionsText.trim() ? optionsText.split('\n').map(s => s.trim()).filter(Boolean) : null
    try {
      const res = await fetch('/api/admin/intake-questions', {
        method: 'POST',
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          question_id: questionId.trim(),
          label: label.trim(),
          body: body.trim() || null,
          type,
          options,
          required,
          enabled: true,
          display_order: maxOrder + 1,
          max_selections: maxSelections ? parseInt(maxSelections) : null,
          placeholder: placeholder.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Create failed'); setSaving(false); return }
      onAdd(json.question)
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  return (
    <div style={{ background: '#f0f7ee', border: '1px solid #b8d8b4', borderRadius: 8, padding: '16px 18px', marginTop: 16 }}>
      <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 14 }}>New question</p>
      <div style={{ display: 'grid', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Question ID <span style={{ fontWeight: 400, color: '#888' }}>(snake_case, unique)</span></span>
          <input value={questionId} onChange={e => setQuestionId(e.target.value)} placeholder="e.g. q_hobbies" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Question text</span>
          <input value={label} onChange={e => setLabel(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Subtitle / instruction</span>
          <input value={body} onChange={e => setBody(e.target.value)} placeholder="Optional" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>Type</span>
          <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
            {QUESTION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
          </select>
        </label>
        {type !== 'text' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Options <span style={{ fontWeight: 400, color: '#888' }}>(one per line)</span></span>
            <textarea value={optionsText} onChange={e => setOptionsText(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }} />
          </label>
        )}
        {type === 'text' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Placeholder</span>
            <input value={placeholder} onChange={e => setPlaceholder(e.target.value)} style={inputStyle} />
          </label>
        )}
        {type === 'multi_select' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Max selections</span>
            <input type="number" value={maxSelections} onChange={e => setMaxSelections(e.target.value)} placeholder="No limit" style={{ ...inputStyle, width: 120 }} />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} />
          Required
        </label>
        {error && <p style={{ color: '#c0392b', fontSize: 13, margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleAdd} disabled={saving} className="admin-btn admin-btn-primary" style={{ fontSize: 13 }}>
            {saving ? 'Adding…' : 'Add question'}
          </button>
          <button onClick={onCancel} className="admin-btn" style={{ fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #ccd6e8',
  borderRadius: 6,
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  background: '#fff',
}

export default function AdminIntakeQuestionsPage() {
  const [questions, setQuestions] = useState<IntakeQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/intake-questions', { headers: await getAuthHeaders() })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to load'); return }
      setQuestions(json.questions ?? [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function move(q: IntakeQuestion, dir: -1 | 1) {
    const idx = questions.findIndex(x => x.id === q.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= questions.length) return
    const swap = questions[swapIdx]
    const newOrder = questions.map((x, i) => {
      if (i === idx) return { ...x, display_order: swap.display_order }
      if (i === swapIdx) return { ...x, display_order: q.display_order }
      return x
    }).sort((a, b) => a.display_order - b.display_order)
    setQuestions(newOrder)
    await Promise.all([
      fetch(`/api/admin/intake-questions/${q.id}`, { method: 'PATCH', headers: await getAuthHeaders(), body: JSON.stringify({ display_order: swap.display_order }) }),
      fetch(`/api/admin/intake-questions/${swap.id}`, { method: 'PATCH', headers: await getAuthHeaders(), body: JSON.stringify({ display_order: q.display_order }) }),
    ])
  }

  async function toggleEnabled(q: IntakeQuestion) {
    const updated = { ...q, enabled: !q.enabled }
    setQuestions(qs => qs.map(x => x.id === q.id ? updated : x))
    await fetch(`/api/admin/intake-questions/${q.id}`, { method: 'PATCH', headers: await getAuthHeaders(), body: JSON.stringify({ enabled: updated.enabled }) })
  }

  async function deleteQuestion(q: IntakeQuestion) {
    if (!confirm(`Delete "${q.label}"? This cannot be undone.`)) return
    setDeletingId(q.id)
    await fetch(`/api/admin/intake-questions/${q.id}`, { method: 'DELETE', headers: await getAuthHeaders() })
    setQuestions(qs => qs.filter(x => x.id !== q.id))
    setDeletingId(null)
  }

  const maxOrder = questions.length ? Math.max(...questions.map(q => q.display_order)) : 0

  return (
    <main style={{ maxWidth: 800, margin: '32px auto', padding: '0 16px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Intake questions</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>
            Questions shown during onboarding. Profile steps (name, birthdate, location) are fixed.
          </p>
        </div>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)} className="admin-btn admin-btn-primary" style={{ fontSize: 13 }}>
            + Add question
          </button>
        )}
      </div>

      {loading && <p style={{ color: '#888', fontSize: 14 }}>Loading…</p>}
      {error && <p style={{ color: '#c0392b', fontSize: 14 }}>{error}</p>}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {questions.map((q, idx) => (
            <div key={q.id} style={{
              border: '1px solid #dce6f5',
              borderRadius: 10,
              background: q.enabled ? '#fff' : '#f7f7f7',
              opacity: q.enabled ? 1 : 0.7,
            }}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                  {/* Reorder buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                    <button onClick={() => move(q, -1)} disabled={idx === 0} style={arrowBtn} title="Move up">▲</button>
                    <button onClick={() => move(q, 1)} disabled={idx === questions.length - 1} style={arrowBtn} title="Move down">▼</button>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <TypeBadge type={q.type} />
                      <span style={{ fontSize: 11, color: '#999', fontFamily: 'monospace' }}>{q.question_id}</span>
                      {q.required && <span style={{ fontSize: 11, color: '#e07b39', fontWeight: 600 }}>required</span>}
                      {!q.enabled && <span style={{ fontSize: 11, color: '#999' }}>hidden</span>}
                    </div>
                    <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: 15 }}>{q.label}</p>
                    {q.body && <p style={{ margin: 0, color: '#666', fontSize: 13 }}>{q.body}</p>}
                    {q.options && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
                        {q.options.length} options
                        {q.max_selections ? ` · max ${q.max_selections}` : ''}
                      </p>
                    )}
                    {q.placeholder && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>Placeholder: {q.placeholder}</p>}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => toggleEnabled(q)} className="admin-btn" style={{ fontSize: 12, padding: '4px 10px' }}>
                      {q.enabled ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => setEditingId(editingId === q.id ? null : q.id)} className="admin-btn" style={{ fontSize: 12, padding: '4px 10px' }}>
                      {editingId === q.id ? 'Close' : 'Edit'}
                    </button>
                    <button
                      onClick={() => deleteQuestion(q)}
                      disabled={deletingId === q.id}
                      className="admin-btn"
                      style={{ fontSize: 12, padding: '4px 10px', color: '#c0392b', borderColor: '#e8b4b4' }}
                    >
                      {deletingId === q.id ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>

              {editingId === q.id && (
                <div style={{ padding: '0 16px 14px' }}>
                  <EditForm
                    q={q}
                    onSave={(updated) => {
                      setQuestions(qs => qs.map(x => x.id === updated.id ? updated : x))
                      setEditingId(null)
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddForm
          maxOrder={maxOrder}
          onAdd={(q) => { setQuestions(qs => [...qs, q]); setShowAdd(false) }}
          onCancel={() => setShowAdd(false)}
        />
      )}
    </main>
  )
}

const arrowBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid #dce6f5',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 10,
  padding: '1px 5px',
  color: '#666',
  lineHeight: 1.4,
}
