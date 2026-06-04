'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'

import { AuthShell } from '@/components/auth-shell'
import { AuthErrorBox, AuthField, authInputStyle } from '@/components/auth-form-bits'
import { postAuthJson } from '@/lib/auth/client'

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // SAAS-4 (2026-05-18) — capture the invite token from the URL. The
  // server-side preflight (validity + inviting teacher's email) is
  // intentionally out of scope for this slice: the client passes the
  // token to /api/auth/register, which verifies HMAC + redeems
  // atomically. A future polish PR can add a /api/teacher/invites/
  // preview endpoint to render «Вас пригласил <email>» before submit.
  const inviteToken = searchParams.get('invite') ?? null
  // SAAS-PIVOT Epic 1 Day 2 (2026-05-22) — `/register?role=teacher`
  // pre-selects the teacher branch so the teacher-acquisition landing
  // can deep-link learners → registration with the right role already
  // chosen (plan §5 Day 2 "/register?role=teacher route activation").
  // An invite token still forces role=student (anti-spoof on the
  // server) regardless of this query param.
  const roleFromQuery = searchParams.get('role')
  const initialRole: 'student' | 'teacher' =
    roleFromQuery === 'teacher' ? 'teacher' : 'student'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // An invited learner has role pre-locked to student.
  const [role, setRole] = useState<'student' | 'teacher'>(initialRole)
  const [consent, setConsent] = useState(false)
  // SAAS-OFFER A1.1 (2026-05-31) — отдельный saas_offer checkbox для
  // teacher self-reg. Только видим при role=teacher && !inviteToken.
  // Версия выкачивается с /api/legal/current?kind=saas_offer для
  // TOCTOU-pinning (предотвращение race между form render и submit).
  const [saasOfferAgreed, setSaasOfferAgreed] = useState(false)
  const [saasOfferVersion, setSaasOfferVersion] = useState<{
    id: string
    versionLabel: string
    isPlaceholder: boolean
  } | null>(null)
  // §0af Closure for BLOCKER #4 (Sub-A.3 two-document TOCTOU): pin
  // BOTH the saas_offer AND saas_processor_terms version IDs at form
  // render so the server can reject if either drifts before submit.
  const [saasProcessorTermsVersion, setSaasProcessorTermsVersion] = useState<{
    id: string
    versionLabel: string
    isPlaceholder: boolean
  } | null>(null)
  // A1.1 round-1 WARN#3 closure — loading-флаг блокирует submit ДО
  // получения /api/legal/current response. Без него teacher мог успеть
  // нажать «Создать» до окончания fetch и получить server-side 503/400.
  const [saasOfferLoading, setSaasOfferLoading] = useState(false)
  // Onboarding Sub-PR C4 (`learner-invite-from-teacher-name`) — when
  // `?invite=<token>` is present, fetch the inviting teacher's display
  // name from /api/auth/invite-preview (anonymous endpoint) so the
  // banner above the form can render «Вас пригласил <name>».
  const [inviterTeacherName, setInviterTeacherName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const isTeacherSelfReg = !inviteToken && role === 'teacher'

  useEffect(() => {
    if (!inviteToken) {
      setInviterTeacherName(null)
      return
    }
    let cancelled = false
    fetch('/api/auth/invite-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inviteToken }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data && typeof data.teacherName === 'string') {
          setInviterTeacherName(data.teacherName)
        }
      })
      .catch(() => {
        if (cancelled) return
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken])

  useEffect(() => {
    if (!isTeacherSelfReg) {
      setSaasOfferLoading(false)
      return
    }
    let cancelled = false
    setSaasOfferLoading(true)
    Promise.all([
      fetch('/api/legal/current?kind=saas_offer').then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch('/api/legal/current?kind=saas_processor_terms').then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([offer, terms]) => {
        if (cancelled) return
        if (offer) setSaasOfferVersion(offer)
        if (terms) setSaasProcessorTermsVersion(terms)
        setSaasOfferLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setSaasOfferLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isTeacherSelfReg])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!consent) {
      setError('Подтвердите согласие на обработку персональных данных.')
      return
    }
    if (isTeacherSelfReg && saasOfferLoading) {
      setError('Загружаем условия SaaS-оферты, подождите секунду…')
      return
    }
    if (isTeacherSelfReg && saasOfferVersion && !saasOfferAgreed) {
      setError('Подтвердите согласие с условиями SaaS-оферты.')
      return
    }
    setSubmitting(true)
    const result = await postAuthJson('/api/auth/register', {
      email: email.trim(),
      password,
      personalDataConsentAccepted: true,
      role: inviteToken ? 'student' : role,
      ...(inviteToken ? { inviteToken } : {}),
      ...(isTeacherSelfReg && saasOfferVersion && saasProcessorTermsVersion
        ? {
            saasOfferConsentAccepted: saasOfferAgreed,
            saasOfferConsentVersionId: saasOfferVersion.id,
            saasProcessorTermsConsentVersionId: saasProcessorTermsVersion.id,
          }
        : {}),
    })
    if (result.ok) {
      router.push(`/verify-pending?email=${encodeURIComponent(email.trim())}`)
      return
    }
    if (result.error === 'saas_offer_version_changed') {
      // Operator опубликовал новую версию между mount и submit. Перетянем
      // version-id и попросим заново согласиться.
      setError(
        'Условия SaaS-оферты обновились. Перечитайте новую версию и подтвердите ещё раз.',
      )
      Promise.all([
        fetch('/api/legal/current?kind=saas_offer').then((r) =>
          r.ok ? r.json() : null,
        ),
        fetch('/api/legal/current?kind=saas_processor_terms').then((r) =>
          r.ok ? r.json() : null,
        ),
      ]).then(([offer, terms]) => {
        if (offer) {
          setSaasOfferVersion(offer)
          setSaasOfferAgreed(false)
        }
        if (terms) setSaasProcessorTermsVersion(terms)
      })
        .catch(() => {})
      setSubmitting(false)
      return
    }
    setError(result.error)
    setSubmitting(false)
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Регистрация</h1>
      <p style={{ color: 'var(--secondary)', fontSize: 15, marginBottom: 32 }}>
        Уже есть аккаунт?{' '}
        <Link href="/login" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
          Войти
        </Link>
      </p>

      <form onSubmit={onSubmit}>
        <AuthField label="E-mail">
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            style={authInputStyle}
          />
        </AuthField>

        <AuthField label="Пароль" hint="Минимум 10 символов">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            style={authInputStyle}
          />
        </AuthField>

        {inviteToken ? (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.35)',
              color: '#bbf7d0',
              fontSize: 14,
              lineHeight: 1.4,
              marginBottom: 16,
            }}
          >
            {inviterTeacherName ? (
              <>
                Вас пригласил(-а) <strong>{inviterTeacherName}</strong>. После
                регистрации вы будете автоматически привязаны к этому учителю.
              </>
            ) : (
              <>
                Вы регистрируетесь по приглашению учителя. После регистрации вы
                будете автоматически привязаны к этому учителю.
              </>
            )}
            {/* Onboarding Sub-PR C5 — already-registered link per spec
                §1.2 `learner-invite-already-registered-link`. The link
                lets an existing learner sign in via /login?invite=...
                and have the same teacher binding applied (Plan G —
                backend handles the redeem on login). */}
            <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
              Уже есть аккаунт?{' '}
              <Link
                href={`/login?invite=${encodeURIComponent(inviteToken)}`}
                style={{ color: '#bbf7d0', textDecoration: 'underline' }}
              >
                Войти и привязаться к учителю
              </Link>
              .
            </div>
          </div>
        ) : (
          <fieldset
            style={{
              border: 'none',
              margin: '0 0 16px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <legend
              style={{
                color: 'var(--secondary)',
                fontSize: 13,
                marginBottom: 6,
                padding: 0,
              }}
            >
              Кто вы?
            </legend>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="role"
                value="student"
                checked={role === 'student'}
                onChange={() => setRole('student')}
                disabled={submitting}
                style={{ accentColor: '#C87878' }}
              />
              <span>Я ученик — буду заниматься с учителем</span>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="role"
                value="teacher"
                checked={role === 'teacher'}
                onChange={() => setRole('teacher')}
                disabled={submitting}
                style={{ accentColor: '#C87878' }}
              />
              <span>Я учитель — буду проводить занятия</span>
            </label>
          </fieldset>
        )}

        <label
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            color: 'var(--secondary)',
            fontSize: 14,
            lineHeight: 1.5,
            marginTop: 16,
            marginBottom: 24,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={submitting}
            style={{ marginTop: 3, width: 18, height: 18, accentColor: '#C87878' }}
          />
          <span>
            Я согласен(на) с{' '}
            <Link href="/privacy" style={{ color: 'var(--text)' }} target="_blank">
              политикой обработки персональных данных
            </Link>{' '}
            и даю{' '}
            <Link href="/consent/personal-data" style={{ color: 'var(--text)' }} target="_blank">
              согласие на их обработку
            </Link>
            .
          </span>
        </label>

        {isTeacherSelfReg && saasOfferVersion && !saasOfferVersion.isPlaceholder ? (
          <label
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              color: 'var(--secondary)',
              fontSize: 14,
              lineHeight: 1.5,
              marginTop: -8,
              marginBottom: 24,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={saasOfferAgreed}
              onChange={(e) => setSaasOfferAgreed(e.target.checked)}
              disabled={submitting}
              style={{ marginTop: 3, width: 18, height: 18, accentColor: '#C87878' }}
            />
            <span>
              Я согласен(на) с условиями{' '}
              <Link
                href="/saas/offer"
                style={{ color: 'var(--text)' }}
                target="_blank"
              >
                SaaS-оферты LevelChannel
              </Link>{' '}
              и{' '}
              <Link
                href="/saas/processor-terms"
                style={{ color: 'var(--text)' }}
                target="_blank"
              >
                Приложением № 1 (Условия поручения оператора учителю)
              </Link>{' '}
              (версия {saasOfferVersion.versionLabel}).
            </span>
          </label>
        ) : null}

        {error ? <AuthErrorBox>{error}</AuthErrorBox> : null}

        <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
          {submitting ? 'Отправляем…' : 'Создать аккаунт'}
        </button>
      </form>
    </AuthShell>
  )
}
