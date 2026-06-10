'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  Banner,
  Button,
  EmptyState,
  FloatingActionButton,
} from '@/components/ui/primitives'

import { CapBanners } from './cap-banners'
import {
  IssuePackageModal,
  type IssuePackageModalLearner,
  type IssuePackageModalPackage,
} from './issue-package-modal'
import { PackageCard, type PackageView } from './package-card'
import { PackageCreateSheet } from './package-create-sheet'

// Client island for /teacher/packages. Mirrors TariffList shape:
// CapBanners → optional pageError Banner → top-of-page CTA →
// EmptyState OR PackageCard[] (active first, archived inline after) →
// modal create sheet → mobile FAB.

export type PackageListProps = {
  initialPackages: PackageView[]
  writeCap: number
  currentActiveCount: number
  /**
   * Learners eligible for package issuance — embedded as SSR JSON-prop
   * (≤30 expected). Drives the IssuePackageModal Combobox.
   */
  learners: ReadonlyArray<IssuePackageModalLearner>
}

// SaaS-pivot R1-BLOCKER closure (free-tier-1pkg-1tariff wave): the
// PATCH route's reactivate branch checks the write-cap server-side
// inside the advisory-lock TX, so a tutor who archives → tries to
// reactivate past the cap gets the same `tier_write_cap_reached` 422
// they'd see on create. No client-side block needed.

export function PackageList({
  initialPackages,
  writeCap,
  currentActiveCount,
  learners,
}: PackageListProps) {
  const router = useRouter()
  const [openCreate, setOpenCreate] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  // Plan v3 §3.2 — Banner after successful create. Either nudges the
  // teacher to issue the new package to a learner OR (when learnersCount
  // is zero) to invite a learner first.
  const [postCreatePkg, setPostCreatePkg] = useState<
    IssuePackageModalPackage | null
  >(null)
  // Plan v3 §3.5 — singleton IssuePackageModal owned by this client
  // island. Open state derived from `issuePkg`.
  const [issuePkg, setIssuePkg] = useState<IssuePackageModalPackage | null>(
    null,
  )
  const [successAnnouncement, setSuccessAnnouncement] = useState<string | null>(
    null,
  )

  const isUnlimited = writeCap < 0
  const noCreatesAtAll = !isUnlimited && writeCap === 0
  const atCap = !isUnlimited && writeCap > 0 && currentActiveCount >= writeCap
  const canCreate = !noCreatesAtAll && !atCap

  // Active first (visible to learners), then archived (operator-only). All
  // share the same card style; archived card just renders the warning pill.
  const active = initialPackages.filter((p) => p.isActive)
  const archived = initialPackages.filter((p) => !p.isActive)

  async function apiPatch(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch(`/api/teacher/packages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null
        const message: string =
          data?.message || data?.error || `HTTP ${res.status}`
        return { ok: false, message }
      }
      router.refresh()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      return { ok: false, message }
    }
  }

  async function apiCreate(input: {
    titleRu: string
    descriptionRu: string | null
    durationMinutes: number
    count: number
    amountKopecks: number
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch('/api/teacher/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Body intentionally omits slug — server derives a stable
          // unique slug from titleRu + nonce; the field is server-owned.
          // Use a transient client-side slug placeholder; route generates
          // its own.
          slug: synthesiseClientSlug(input.titleRu),
          titleRu: input.titleRu,
          descriptionRu: input.descriptionRu,
          durationMinutes: input.durationMinutes,
          count: input.count,
          amountKopecks: input.amountKopecks,
        }),
      })
      const body = (await res.json().catch(() => null)) as
        | {
            package?: { id?: string; titleRu?: string }
            error?: string
            message?: string
          }
        | null
      if (!res.ok) {
        const message: string =
          body?.message || body?.error || `HTTP ${res.status}`
        return { ok: false, message }
      }
      setOpenCreate(false)
      // Plan v3 §3.2 — surface the post-create Banner so the teacher
      // immediately sees the «Выдать ученикам →» CTA. POST returns the
      // created package wrapped in `{ package: ... }`; destructure
      // here. `key={pkg.id}` on the Banner makes the re-render animate
      // on subsequent creates (R25-1).
      const created = body?.package
      if (created?.id && created?.titleRu) {
        setPostCreatePkg({ id: created.id, titleRu: created.titleRu })
      }
      router.refresh()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown'
      setPageError(message)
      return { ok: false, message }
    }
  }

  const hasAny = active.length > 0 || archived.length > 0

  return (
    <div className="pricing-stack">
      <CapBanners
        writeCap={writeCap}
        currentActiveCount={currentActiveCount}
        noun="пакетов"
        singularPhrase="пакетов"
        atCapCopy="Лимит пакетов исчерпан. Архивируйте старый пакет, чтобы создать новый."
      />

      {pageError ? (
        <Banner tone="danger" icon="⚠">
          {pageError}
        </Banner>
      ) : null}

      {/* Plan v3 §3.2 — post-create activation nudge. Stays visible until
          the teacher dismisses it via the close-button-equivalent (clicks
          a CTA) or opens the issue modal. `key={pkg.id}` re-mounts the
          Banner on subsequent creates so the enter animation fires (R25-1). */}
      {postCreatePkg ? (
        <Banner
          key={postCreatePkg.id}
          tone="success"
          action={
            learners.length > 0 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setIssuePkg(postCreatePkg)
                  setPostCreatePkg(null)
                }}
              >
                Выдать ученикам →
              </Button>
            ) : (
              <Button variant="primary" size="sm" href="/teacher/learners">
                Пригласить ученика →
              </Button>
            )
          }
        >
          {learners.length > 0
            ? `Пакет «${postCreatePkg.titleRu}» создан.`
            : `Пакет «${postCreatePkg.titleRu}» создан. Пригласите ученика, чтобы выдать.`}
        </Banner>
      ) : null}

      {/* Screen-reader announcement after a successful issue (A11Y-R2-3).
          Lives 4 seconds then clears. Not visible — sr-only. */}
      {successAnnouncement ? (
        <div role="status" aria-live="polite" style={srOnlyStyle}>
          {successAnnouncement}
        </div>
      ) : null}

      {canCreate ? (
        <div className="pricing-header-actions">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setOpenCreate(true)}
            iconLeft={<span aria-hidden="true">+</span>}
          >
            Новый пакет
          </Button>
        </div>
      ) : null}

      {!hasAny ? (
        <EmptyState
          title="Пакетов пока нет"
          body="Соберите первый пакет — например, «8 занятий по 60 минут». Ученики смогут купить его сразу, а вы получите предсказуемый доход."
          action={
            canCreate ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => setOpenCreate(true)}
              >
                Создать первый пакет
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="pricing-list" role="list">
          {[...active, ...archived].map((pkg) => (
            <li key={pkg.id}>
              <PackageCard
                pkg={pkg}
                onSave={(patch) => apiPatch(pkg.id, patch)}
                onArchive={() => apiPatch(pkg.id, { isActive: false })}
                onReactivate={() => apiPatch(pkg.id, { isActive: true })}
              />
            </li>
          ))}
        </ul>
      )}

      {openCreate ? (
        <PackageCreateSheet
          onClose={() => setOpenCreate(false)}
          onCreate={apiCreate}
        />
      ) : null}

      {/* Singleton IssuePackageModal. State owned here (DSA-R3-3). */}
      <IssuePackageModal
        open={issuePkg !== null}
        pkg={issuePkg}
        learners={learners}
        onClose={() => setIssuePkg(null)}
        onIssued={({ learnerLabel, pkgTitle }) => {
          setIssuePkg(null)
          setPostCreatePkg(null) // close any lingering create banner
          const announcement = `Пакет «${pkgTitle}» выдан ${learnerLabel}.`
          setSuccessAnnouncement(announcement)
          window.setTimeout(() => setSuccessAnnouncement(null), 4000)
          router.refresh()
        }}
      />

      {canCreate ? (
        <FloatingActionButton
          label="Новый пакет"
          onClick={() => setOpenCreate(true)}
          className="pricing-fab"
        />
      ) : null}
    </div>
  )
}

const srOnlyStyle = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
}

// Slug is server-owned, but the route handler currently REQUIRES a
// non-empty `slug` field in the body (see /api/teacher/packages/route.ts
// line 91). We synthesise a client-side cyrillic→latin transliteration
// + nonce so a Russian title yields a deterministic-ish slug, exactly
// as the old client.tsx did. The route's UNIQUE(teacher_id, slug)
// constraint catches collisions; route returns 409 → user retries.
function synthesiseClientSlug(title: string): string {
  const cyr2lat: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
    я: 'ya',
  }
  const base = title
    .toLowerCase()
    .split('')
    .map((ch) => cyr2lat[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'pkg'
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${base}-${rnd}`
}
